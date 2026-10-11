-- Blindagem: teams_select ainda dependia só de sees_team(id, auth.uid()), que reconsulta a
-- tabela por id. Pra uma linha recém-inserida (ex.: INSERT ... RETURNING, ou um futuro
-- .insert().select() no client), essa reconsulta não enxerga a própria linha e a checagem de
-- SELECT implícita do RETURNING falha, mesmo o INSERT em si sendo permitido. Adiciona um
-- atalho direto por coluna (lider_id = auth.uid()) que não depende de reconsultar a tabela.
DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams AS PERMISSIVE FOR SELECT TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR lider_id = auth.uid()
  OR sees_team(teams.id, auth.uid())
);
