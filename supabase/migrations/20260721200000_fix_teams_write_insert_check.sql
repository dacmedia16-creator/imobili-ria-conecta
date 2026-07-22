-- teams_write.WITH CHECK usava leads_team_or_parent(teams.id, auth.uid()), que consulta a
-- própria tabela teams por id — pra um INSERT novo essa linha ainda não existe na hora do
-- check, então TODO gestor tomava "new row violates row-level security policy" ao criar
-- qualquer equipe. Pro WITH CHECK, usa as colunas da linha nova direto (lider_id) em vez de
-- reconsultar a tabela por id; a checagem via parent_team_id continua útil (equipe já existe).
DROP POLICY IF EXISTS teams_write ON public.teams;
CREATE POLICY teams_write ON public.teams AS PERMISSIVE FOR ALL TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR leads_team_or_parent(teams.id, auth.uid())
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR lider_id = auth.uid()
  OR (parent_team_id IS NOT NULL AND leads_team_or_parent(parent_team_id, auth.uid()))
);
