-- Permite filtrar a tela Desempenho por mês sem alterar os indicadores de posição atual.

create or replace function public.resumo_desempenho_periodo(_de date, _ate date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with efetivadas as (
    select h.sale_id, min(h.created_at) as efetivada_em
    from sale_status_history h
    where h.para::text = 'ocorrencia_analise_financeiro'
    group by h.sale_id
  ), base as (
    select
      s.id,
      greatest(coalesce(s.valor_negociado, 0), 0) as vgv,
      greatest(coalesce((d.valor->>'comissao_bruta')::numeric, 0), 0) as comissao_bruta,
      greatest(coalesce((d.valor->>'parceria_externa')::numeric, 0), 0) as parceria_externa,
      greatest(coalesce((d.valor->>'saldo_inicial_imobiliaria')::numeric, 0), 0) as parte_unidade,
      greatest(coalesce((d.valor->>'saldo_liquido_imobiliaria')::numeric, 0), 0) as receita_liquida
    from efetivadas e
    join sales s on s.id = e.sale_id
    cross join lateral (select public.calcular_distribuicao_venda(s.id) as valor) d
    where e.efetivada_em >= _de::timestamptz
      and e.efetivada_em < (_ate + 1)::timestamptz
      and s.status::text not in ('cancelada', 'arquivada')
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
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

create or replace function public.desempenho_ranking_periodo(_de date, _ate date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with fechadas as (
    select distinct on (sale_id) sale_id, created_at as fechado_em
    from sale_status_history
    where para::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida')
    order by sale_id, created_at asc
  ), vendas_periodo as (
    select f.sale_id, f.fechado_em, s.created_at as sale_created_at
    from fechadas f
    join sales s on s.id = f.sale_id
    where f.fechado_em >= _de::timestamptz
      and f.fechado_em < (_ate + 1)::timestamptz
      and s.status::text not in ('cancelada','arquivada')
  ), devolucoes as (
    select sale_id, count(*) as n
    from sale_status_history
    where para::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')
    group by sale_id
  ), participante_venda as (
    select oc.user_id,
      vp.sale_id,
      sum(oc.valor) as valor_na_venda,
      max(extract(epoch from (vp.fechado_em - vp.sale_created_at)) / 86400.0) as dias,
      bool_or(coalesce(d.n, 0) > 0) as teve_devolucao
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join vendas_periodo vp on vp.sale_id = o.sale_id
    left join devolucoes d on d.sale_id = vp.sale_id
    where oc.user_id is not null
    group by oc.user_id, vp.sale_id
  ), ranking_corretor_base as (
    select user_id as corretor_id,
      count(*) as vendas_fechadas,
      avg(dias) as tempo_medio_dias,
      count(*) filter (where teve_devolucao) as vendas_com_devolucao,
      sum(valor_na_venda) as comissao
    from participante_venda
    group by user_id
  ), unidade as (
    select p.corretor_id, coalesce(tm.team_id, tl.id) as team_id
    from (select distinct user_id as corretor_id from participante_venda) p
    left join team_members tm on tm.membro_id = p.corretor_id
    left join teams tl on tl.lider_id = p.corretor_id
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
      'comissao', comissao
    ) order by comissao desc, vendas_fechadas desc), '[]'::jsonb) as valor
    from ranking_corretor_full
  ), equipe_vendas as (
    select distinct u.team_id, p.sale_id, p.teve_devolucao
    from participante_venda p
    left join unidade u on u.corretor_id = p.user_id
  ), ranking_equipe_base as (
    select ev.team_id,
      count(*) as vendas_fechadas,
      count(*) filter (where ev.teve_devolucao) as vendas_com_devolucao,
      coalesce((select sum(r.comissao) from ranking_corretor_full r where r.team_id is not distinct from ev.team_id), 0) as comissao
    from equipe_vendas ev
    group by ev.team_id
  ), ranking_equipe as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'team_id', r.team_id,
      'team_nome', t.nome,
      'vendas_fechadas', r.vendas_fechadas,
      'comissao', r.comissao,
      'taxa_devolucao', round((100.0 * r.vendas_com_devolucao / nullif(r.vendas_fechadas, 0))::numeric, 0)
    ) order by r.comissao desc, r.vendas_fechadas desc), '[]'::jsonb) as valor
    from ranking_equipe_base r
    left join teams t on t.id = r.team_id
  ), captacoes as (
    select count(distinct id) as quantidade
    from sales
    where created_at >= _de::timestamptz
      and created_at < (_ate + 1)::timestamptz
      and status::text not in ('cancelada','arquivada')
  )
  select jsonb_build_object(
    'ranking_corretor', (select valor from ranking_corretor),
    'ranking_equipe', (select valor from ranking_equipe),
    'quantidade_captacoes', (select quantidade from captacoes)
  )
  where _de <= _ate
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

create or replace function public.desempenho_detalhe_periodo(
  _de date,
  _ate date,
  _corretor_id uuid default null,
  _team_id uuid default null,
  _sem_equipe boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with fechadas as (
    select distinct on (sale_id) sale_id, created_at as fechado_em
    from sale_status_history
    where para::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida')
    order by sale_id, created_at asc
  ), vendas_periodo as (
    select f.sale_id, f.fechado_em
    from fechadas f
    join sales s on s.id = f.sale_id
    where f.fechado_em >= _de::timestamptz
      and f.fechado_em < (_ate + 1)::timestamptz
      and s.status::text not in ('cancelada','arquivada')
  ), participantes as (
    select oc.user_id as corretor_id, vp.sale_id, sum(oc.valor) as valor_comissao, vp.fechado_em
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join vendas_periodo vp on vp.sale_id = o.sale_id
    where oc.user_id is not null
    group by oc.user_id, vp.sale_id, vp.fechado_em
  ), unidade as (
    select p.corretor_id, coalesce(tm.team_id, tl.id) as team_id
    from (select distinct corretor_id from participantes) p
    left join team_members tm on tm.membro_id = p.corretor_id
    left join teams tl on tl.lider_id = p.corretor_id
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
  from participantes p
  join sales s on s.id = p.sale_id
  left join unidade u on u.corretor_id = p.corretor_id
  where _de <= _ate and (
    (_corretor_id is not null and p.corretor_id = _corretor_id)
    or (_team_id is not null and u.team_id = _team_id)
    or (_sem_equipe and u.team_id is null)
  );
$$;

revoke execute on function public.resumo_desempenho_periodo(date, date) from public, anon;
revoke execute on function public.desempenho_ranking_periodo(date, date) from public, anon;
revoke execute on function public.desempenho_detalhe_periodo(date, date, uuid, uuid, boolean) from public, anon;
grant execute on function public.resumo_desempenho_periodo(date, date) to authenticated;
grant execute on function public.desempenho_ranking_periodo(date, date) to authenticated;
grant execute on function public.desempenho_detalhe_periodo(date, date, uuid, uuid, boolean) to authenticated;
