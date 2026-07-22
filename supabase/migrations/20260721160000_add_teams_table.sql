-- Da nome à equipe do gestor (team_members continua sendo a fonte de verdade de
-- quem está em cada equipe; teams só guarda o nome de exibição por lider_id).
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lider_id uuid NOT NULL UNIQUE,
  nome text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_pkey PRIMARY KEY (id),
  CONSTRAINT teams_lider_id_fkey FOREIGN KEY (lider_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams AS PERMISSIVE FOR SELECT TO authenticated USING (
  lider_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.lider_id = teams.lider_id AND tm.membro_id = auth.uid())
);

DROP POLICY IF EXISTS teams_write ON public.teams;
CREATE POLICY teams_write ON public.teams AS PERMISSIVE FOR ALL TO authenticated USING (
  (lider_id = auth.uid() AND has_role(auth.uid(), 'gestor'))
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
) WITH CHECK (
  (lider_id = auth.uid() AND has_role(auth.uid(), 'gestor'))
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
);

DROP TRIGGER IF EXISTS trg_teams_updated ON public.teams;
CREATE TRIGGER trg_teams_updated BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
