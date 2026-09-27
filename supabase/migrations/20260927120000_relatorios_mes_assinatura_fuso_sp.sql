-- Grupo 1 (itens 1-3, decisões de Denis 27/09/2026): mês da assinatura, última assinatura e
-- horário de Brasília nos limites de período. Somente CREATE OR REPLACE; assinaturas, retorno e
-- ACL preservados. Rollback: reaplicar as definições anteriores (pg_get_functiondef guardado
-- antes da mudança, em docs/sql/rollback/20260927120000_*).

CREATE OR REPLACE FUNCTION public.vendas_comerciais_validas()
 RETURNS TABLE(sale_id uuid, venda_em timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Mês comercial = mês da ASSINATURA (decisão de Denis, 27/09/2026):
  --   venda padrão: ÚLTIMO evento contrato_assinado (reassinatura vale a última);
  --   Lançamento: sales.data_assinatura (meia-noite de São Paulo); sem ela, entrada no Financeiro.
  -- A elegibilidade (status + evento obrigatório) não muda.
  select
    s.id as sale_id,
    case
      when s.modalidade::text = 'lancamento' then
        coalesce(
          (s.data_assinatura::timestamp at time zone 'America/Sao_Paulo'),
          max(h.created_at) filter (where h.para::text = 'ocorrencia_analise_financeiro')
        )
      else
        max(h.created_at) filter (where h.para::text = 'contrato_assinado')
    end as venda_em
  from sales s
  join sale_status_history h on h.sale_id = s.id
  where s.status::text in (
    'contrato_assinado',
    'ocorrencia_pendente',
    'ocorrencia_analise_financeiro',
    'ocorrencia_devolvida_gestor',
    'ocorrencia_concluida'
  )
  group by s.id, s.modalidade, s.data_assinatura
  having case
    when s.modalidade::text = 'lancamento' then
      max(h.created_at) filter (where h.para::text = 'ocorrencia_analise_financeiro') is not null
    else
      max(h.created_at) filter (where h.para::text = 'contrato_assinado') is not null
  end;
$function$;

CREATE OR REPLACE FUNCTION public.vendas_comerciais_canonicas()
 RETURNS TABLE(sale_id uuid, venda_em timestamp with time zone, data_fechamento date, modalidade text, status text, codigo_interno text, imovel_id text, corretor_id uuid, percentual_comissao numeric, valor_negociado numeric, valor_total_comissao numeric, comissao_bruta numeric, parceria_externa numeric, vgv_proprio numeric, comissao_propria numeric, occurrence_count bigint, occurrence_concluida_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH metricas AS (
    SELECT * FROM public.metricas_venda_sem_parceria()
  )
  SELECT
    v.sale_id,
    v.venda_em,
    (v.venda_em at time zone 'America/Sao_Paulo')::date AS data_fechamento,
    s.modalidade::text,
    s.status::text,
    s.codigo_interno,
    s.imovel_id,
    s.corretor_id,
    s.percentual_comissao,
    m.vgv AS valor_negociado,
    m.comissao_bruta AS valor_total_comissao,
    m.comissao_bruta,
    m.parceria_externa,
    CASE
      WHEN m.comissao_bruta > 0 THEN
        m.vgv * least(greatest(m.comissao_bruta - m.parceria_externa, 0) / m.comissao_bruta, 1)
      ELSE 0
    END AS vgv_proprio,
    greatest(m.comissao_bruta - m.parceria_externa, 0) AS comissao_propria,
    coalesce(o.occurrence_count, 0),
    coalesce(o.occurrence_concluida_count, 0)
  FROM public.vendas_comerciais_validas() v
  JOIN public.sales s ON s.id = v.sale_id
  JOIN metricas m ON m.sale_id = v.sale_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS occurrence_count,
      count(*) FILTER (WHERE oc.status = 'concluida') AS occurrence_concluida_count
    FROM public.occurrences oc
    WHERE oc.sale_id = s.id
  ) o ON true
  WHERE s.status::text NOT IN ('cancelada', 'arquivada')
    AND s.valor_negociado > 0
    AND s.valor_total_comissao > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.comparativo_comissao_6pct()
 RETURNS TABLE(sale_id uuid, codigo_interno text, imovel_id text, modalidade text, status text, corretor_id uuid, valor_negociado numeric, valor_total_comissao numeric, percentual_comissao numeric, parceria_externa numeric, data_fechamento date, evento_fechamento text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_any_role((select auth.uid()), array['admin','super_admin','financeiro']::public.app_role[]) then
    raise exception 'Acesso não autorizado ao Comparativo de Comissão.' using errcode = '42501';
  end if;

  return query
  select s.id, s.codigo_interno, s.imovel_id, s.modalidade::text, s.status::text,
    s.corretor_id, s.valor_negociado, s.valor_total_comissao, s.percentual_comissao,
    coalesce(px.valor, 0), (v.venda_em at time zone 'America/Sao_Paulo')::date,
    case when s.modalidade::text = 'lancamento'
      then 'ocorrencia_analise_financeiro' else 'contrato_assinado' end
  from public.vendas_comerciais_validas() v
  join public.sales s on s.id = v.sale_id
  left join lateral (
    select
      coalesce((select sum(op.valor) from public.occurrences o join public.occurrence_partners op on op.occurrence_id = o.id where o.sale_id = s.id), 0)
      + coalesce((select sum(oc.valor) from public.occurrences o join public.occurrence_commissions oc on oc.occurrence_id = o.id where o.sale_id = s.id and oc.sem_cadastro_confirmado), 0) as valor
  ) px on true
  where s.valor_negociado > 0 and s.valor_total_comissao > 0;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.comissoes_carteira_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with efetivadas as (
    select sale_id, venda_em as efetivada_em
    from public.vendas_comerciais_canonicas()
  ),
  parceria as (
    select occurrence_id, sum(valor) as valor
    from (
      select occurrence_id, coalesce(valor, 0) as valor
      from public.occurrence_partners
      union all
      select occurrence_id, coalesce(valor, 0) as valor
      from public.occurrence_commissions
      where sem_cadastro_confirmado
    ) x
    group by occurrence_id
  )
  select jsonb_build_object(
    'comissao_prevista_total', coalesce(sum(greatest(o.valor_comissao - coalesce(p.valor, 0), 0)) filter (where o.status <> 'concluida'), 0),
    'comissao_concluida_total', coalesce(sum(greatest(o.valor_comissao - coalesce(p.valor, 0), 0)) filter (where o.status = 'concluida'), 0),
    'comissao_parceria_externa_prevista_total', coalesce(sum(coalesce(p.valor, 0)) filter (where o.status <> 'concluida'), 0),
    'comissao_parceria_externa_concluida_total', coalesce(sum(coalesce(p.valor, 0)) filter (where o.status = 'concluida'), 0),
    'liquido_imobiliaria_prevista_total', coalesce(sum(coalesce(
      (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
      (d.resultado->>'saldo_imobiliaria')::numeric,
      0
    )) filter (where o.status <> 'concluida'), 0),
    'liquido_imobiliaria_concluida_total', coalesce(sum(coalesce(
      (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
      (d.resultado->>'saldo_imobiliaria')::numeric,
      0
    )) filter (where o.status = 'concluida'), 0),
    'comissao_por_corretor', coalesce((select jsonb_object_agg(user_id, total) from (
      select oc.user_id::text as user_id, sum(oc.valor) as total
      from public.occurrence_commissions oc
      join public.occurrences oi on oi.id = oc.occurrence_id
      join efetivadas ei on ei.sale_id = oi.sale_id
      join public.sales si on si.id = oi.sale_id
      where oc.user_id is not null
        and not coalesce(oc.sem_cadastro_confirmado, false)
        and si.status::text not in ('cancelada','arquivada')
        and ei.efetivada_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
        and ei.efetivada_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      group by oc.user_id
    ) q), '{}'::jsonb)
  )
  from public.occurrences o
  join efetivadas e on e.sale_id = o.sale_id
  join public.sales s on s.id = o.sale_id
  cross join lateral (
    select public.calcular_distribuicao_venda(s.*) as resultado
  ) d
  left join parceria p on p.occurrence_id = o.id
  where _de <= _ate
    and e.efetivada_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
    and e.efetivada_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
    and s.status::text not in ('cancelada','arquivada')
    and public.has_any_role(
      auth.uid(),
      array['financeiro','admin','super_admin']::public.app_role[]
    );
$function$
;

CREATE OR REPLACE FUNCTION public.resumo_desempenho_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select
      s.id,
      greatest(coalesce(s.valor_negociado, 0), 0) as vgv,
      greatest(coalesce((d.valor->>'comissao_bruta')::numeric, 0), 0) as comissao_bruta,
      greatest(coalesce((d.valor->>'parceria_externa')::numeric, 0), 0) as parceria_externa,
      greatest(coalesce((d.valor->>'saldo_inicial_imobiliaria')::numeric, 0), 0) as parte_unidade,
      greatest(coalesce((d.valor->>'saldo_liquido_imobiliaria')::numeric, 0), 0) as receita_liquida
    from public.vendas_comerciais_canonicas() v
    join sales s on s.id = v.sale_id
    cross join lateral (select public.calcular_distribuicao_venda(s.id) as valor) d
    where v.venda_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), propria as (
    select *,
      greatest(comissao_bruta - parceria_externa, 0) as comissao_propria,
      case when comissao_bruta > 0 then
        vgv * least(greatest(comissao_bruta - parceria_externa, 0) / comissao_bruta, 1)
      else 0 end as vgv_proprio
    from base
  )
  select jsonb_build_object(
    'vgv_proprio', coalesce(sum(vgv_proprio), 0),
    'comissao_propria', coalesce(sum(comissao_propria), 0),
    'parte_unidade', coalesce(sum(parte_unidade), 0),
    'receita_liquida_imobiliaria', coalesce(sum(receita_liquida), 0),
    'quantidade_vendas', count(*)
  )
  from propria
  where _de <= _ate
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$
;

CREATE OR REPLACE FUNCTION public.desempenho_ranking_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with vendas_periodo as (
    select
      v.sale_id,
      v.venda_em as fechado_em,
      s.created_at as sale_created_at,
      s.modalidade::text as modalidade
    from public.vendas_comerciais_canonicas() v
    join sales s on s.id = v.sale_id
    where v.venda_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), devolucoes as (
    select sale_id, count(*) as n
    from sale_status_history
    where para::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')
    group by sale_id
  ), participante_venda as (
    select
      oc.user_id,
      vp.sale_id,
      sum(oc.valor) as valor_na_venda,
      coalesce(
        sum(oc.valor) filter (where oc.papel <> 'coordenador_lancamento'),
        0
      ) as valor_equipe_na_venda,
      bool_or(oc.papel <> 'coordenador_lancamento') as conta_equipe,
      bool_or(
        vp.modalidade = 'lancamento'
        and oc.papel = 'coordenador_lancamento'
      ) as gestao_lancamento,
      bool_or(
        vp.modalidade = 'lancamento'
        and oc.papel <> 'coordenador_lancamento'
      ) as corretora_lancamento,
      max(extract(epoch from (vp.fechado_em - vp.sale_created_at)) / 86400.0) as dias,
      bool_or(coalesce(d.n, 0) > 0) as teve_devolucao
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join vendas_periodo vp on vp.sale_id = o.sale_id
    left join devolucoes d on d.sale_id = vp.sale_id
    where oc.user_id is not null
    group by oc.user_id, vp.sale_id
  ), ranking_corretor_base as (
    select
      user_id as corretor_id,
      count(*) as vendas_fechadas,
      avg(dias) as tempo_medio_dias,
      count(*) filter (where teve_devolucao) as vendas_com_devolucao,
      sum(valor_na_venda) as comissao,
      bool_or(gestao_lancamento) as gestao_lancamento,
      bool_or(corretora_lancamento) as corretora_lancamento
    from participante_venda
    group by user_id
  ), unidade as (
    select p.corretor_id, coalesce(tm.team_id, tl.id) as team_id
    from (select distinct user_id as corretor_id from participante_venda) p
    left join team_members tm on tm.membro_id = p.corretor_id
    left join lateral (
      select equipe.id
      from teams equipe
      join team_members membros on membros.team_id = equipe.id
      where equipe.lider_id = p.corretor_id
      group by equipe.id, equipe.created_at
      order by equipe.created_at
      limit 1
    ) tl on tm.team_id is null
  ), ranking_corretor_full as (
    select r.*, u.team_id
    from ranking_corretor_base r
    left join unidade u on u.corretor_id = r.corretor_id
  ), ranking_corretor as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'corretor_id', corretor_id,
      'vendas_fechadas', vendas_fechadas,
      'tempo_medio_dias', round(tempo_medio_dias::numeric, 1),
      'taxa_devolucao', round((100.0 * vendas_com_devolucao / nullif(vendas_fechadas, 0))::numeric, 0),
      'comissao', comissao,
      'gestao_lancamento', gestao_lancamento,
      'corretora_lancamento', corretora_lancamento
    ) order by comissao desc, vendas_fechadas desc), '[]'::jsonb) as valor
    from ranking_corretor_full
  ), equipe_vendas as (
    select
      u.team_id,
      p.sale_id,
      bool_or(p.teve_devolucao) as teve_devolucao,
      sum(p.valor_equipe_na_venda) as comissao
    from participante_venda p
    join unidade u on u.corretor_id = p.user_id
    where p.conta_equipe and u.team_id is not null
    group by u.team_id, p.sale_id
  ), ranking_equipe_base as (
    select
      team_id,
      count(*) as vendas_fechadas,
      count(*) filter (where teve_devolucao) as vendas_com_devolucao,
      sum(comissao) as comissao
    from equipe_vendas
    group by team_id
  ), ranking_equipe as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'team_id', r.team_id,
      'team_nome', t.nome,
      'vendas_fechadas', r.vendas_fechadas,
      'comissao', r.comissao,
      'taxa_devolucao', round((100.0 * r.vendas_com_devolucao / nullif(r.vendas_fechadas, 0))::numeric, 0)
    ) order by r.comissao desc, r.vendas_fechadas desc), '[]'::jsonb) as valor
    from ranking_equipe_base r
    join teams t on t.id = r.team_id
  ), captacoes as (
    select count(distinct id) as quantidade
    from sales
    where created_at >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and created_at < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      and status::text not in ('cancelada','arquivada')
  )
  select jsonb_build_object(
    'ranking_corretor', (select valor from ranking_corretor),
    'ranking_equipe', (select valor from ranking_equipe),
    'quantidade_captacoes', (select quantidade from captacoes)
  )
  where _de <= _ate
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$
;

