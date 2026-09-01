-- Fonte canônica de atribuição comercial por participante.
-- Gestão de lançamento conta no individual, mas nunca cria resultado de equipe.
-- Uma liderança só representa equipe quando a equipe possui ao menos um membro.
create or replace function public.participacoes_comerciais_validas()
returns table (
  sale_id uuid, venda_em timestamptz, user_id uuid,
  valor_individual numeric, valor_equipe numeric, conta_equipe boolean, team_id uuid
)
language sql stable security invoker set search_path = public
as $$
  with por_pessoa as (
    select v.sale_id, v.venda_em, oc.user_id,
      sum(oc.valor) as valor_individual,
      coalesce(sum(oc.valor) filter (where oc.papel <> 'coordenador_lancamento'), 0) as valor_equipe,
      bool_or(oc.papel <> 'coordenador_lancamento') as conta_equipe
    from public.vendas_comerciais_validas() v
    join occurrences o on o.sale_id = v.sale_id
    join occurrence_commissions oc on oc.occurrence_id = o.id
    where oc.user_id is not null and coalesce(oc.sem_cadastro_confirmado, false) = false
    group by v.sale_id, v.venda_em, oc.user_id
  )
  select p.sale_id, p.venda_em, p.user_id, p.valor_individual, p.valor_equipe, p.conta_equipe,
    case when p.conta_equipe then coalesce(tm.team_id, tl.id) end as team_id
  from por_pessoa p
  left join team_members tm on tm.membro_id = p.user_id
  left join lateral (
    select t.id from teams t join team_members m on m.team_id = t.id
    where t.lider_id = p.user_id
    group by t.id, t.created_at order by t.created_at limit 1
  ) tl on tm.team_id is null;
$$;

revoke execute on function public.participacoes_comerciais_validas() from public, anon;
grant execute on function public.participacoes_comerciais_validas() to authenticated;

create or replace function public.atribuicao_comercial_resumo()
returns jsonb language sql stable security invoker set search_path = public
as $$
  with p as (select * from public.participacoes_comerciais_validas()),
  base as (
    select p.*,
      case when m.comissao_bruta > 0 then
        greatest(m.vgv, 0) * least(greatest(m.comissao_bruta - m.parceria_externa, 0) / m.comissao_bruta, 1)
      else 0 end as vgv_proprio,
      sum(p.valor_individual) over (partition by p.sale_id) total_individual
    from p join public.metricas_venda_sem_parceria() m on m.sale_id = p.sale_id
  ), pessoa as (
    select user_id, (array_agg(team_id) filter (where team_id is not null))[1] team_id,
      count(distinct sale_id) vendas,
      sum(valor_individual) comissao,
      sum(case when total_individual > 0 then vgv_proprio * valor_individual / total_individual else 0 end) vgv
    from base group by user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', user_id, 'team_id', team_id, 'vendas', vendas,
    'comissao', comissao, 'vgv', vgv
  ) order by comissao desc), '[]'::jsonb) from pessoa;
$$;

revoke execute on function public.atribuicao_comercial_resumo() from public, anon;
grant execute on function public.atribuicao_comercial_resumo() to authenticated;

create or replace function public.metas_progresso_periodo(_de date, _ate date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with p as (
    select * from public.participacoes_comerciais_validas()
    where venda_em >= _de::timestamptz and venda_em < (_ate + 1)::timestamptz
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
$$;

create or replace function public.metas_progresso(_mes date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  select public.metas_progresso_periodo(
    date_trunc('month', _mes)::date,
    (date_trunc('month', _mes) + interval '1 month - 1 day')::date
  );
$$;

create or replace function public.desempenho_detalhe_periodo(
  _de date, _ate date, _corretor_id uuid default null,
  _team_id uuid default null, _sem_equipe boolean default false
)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with p as (
    select * from public.participacoes_comerciais_validas()
    where venda_em >= _de::timestamptz and venda_em < (_ate + 1)::timestamptz
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
$$;

revoke execute on function public.metas_progresso_periodo(date,date) from public, anon;
revoke execute on function public.metas_progresso(date) from public, anon;
revoke execute on function public.desempenho_detalhe_periodo(date,date,uuid,uuid,boolean) from public, anon;
grant execute on function public.metas_progresso_periodo(date,date) to authenticated;
grant execute on function public.metas_progresso(date) to authenticated;
grant execute on function public.desempenho_detalhe_periodo(date,date,uuid,uuid,boolean) to authenticated;

drop function if exists public.visao_executiva_stats();
drop function if exists public.visao_executiva_detalhe_comissao(uuid, uuid, boolean);
drop function if exists public.resumo_operacao_sem_parceria_30d();
drop function if exists public.comissoes_carteira_sem_parceria();
