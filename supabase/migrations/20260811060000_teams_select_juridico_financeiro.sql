-- Jurídico e financeiro agora têm filtro por equipe na lista de vendas (junto com admin/super
-- admin, que já enxergavam tudo). Sem leitura de teams/team_members, o seletor de equipe ficava
-- vazio pra esses dois papéis, mesmo eles já enxergando vendas de todas as equipes via sales_select.
-- Só SELECT: continuam sem poder criar/editar/apagar equipe (teams_write/team_members_write
-- inalterados).
DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams AS PERMISSIVE FOR SELECT TO authenticated USING ((has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role, 'juridico'::app_role, 'financeiro'::app_role]) OR (lider_id = (select auth.uid())) OR sees_team(id, (select auth.uid()))));

DROP POLICY IF EXISTS team_members_select ON public.team_members;
CREATE POLICY team_members_select ON public.team_members AS PERMISSIVE FOR SELECT TO authenticated USING ((has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role, 'juridico'::app_role, 'financeiro'::app_role]) OR (membro_id = (select auth.uid())) OR sees_team(team_id, (select auth.uid()))));