CREATE OR REPLACE FUNCTION public.desempenho_contexto_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with stage_map(status, stage) as (values
    ('rascunho','inicio'), ('devolvida_ajuste','inicio'), ('ocorrencia_devolvida_gestor','inicio'),
    ('enviada_revisao','aprovacao'), ('aprovada_gestor','aprovacao'),
    ('enviada_juridico','juridico'), ('em_elaboracao_contrato','juridico'),
    ('contrato_conferencia_gestor','juridico'), ('contrato_conferencia_corretor','juridico'),
    ('contrato_ok_corretor','juridico'), ('aguardando_assinatura','juridico'),
    ('contrato_assinado','concluida'), ('ocorrencia_pendente','concluida'),
    ('ocorrencia_analise_financeiro','concluida'), ('ocorrencia_concluida','concluida')
  ), historico as (
    select h.sale_id, h.para,
      least(coalesce(lead(h.created_at) over (partition by h.sale_id order by h.created_at), ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')), ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo'))
        - greatest(h.created_at, (_de::timestamp at time zone 'America/Sao_Paulo')) duracao
    from sale_status_history h where h.created_at < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), tempo as (
    select coalesce(jsonb_object_agg(stage, media), '{}'::jsonb) valor from (
      select sm.stage, round((avg(extract(epoch from h.duracao)) / 86400.0)::numeric, 1) media
      from historico h join stage_map sm on sm.status = h.para::text
      where h.duracao > interval '0 seconds' group by sm.stage
    ) x
  ), efetivadas as (
    select sale_id, venda_em as efetivada_em from public.vendas_comerciais_validas()
  ), evolucao as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', to_char(m.mes, 'YYYY-MM'), 'vendas_fechadas', coalesce(v.vendas, 0),
      'comissao', coalesce(v.comissao, 0)
    ) order by m.mes), '[]'::jsonb) valor
    from generate_series(date_trunc('month', _de::timestamp), date_trunc('month', _ate::timestamp), interval '1 month') m(mes)
    left join (
      select date_trunc('month', e.efetivada_em at time zone 'America/Sao_Paulo') mes, count(distinct e.sale_id) vendas,
        coalesce(sum(oc.valor) filter (where oc.user_id is not null), 0) comissao
      from efetivadas e
      left join occurrences o on o.sale_id = e.sale_id
      left join occurrence_commissions oc on oc.occurrence_id = o.id
      where e.efetivada_em >= (_de::timestamp at time zone 'America/Sao_Paulo') and e.efetivada_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      group by 1
    ) v on v.mes = m.mes
  ), whatsapp as (
    select count(*) eventos, coalesce(sum((payload->>'enviados')::int), 0) enviados,
      coalesce(sum((payload->>'falhas')::int), 0) falhas,
      count(*) filter (where (payload->>'falhas')::int > 0) eventos_com_falha
    from activity_logs where acao = 'whatsapp_notification_result'
      and created_at >= (_de::timestamp at time zone 'America/Sao_Paulo') and created_at < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  )
  select jsonb_build_object(
    'tempo_por_etapa', (select valor from tempo),
    'evolucao_mensal', (select valor from evolucao),
    'whatsapp', case when has_any_role(auth.uid(), array['super_admin']::app_role[]) then
      (select jsonb_build_object('eventos', eventos, 'enviados', enviados, 'falhas', falhas, 'eventos_com_falha', eventos_com_falha) from whatsapp)
      else null end
  ) where _de <= _ate and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$
