-- Gestor e Team Leader: Minha equipe como visão principal e Empresa como consolidado secundário.
-- As funções de equipe permanecem security invoker (RLS limita à equipe do usuário).
-- As funções de empresa são security definer, mas devolvem somente dados agregados e sanitizados.

do $$
declare
  fn regprocedure;
  definition text;
begin
  foreach fn in array array[
    'public.resumo_desempenho_periodo(date,date)'::regprocedure,
    'public.desempenho_ranking_periodo(date,date)'::regprocedure,
    'public.comissoes_carteira_periodo(date,date)'::regprocedure,
    'public.desempenho_contexto_periodo(date,date)'::regprocedure,
    'public.metas_progresso_periodo(date,date)'::regprocedure
  ] loop
    definition := pg_get_functiondef(fn);
    definition := replace(
      definition,
      'array[''financeiro'',''admin'',''super_admin'']::app_role[]',
      'array[''financeiro'',''admin'',''super_admin'',''gestor'',''team_leader'']::app_role[]'
    );
    if definition not like '%''gestor'',''team_leader'']::app_role[]%' then
      raise exception 'Não foi possível ampliar com segurança a função %', fn;
    end if;
    execute definition;
  end loop;
end $$;

create or replace function public.desempenho_equipe_resumo_periodo(_de date, _ate date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  select case when has_any_role(auth.uid(), array['gestor','team_leader']::app_role[])
    then public.resumo_desempenho_periodo(_de, _ate)
      || jsonb_build_object('parte_unidade', 0, 'receita_liquida_imobiliaria', 0)
    else null end;
$$;

create or replace function public.desempenho_equipe_ranking_periodo(_de date, _ate date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  select case when has_any_role(auth.uid(), array['gestor','team_leader']::app_role[])
    then public.desempenho_ranking_periodo(_de, _ate) else null end;
$$;

create or replace function public.desempenho_equipe_carteira_periodo(_de date, _ate date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  select case when has_any_role(auth.uid(), array['gestor','team_leader']::app_role[])
    then public.comissoes_carteira_periodo(_de, _ate)
      || jsonb_build_object(
        'liquido_imobiliaria_prevista_total', 0,
        'liquido_imobiliaria_concluida_total', 0
      )
    else null end;
$$;

create or replace function public.desempenho_equipe_contexto_periodo(_de date, _ate date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  select case when has_any_role(auth.uid(), array['gestor','team_leader']::app_role[])
    then public.desempenho_contexto_periodo(_de, _ate) else null end;
$$;

create or replace function public.desempenho_equipe_metas_periodo(_de date, _ate date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  select case when has_any_role(auth.uid(), array['gestor','team_leader']::app_role[])
    then public.metas_progresso_periodo(_de, _ate) else null end;
$$;

create or replace function public.desempenho_empresa_resumo_periodo(_de date, _ate date)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when has_any_role(auth.uid(), array['gestor','team_leader']::app_role[])
    then public.resumo_desempenho_periodo(_de, _ate)
      || jsonb_build_object('parte_unidade', 0, 'receita_liquida_imobiliaria', 0)
    else null end;
$$;

create or replace function public.desempenho_empresa_ranking_periodo(_de date, _ate date)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when has_any_role(auth.uid(), array['gestor','team_leader']::app_role[])
    then public.desempenho_ranking_periodo(_de, _ate) - 'ranking_corretor'
      || jsonb_build_object('ranking_corretor', '[]'::jsonb)
    else null end;
$$;

create or replace function public.desempenho_empresa_carteira_periodo(_de date, _ate date)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when has_any_role(auth.uid(), array['gestor','team_leader']::app_role[])
    then public.comissoes_carteira_periodo(_de, _ate)
      || jsonb_build_object(
        'liquido_imobiliaria_prevista_total', 0,
        'liquido_imobiliaria_concluida_total', 0,
        'comissao_por_corretor', '{}'::jsonb
      )
    else null end;
$$;

create or replace function public.desempenho_empresa_contexto_periodo(_de date, _ate date)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when has_any_role(auth.uid(), array['gestor','team_leader']::app_role[])
    then public.desempenho_contexto_periodo(_de, _ate) - 'whatsapp'
      || jsonb_build_object('whatsapp', null)
    else null end;
$$;

create or replace function public.desempenho_empresa_metas_periodo(_de date, _ate date)
returns jsonb language sql stable security definer set search_path = public
as $$
  select case when has_any_role(auth.uid(), array['gestor','team_leader']::app_role[])
    then public.metas_progresso_periodo(_de, _ate) - 'corretor'
      || jsonb_build_object('corretor', '[]'::jsonb)
    else null end;
$$;

revoke execute on function public.desempenho_equipe_resumo_periodo(date,date) from public, anon;
revoke execute on function public.desempenho_equipe_ranking_periodo(date,date) from public, anon;
revoke execute on function public.desempenho_equipe_carteira_periodo(date,date) from public, anon;
revoke execute on function public.desempenho_equipe_contexto_periodo(date,date) from public, anon;
revoke execute on function public.desempenho_equipe_metas_periodo(date,date) from public, anon;
revoke execute on function public.desempenho_empresa_resumo_periodo(date,date) from public, anon;
revoke execute on function public.desempenho_empresa_ranking_periodo(date,date) from public, anon;
revoke execute on function public.desempenho_empresa_carteira_periodo(date,date) from public, anon;
revoke execute on function public.desempenho_empresa_contexto_periodo(date,date) from public, anon;
revoke execute on function public.desempenho_empresa_metas_periodo(date,date) from public, anon;

grant execute on function public.desempenho_equipe_resumo_periodo(date,date) to authenticated;
grant execute on function public.desempenho_equipe_ranking_periodo(date,date) to authenticated;
grant execute on function public.desempenho_equipe_carteira_periodo(date,date) to authenticated;
grant execute on function public.desempenho_equipe_contexto_periodo(date,date) to authenticated;
grant execute on function public.desempenho_equipe_metas_periodo(date,date) to authenticated;
grant execute on function public.desempenho_empresa_resumo_periodo(date,date) to authenticated;
grant execute on function public.desempenho_empresa_ranking_periodo(date,date) to authenticated;
grant execute on function public.desempenho_empresa_carteira_periodo(date,date) to authenticated;
grant execute on function public.desempenho_empresa_contexto_periodo(date,date) to authenticated;
grant execute on function public.desempenho_empresa_metas_periodo(date,date) to authenticated;
