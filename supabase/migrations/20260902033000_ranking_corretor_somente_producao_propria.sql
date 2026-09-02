-- O ranking "Por corretor" representa somente producao pessoal.
-- Lideranca, indicacao, gestao e outros papeis continuam nos controles financeiros
-- e no ranking por equipe, sem inflar vendas ou comissao pessoais.

create or replace function public.desempenho_ranking_corretor_proprio_periodo(_de date, _ate date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with vendas_periodo as (
    select v.sale_id, v.venda_em as fechado_em, s.created_at as sale_created_at
    from public.vendas_comerciais_validas() v
    join sales s on s.id = v.sale_id
    where v.venda_em >= _de::timestamptz
      and v.venda_em < (_ate + 1)::timestamptz
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
$$;

create or replace function public.desempenho_detalhe_corretor_proprio_periodo(
  _de date, _ate date, _corretor_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with vendas_periodo as (
    select v.sale_id, v.venda_em as fechado_em
    from public.vendas_comerciais_validas() v
    where v.venda_em >= _de::timestamptz
      and v.venda_em < (_ate + 1)::timestamptz
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
$$;

revoke execute on function public.desempenho_ranking_corretor_proprio_periodo(date,date) from public, anon;
revoke execute on function public.desempenho_detalhe_corretor_proprio_periodo(date,date,uuid) from public, anon;
grant execute on function public.desempenho_ranking_corretor_proprio_periodo(date,date) to authenticated;
grant execute on function public.desempenho_detalhe_corretor_proprio_periodo(date,date,uuid) to authenticated;
