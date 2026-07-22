-- Líder precisa ter papel gestor
CREATE OR REPLACE FUNCTION public.enforce_team_leader_role()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(NEW.lider_id, 'gestor') THEN
    RAISE EXCEPTION 'O líder de uma equipe precisa ter o papel gestor.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

-- Só 1 nível de sub-equipes
CREATE OR REPLACE FUNCTION public.enforce_team_depth()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.parent_team_id IS NOT NULL THEN
    IF NEW.parent_team_id = NEW.id THEN
      RAISE EXCEPTION 'Uma equipe não pode ser sub-equipe dela mesma.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.teams t WHERE t.id = NEW.parent_team_id AND t.parent_team_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Só é permitido 1 nível de sub-equipes.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- teams: novas colunas
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_lider_id_key;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS cor text NOT NULL DEFAULT '#6366f1';
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS parent_team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;

DROP TRIGGER IF EXISTS trg_teams_leader_role ON public.teams;
CREATE TRIGGER trg_teams_leader_role BEFORE INSERT OR UPDATE OF lider_id ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_team_leader_role();
DROP TRIGGER IF EXISTS trg_teams_depth ON public.teams;
CREATE TRIGGER trg_teams_depth BEFORE INSERT OR UPDATE OF parent_team_id ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_team_depth();

-- team_members: adiciona e faz backfill de team_id a partir do lider_id atual
ALTER TABLE public.team_members ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;
INSERT INTO public.teams (lider_id, nome, cor)
SELECT DISTINCT tm.lider_id, COALESCE(NULLIF(p.nome, ''), 'Equipe'), '#6366f1'
FROM public.team_members tm
LEFT JOIN public.profiles p ON p.id = tm.lider_id
WHERE tm.team_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.lider_id = tm.lider_id);
UPDATE public.team_members tm SET team_id = t.id FROM public.teams t WHERE t.lider_id = tm.lider_id AND tm.team_id IS NULL;

-- Derruba ANTES do DROP COLUMN toda policy que ainda referencia team_members.lider_id
-- (profiles_self_select deixava o corretor ver o perfil do próprio líder — descoberto só
-- em tempo de aplicação, não estava documentado no dump antigo de docs/schema.sql).
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
DROP POLICY IF EXISTS team_view ON public.team_members;
DROP POLICY IF EXISTS teams_select ON public.teams;
DROP POLICY IF EXISTS team_admin_write ON public.team_members;
DROP POLICY IF EXISTS teams_write ON public.teams;

ALTER TABLE public.team_members ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_membro_id_lider_id_key;
ALTER TABLE public.team_members ADD CONSTRAINT team_members_membro_id_key UNIQUE (membro_id);
ALTER TABLE public.team_members DROP COLUMN IF EXISTS lider_id;

-- is_lead_of passa a navegar por teams (+ 1 nível de parent) — mesma assinatura
CREATE OR REPLACE FUNCTION public.is_lead_of(_lider uuid, _membro uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    LEFT JOIN public.teams pt ON pt.id = t.parent_team_id
    WHERE tm.membro_id = _membro AND (t.lider_id = _lider OR pt.lider_id = _lider)
  )
$function$;

-- profiles_self_select: mesma regra de antes (corretor vê o perfil do próprio líder),
-- adaptada pra team_id e estendida ao líder da equipe-mãe (hierarquia de 1 nível).
CREATE POLICY profiles_self_select ON public.profiles AS PERMISSIVE FOR SELECT USING (
  (id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['gestor'::app_role, 'juridico'::app_role, 'financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])
  OR EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    LEFT JOIN public.teams pt ON pt.id = t.parent_team_id
    WHERE tm.membro_id = auth.uid() AND (t.lider_id = profiles.id OR pt.lider_id = profiles.id)
  )
);

-- RLS: qualquer gestor/admin/super_admin gerencia qualquer equipe (só 2 gestores hoje —
-- silo por equipe própria seria over-engineering); corretor só lê a equipe onde está.
CREATE POLICY teams_select ON public.teams AS PERMISSIVE FOR SELECT TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['gestor','admin','super_admin']::app_role[])
  OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = teams.id AND tm.membro_id = auth.uid())
);
CREATE POLICY teams_write ON public.teams AS PERMISSIVE FOR ALL TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['gestor','admin','super_admin']::app_role[])
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['gestor','admin','super_admin']::app_role[])
);

CREATE POLICY team_members_select ON public.team_members AS PERMISSIVE FOR SELECT TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['gestor','admin','super_admin']::app_role[]) OR membro_id = auth.uid()
);
CREATE POLICY team_members_write ON public.team_members AS PERMISSIVE FOR ALL TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['gestor','admin','super_admin']::app_role[])
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['gestor','admin','super_admin']::app_role[])
);
