-- Gestor passa a ver/gerenciar só a própria equipe (equipes que ele lidera + a relação de
-- 1 nível com elas: se ele lidera a equipe-mãe, também gerencia as sub-equipes; se ele lidera
-- uma sub-equipe, ainda enxerga a equipe-mãe pra dar contexto, mas sem poder editá-la).
-- Admin/super_admin continuam com acesso total a todas as equipes.
DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams AS PERMISSIVE FOR SELECT TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR lider_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.teams pt WHERE pt.id = teams.parent_team_id AND pt.lider_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.teams ct WHERE ct.parent_team_id = teams.id AND ct.lider_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = teams.id AND tm.membro_id = auth.uid())
);

DROP POLICY IF EXISTS teams_write ON public.teams;
CREATE POLICY teams_write ON public.teams AS PERMISSIVE FOR ALL TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR lider_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.teams pt WHERE pt.id = teams.parent_team_id AND pt.lider_id = auth.uid())
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR lider_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.teams pt WHERE pt.id = teams.parent_team_id AND pt.lider_id = auth.uid())
);

DROP POLICY IF EXISTS team_members_select ON public.team_members;
CREATE POLICY team_members_select ON public.team_members AS PERMISSIVE FOR SELECT TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR membro_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_members.team_id AND (
      t.lider_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.teams pt WHERE pt.id = t.parent_team_id AND pt.lider_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.teams ct WHERE ct.parent_team_id = t.id AND ct.lider_id = auth.uid())
    )
  )
);

DROP POLICY IF EXISTS team_members_write ON public.team_members;
CREATE POLICY team_members_write ON public.team_members AS PERMISSIVE FOR ALL TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_members.team_id AND (
      t.lider_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.teams pt WHERE pt.id = t.parent_team_id AND pt.lider_id = auth.uid())
    )
  )
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = team_members.team_id AND (
      t.lider_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.teams pt WHERE pt.id = t.parent_team_id AND pt.lider_id = auth.uid())
    )
  )
);
