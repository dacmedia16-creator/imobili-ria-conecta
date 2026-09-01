-- Alinha a meta mensal antiga (ainda usada no Dashboard e em Equipes) à mesma
-- fonte canônica dos relatórios por período.
create or replace function public.metas_progresso(_mes date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with janela as (
    select date_trunc('month', _mes)::date inicio,
      (date_trunc('month', _mes) + interval '1 month')::date fim
  ), comissao_corretor as (
    select oc.user_id corretor_id, sum(oc.valor) total
    from public.vendas_comerciais_validas() v
    join occurrences o on o.sale_id = v.sale_id
    join occurrence_commissions oc on oc.occurrence_id = o.id
    cross join janela j
    where oc.user_id is not null
      and v.venda_em >= j.inicio::timestamptz and v.venda_em < j.fim::timestamptz
    group by oc.user_id
  ), unidade as (
    select cc.corretor_id, coalesce(tm.team_id, tl.id) team_id, cc.total
    from comissao_corretor cc
    left join team_members tm on tm.membro_id = cc.corretor_id
    left join teams tl on tl.lider_id = cc.corretor_id
  ), comissao_equipe as (
    select team_id, sum(total) total from unidade group by team_id
  )
  select jsonb_build_object(
    'corretor', coalesce((select jsonb_agg(jsonb_build_object(
      'corretor_id', m.corretor_id, 'meta_comissao', m.meta_comissao,
      'comissao_realizada', coalesce(cc.total, 0)
    )) from metas m left join comissao_corretor cc on cc.corretor_id = m.corretor_id
      where m.tipo = 'corretor' and m.mes = (select inicio from janela)), '[]'::jsonb),
    'equipe', coalesce((select jsonb_agg(jsonb_build_object(
      'team_id', m.team_id, 'meta_comissao', m.meta_comissao,
      'comissao_realizada', coalesce(ce.total, 0)
    )) from metas m left join comissao_equipe ce on ce.team_id = m.team_id
      where m.tipo = 'equipe' and m.mes = (select inicio from janela)), '[]'::jsonb)
  );
$$;

revoke execute on function public.metas_progresso(date) from public, anon;
grant execute on function public.metas_progresso(date) to authenticated;
