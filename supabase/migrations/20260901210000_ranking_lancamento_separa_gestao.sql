-- Separa a gestão de lançamentos do resultado das equipes.
-- A participação de coordenador continua no ranking individual, mas não cria
-- venda nem comissão para uma equipe. O crédito de equipe nasce somente das
-- participações comerciais e só existe quando a equipe possui membros.

create or replace function public.desempenho_ranking_periodo(_de date, _ate date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with vendas_periodo as (
    select
      v.sale_id,
      v.venda_em as fechado_em,
      s.created_at as sale_created_at,
      s.modalidade::text as modalidade
    from public.vendas_comerciais_validas() v
    join sales s on s.id = v.sale_id
    where v.venda_em >= _de::timestamptz
      and v.venda_em < (_ate + 1)::timestamptz
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
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$$;

revoke execute on function public.desempenho_ranking_periodo(date, date) from public, anon;
grant execute on function public.desempenho_ranking_periodo(date, date) to authenticated;