;

CREATE OR REPLACE FUNCTION public.desempenho_detalhe_periodo(_de date, _ate date, _corretor_id uuid DEFAULT NULL::uuid, _team_id uuid DEFAULT NULL::uuid, _sem_equipe boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with p as (
    select * from public.participacoes_comerciais_validas()
    where venda_em >= (_de::timestamp at time zone 'America/Sao_Paulo') and venda_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_id', s.id, 'codigo_interno', s.codigo_interno, 'imovel_id', s.imovel_id,
    'modalidade', s.modalidade, 'valor_negociado', s.valor_negociado,
    'valor_comissao', case when _corretor_id is not null then p.valor_individual else p.valor_equipe end,
    'fechado_em', p.venda_em, 'corretor_id', p.user_id
  ) order by p.valor_individual desc), '[]'::jsonb)
  from p join sales s on s.id=p.sale_id
  where _de <= _ate and (
    (_corretor_id is not null and p.user_id=_corretor_id)
    or (_team_id is not null and p.conta_equipe and p.team_id=_team_id)
    or (_sem_equipe and p.conta_equipe and p.team_id is null)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.desempenho_ranking_corretor_proprio_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with vendas_periodo as (
    select v.sale_id, v.venda_em as fechado_em, s.created_at as sale_created_at
    from public.vendas_comerciais_validas() v
    join sales s on s.id = v.sale_id
    where v.venda_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), devolucoes as (
    select sale_id, count(*) as n
    from sale_status_history
    where para::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')
    group by sale_id
  ), producao_pessoal as (
    select
      oc.user_id as corretor_id,
      vp.sale_id,
      sum(oc.valor) as comissao,
      max(extract(epoch from (vp.fechado_em - vp.sale_created_at)) / 86400.0) as dias,
      bool_or(coalesce(d.n, 0) > 0) as teve_devolucao
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join vendas_periodo vp on vp.sale_id = o.sale_id
    left join devolucoes d on d.sale_id = vp.sale_id
    where oc.user_id is not null
      and oc.papel::text in ('corretor_captador','corretor_vendedor')
      and coalesce(oc.sem_cadastro_confirmado, false) = false
    group by oc.user_id, vp.sale_id
  ), ranking as (
    select
      corretor_id,
      count(*) as vendas_fechadas,
      round(avg(dias)::numeric, 1) as tempo_medio_dias,
      round((100.0 * count(*) filter (where teve_devolucao) / nullif(count(*), 0))::numeric, 0) as taxa_devolucao,
      sum(comissao) as comissao
    from producao_pessoal
    group by corretor_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'corretor_id', corretor_id,
    'vendas_fechadas', vendas_fechadas,
    'tempo_medio_dias', tempo_medio_dias,
    'taxa_devolucao', taxa_devolucao,
    'comissao', comissao
  ) order by comissao desc, vendas_fechadas desc), '[]'::jsonb)
  from ranking
  where _de <= _ate;
