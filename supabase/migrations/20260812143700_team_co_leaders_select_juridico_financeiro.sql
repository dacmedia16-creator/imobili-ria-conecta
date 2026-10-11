-- Mesma lacuna corrigida antes pra teams/team_members: o filtro por equipe na lista de vendas
-- (jurídico/financeiro/admin/super admin) agora também soma o(s) líder(es) auxiliar(es) de cada
-- equipe ao calcular quem pertence a ela — sem SELECT liberado aqui, a query de team_co_leaders
-- voltava vazia pra jurídico/financeiro (RLS só liberava admin/super_admin ou quem já lidera a
-- própria equipe via sees_team).
DROP POLICY IF EXISTS team_co_leaders_select ON public.team_co_leaders;
CREATE POLICY team_co_leaders_select ON public.team_co_leaders FOR SELECT TO authenticated
USING (
  has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin','juridico','financeiro']::app_role[])
  OR sees_team(team_id, (SELECT auth.uid()))
);
