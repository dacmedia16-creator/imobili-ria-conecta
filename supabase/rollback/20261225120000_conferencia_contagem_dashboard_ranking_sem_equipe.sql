-- Rollback da migration 20261225120000_conferencia_contagem_dashboard_ranking_sem_equipe (t_fee0b359): volta os corpos de produção lidos em 22/11/2026.
BEGIN;

CREATE OR REPLACE FUNCTION public.dashboard_stats_leve()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with c as materialized (select * from public.dashboard_stats_leve_contexto()),
  vs as materialized (select s.* from public.sales s, c where s.organization_id = c.org and (s.id in (select unnest(c.vis) from c) or s.id in (select unnest(c.cl_leit) from c) or s.id in (select unnest(c.jur) from c) or (c.uid in (s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id) and c.ativo))),
  vo as materialized (select o.* from public.occurrences o, c where o.organization_id = c.org and (c.amplo or o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c))),
  vop as materialized (select op.* from public.occurrence_partners op, c where op.organization_id = c.org and (c.amplo or exists (select 1 from vo o where o.id = op.occurrence_id and (o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c))))),
  voc as materialized (select oc.* from public.occurrence_commissions oc, c where oc.organization_id = c.org and (c.amplo or exists (select 1 from vo o where o.id = oc.occurrence_id and (o.sale_id in (select unnest(c.vis) from c) or o.sale_id in (select unnest(c.cl_edic) from c) or o.sale_id in (select unnest(c.cl_leit) from c))))),
  vvd as materialized (select vd.* from public.venda_distribuicao vd, c where vd.organization_id = c.org and (vd.sale_id in (select unnest(c.vis) from c) or vd.sale_id in (select unnest(c.cl_leit) from c) or vd.sale_id in (select unnest(c.jur) from c))),
  vext as materialized (select e.* from public.sale_commission_extras e, c where e.organization_id = c.org and (c.amplo or e.sale_id in (select unnest(c.vis) from c) or e.sale_id in (select unnest(c.cl_edic) from c) or e.sale_id in (select unnest(c.cl_leit) from c) or e.sale_id in (select unnest(c.jur) from c))),
  meu_cor as materialized (
    -- = is_sale_corretor(auth.uid(), s.id): sale_corretores(s.id) contém o usuário
    select s.id from vs s, c
    where c.uid is not null and (
         c.uid in (s.corretor_captador_id, s.corretor_vendedor_id)
      or exists (select 1 from public.sale_commission_extras e
                 where e.sale_id = s.id and e.papel in ('corretor_captador', 'corretor_vendedor') and e.user_id = c.uid)
      or (s.corretor_id = c.uid and s.corretor_captador_id is null and s.corretor_vendedor_id is null
          and not exists (select 1 from public.sale_commission_extras e
                          where e.sale_id = s.id and e.papel in ('corretor_captador', 'corretor_vendedor') and e.user_id is not null)))
  ),
  meu_resp as materialized (
    -- = is_sale_responsavel(auth.uid(), s.id): lançamento -> corretor_id; demais -> sale_corretores
    select s.id from vs s, c
    where c.uid is not null and (
         (s.modalidade::text = 'lancamento' and s.corretor_id = c.uid)
      or (s.modalidade::text is distinct from 'lancamento' and s.id in (select id from meu_cor)))
  ),
  parceria_por_occ as (
    select occurrence_id, sum(valor) as valor
    from (
      select occurrence_id, coalesce(valor, 0) as valor
      from vop
      union all
      select occurrence_id, coalesce(valor, 0)
      from voc
      where sem_cadastro_confirmado
    ) p
    group by occurrence_id
  ),
  distribuicao_por_occ as (
    select
      o.id as occurrence_id,
      vd.resultado as resultado
    from vo o
    join vs s on s.id = o.sale_id
    join vvd vd on vd.sale_id = s.id
  ),
  minha_parte_ocorrencia as (
    select sum(oc.valor) as valor
    from voc oc
    join vo o on o.id = oc.occurrence_id
    join vs s on s.id = o.sale_id
    where oc.user_id = (select uid from c)
      and coalesce(oc.sem_cadastro_confirmado, false) = false
      and s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
  ),
  minha_parte_venda as (
    select sum(
      case when s.corretor_captador_id = (select uid from c) then coalesce((d.r->>'liquido_captador')::numeric, 0) else 0 end
      + case when s.corretor_vendedor_id = (select uid from c) then coalesce((d.r->>'liquido_vendedor')::numeric, 0) else 0 end
      + case when s.indicador_captador_id = (select uid from c) then coalesce(s.valor_comissao_indicador_captador, 0) else 0 end
      + case when s.indicador_vendedor_id = (select uid from c) then coalesce(s.valor_comissao_indicador_vendedor, 0) else 0 end
      + case when s.lider_captador_id = (select uid from c) then coalesce(s.valor_comissao_lider_captador, 0) else 0 end
      + case when s.lider_vendedor_id = (select uid from c) then coalesce(s.valor_comissao_lider_vendedor, 0) else 0 end
      + coalesce((select sum(coalesce(e.valor, 0)) from vext e
                  where e.sale_id = s.id and e.user_id = (select uid from c)
                    and coalesce(e.sem_cadastro_confirmado, false) = false), 0)
    ) as valor
    from vs s
    join lateral (select vd.resultado as r from vvd vd where vd.sale_id = s.id) d on true
    where s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
      and not exists (select 1 from vo o where o.sale_id = s.id)
      and (
        (select uid from c) in (s.corretor_captador_id, s.corretor_vendedor_id, s.indicador_captador_id,
                       s.indicador_vendedor_id, s.lider_captador_id, s.lider_vendedor_id)
        or exists (select 1 from vext e where e.sale_id = s.id and e.user_id = (select uid from c))
      )
  )
  select jsonb_build_object(
    'funil', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (
        select status::text as status, count(*) as cnt from vs group by status
      ) t
    ),
    'minhas_vendas', (select count(*) from vs s where s.id in (select id from meu_cor)),
    'minhas_pendencias', (select count(*) from vs s where s.status::text in ('rascunho','devolvida_ajuste') and s.id in (select id from meu_resp)),
    'meus_contratos_conferir', (select count(*) from vs s where s.status::text = 'contrato_conferencia_corretor' and s.id in (select id from meu_resp)),
    'meus_assinados', (select count(*) from vs s where s.status::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida') and s.id in (select id from meu_cor)),
    'minha_comissao_prevista', coalesce((select valor from minha_parte_ocorrencia), 0) + coalesce((select valor from minha_parte_venda), 0),
    'gestor_aguardando_revisao', (select count(*) from vs where status::text = 'enviada_revisao'),
    'gestor_contratos_conferir', (select count(*) from vs where status::text in ('contrato_conferencia_gestor','contrato_ok_corretor')),
    'gestor_ocorrencias_enviar', (select count(*) from vs where status::text in ('ocorrencia_pendente','ocorrencia_devolvida_gestor')),
    'gestor_devolvidas', (select count(*) from vs where status::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')),
    'juridico_aprovadas_gestor', (select count(*) from vs where status::text = 'aprovada_gestor'),
    'juridico_em_elaboracao', (select count(*) from vs where status::text = 'em_elaboracao_contrato'),
    'juridico_aguardando_assinatura', (select count(*) from vs where status::text = 'aguardando_assinatura'),
    'juridico_assinados', (select count(*) from vs where status::text = 'contrato_assinado'),
    'fin_ocorrencias_analise', (select count(*) from vs where status::text = 'ocorrencia_analise_financeiro'),
    'fin_devolvidas', (select count(*) from vs where status::text = 'ocorrencia_devolvida_gestor'),
    'occ_pendentes_total', (select count(*) from vo o join vs s on s.id = o.sale_id where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'occ_concluidas_total', (select count(*) from vo o join vs s on s.id = o.sale_id where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'comissao_prevista_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from vo o
      join vs s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_concluida_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from vo o
      join vs s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_prevista_total', coalesce((
      select sum(p.valor)
      from vo o
      join vs s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_concluida_total', coalesce((
      select sum(p.valor)
      from vo o
      join vs s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_prevista_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from vo o
      join vs s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_concluida_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from vo o
      join vs s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_por_corretor', (
      select coalesce(jsonb_object_agg(user_id, total), '{}'::jsonb) from (
        select oc.user_id::text as user_id, sum(oc.valor) as total
        from voc oc
        join vo o on o.id = oc.occurrence_id
        join vs s on s.id = o.sale_id
        where s.status::text not in ('cancelada','arquivada') and oc.user_id is not null
        group by oc.user_id
      ) t
    )
  );
$function$;

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
      max(vp.fechado_em) as fechado_em,
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
    -- equipe ATUAL da pessoa (só para exibir ao lado do nome no ranking individual)
    select p.corretor_id, public.equipe_vigente(p.corretor_id, now()) as team_id
    from (select distinct user_id as corretor_id from participante_venda) p
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
      p.team_id,
      p.sale_id,
      bool_or(p.teve_devolucao) as teve_devolucao,
      sum(p.valor_equipe_na_venda) as comissao
    from (
      select p.*, public.equipe_vigente(p.user_id, p.fechado_em) as team_id
      from participante_venda p
      where p.conta_equipe
    ) p
    where p.team_id is not null
    group by p.team_id, p.sale_id
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
$function$;

COMMIT;