$function$
;

CREATE OR REPLACE FUNCTION public.desempenho_detalhe_corretor_proprio_periodo(_de date, _ate date, _corretor_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with vendas_periodo as (
    select v.sale_id, v.venda_em as fechado_em
    from public.vendas_comerciais_validas() v
    where v.venda_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), producao_pessoal as (
    select
      oc.user_id as corretor_id,
      vp.sale_id,
      sum(oc.valor) as valor_comissao,
      vp.fechado_em
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join vendas_periodo vp on vp.sale_id = o.sale_id
    where oc.user_id = _corretor_id
      and oc.papel::text in ('corretor_captador','corretor_vendedor')
      and coalesce(oc.sem_cadastro_confirmado, false) = false
    group by oc.user_id, vp.sale_id, vp.fechado_em
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_id', s.id,
    'codigo_interno', s.codigo_interno,
    'imovel_id', s.imovel_id,
    'modalidade', s.modalidade,
    'valor_negociado', s.valor_negociado,
    'valor_comissao', p.valor_comissao,
    'fechado_em', p.fechado_em,
    'corretor_id', p.corretor_id
  ) order by p.valor_comissao desc), '[]'::jsonb)
  from producao_pessoal p
  join sales s on s.id = p.sale_id
  where _de <= _ate;
