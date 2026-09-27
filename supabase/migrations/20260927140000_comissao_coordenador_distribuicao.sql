-- Grupo 3 (item 15 + itens 1-3 nesta tela, decisões de Denis 27/09/2026).
-- comissao_coordenador_dados(p_mes):
--  * mês = mês da ASSINATURA em America/Sao_Paulo (base canônica vendas_comerciais_validas:
--    último contrato_assinado; Lançamento = sales.data_assinatura), não mais o da conclusão;
--  * cada linha passa a trazer o cargo da pessoa (cargo_gestor/cargo_team_leader) e os líderes das
--    equipes do corretor (lideres_equipe), para que o front não leia user_roles com a sessão do
--    usuário — a RLS de user_roles escondia os cargos de quem é só Financeiro (erro E2);
--  * ordem determinística (jsonb_agg ORDER BY), eliminando a alternância de dono (erro E1).
-- SECURITY DEFINER apenas para ler cargos/equipes; a checagem de papel (financeiro/admin/
-- super_admin) continua dentro da função, search_path fixo, ACL inalterada (authenticated).
-- Rollback: docs/sql/rollback/20260927140000_*.rollback.sql (pg_get_functiondef anterior).
CREATE OR REPLACE FUNCTION public.comissao_coordenador_dados(p_mes date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with occs as (
    select o.id as occurrence_id, s.modalidade::text as modalidade
    from public.vendas_comerciais_validas() v
    join public.sales s on s.id = v.sale_id
    join public.occurrences o on o.sale_id = s.id
    where o.status = 'concluida'
      and s.status::text not in ('cancelada', 'arquivada')
      and v.venda_em >= (date_trunc('month', p_mes)::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((date_trunc('month', p_mes) + interval '1 month')::timestamp at time zone 'America/Sao_Paulo')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrence_id', oc.occurrence_id,
    'modalidade', occs.modalidade,
    'papel', oc.papel,
    'user_id', oc.user_id,
    'nome', p.nome,
    'valor', oc.valor,
    'sem_cadastro_confirmado', coalesce(oc.sem_cadastro_confirmado, false),
    'cargo_gestor', exists (select 1 from public.user_roles r where r.user_id = oc.user_id and r.role = 'gestor'),
    'cargo_team_leader', exists (select 1 from public.user_roles r where r.user_id = oc.user_id and r.role = 'team_leader'),
    'lideres_equipe', coalesce((
      select jsonb_agg(distinct t.lider_id)
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      where tm.membro_id = oc.user_id and t.lider_id is not null
    ), '[]'::jsonb)
  ) order by oc.occurrence_id, oc.papel, oc.user_id nulls last, oc.valor), '[]'::jsonb)
  from public.occurrence_commissions oc
  join occs on occs.occurrence_id = oc.occurrence_id
  left join public.profiles p on p.id = oc.user_id
  where public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]);
$function$
;