$function$
;

CREATE OR REPLACE FUNCTION public.metas_progresso_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with p as (
    select * from public.participacoes_comerciais_validas()
    where venda_em >= (_de::timestamp at time zone 'America/Sao_Paulo') and venda_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), individual as (
    select user_id corretor_id, sum(valor_individual) total from p group by user_id
  ), equipe as (
    select team_id, sum(valor_equipe) total from p
    where conta_equipe and team_id is not null group by team_id
  ), metas_periodo as (
    select * from metas where mes >= date_trunc('month', _de)::date
      and mes <= date_trunc('month', _ate)::date
  )
  select jsonb_build_object(
    'corretor', coalesce((select jsonb_agg(jsonb_build_object(
      'corretor_id', m.corretor_id, 'meta_comissao', m.meta, 'comissao_realizada', coalesce(i.total, 0)
    )) from (select corretor_id, sum(meta_comissao) meta from metas_periodo where tipo='corretor' group by corretor_id) m
      left join individual i on i.corretor_id=m.corretor_id), '[]'::jsonb),
    'equipe', coalesce((select jsonb_agg(jsonb_build_object(
      'team_id', m.team_id, 'meta_comissao', m.meta, 'comissao_realizada', coalesce(e.total, 0)
    )) from (select team_id, sum(meta_comissao) meta from metas_periodo where tipo='equipe' group by team_id) m
      left join equipe e on e.team_id=m.team_id), '[]'::jsonb)
  ) where _de <= _ate;
$function$
;
