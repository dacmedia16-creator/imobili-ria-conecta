-- "Braço direito" do gestor: uma equipe pode ter, além do líder principal (teams.lider_id),
-- um ou mais líderes auxiliares. Eles têm exatamente as mesmas capacidades do líder principal,
-- mas só dentro dessa equipe (e sub-equipes dela) — o escopo continua 100% estrutural via
-- leads_team_or_parent/is_lead_of/sees_own_team_leader, que agora também olham essa tabela.
CREATE TABLE public.team_co_leaders (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

ALTER TABLE public.team_co_leaders ENABLE ROW LEVEL SECURITY;

-- Mesma exigência do líder principal (enforce_team_leader_role): só quem já tem papel
-- gestor/team_leader pode virar líder auxiliar. Também barra duplicar o próprio líder principal
-- como auxiliar (estado confuso, sem propósito).
CREATE OR REPLACE FUNCTION public.enforce_team_co_leader_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_any_role(NEW.user_id, ARRAY['gestor', 'team_leader']::public.app_role[]) THEN
    RAISE EXCEPTION 'O líder auxiliar de uma equipe precisa ter o papel gestor ou team leader.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.teams t WHERE t.id = NEW.team_id AND t.lider_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Essa pessoa já é o líder principal desta equipe.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE TRIGGER trg_enforce_team_co_leader_role
BEFORE INSERT OR UPDATE ON public.team_co_leaders
FOR EACH ROW EXECUTE FUNCTION public.enforce_team_co_leader_role();

-- Quem gerencia a equipe (renomear, adicionar/remover membro, adicionar/remover líder auxiliar)
-- já passa inteiro por essa função — atualizá-la aqui é o que dá ao líder auxiliar as mesmas
-- capacidades de gestão que o líder principal tem, escopadas a essa equipe (e sub-equipes).
CREATE OR REPLACE FUNCTION public.leads_team_or_parent(_team_id uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = _team_id AND (
      t.lider_id = _user
      OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = t.id AND cl.user_id = _user)
      OR EXISTS (
        SELECT 1 FROM public.teams pt
        WHERE pt.id = t.parent_team_id
        AND (pt.lider_id = _user OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = pt.id AND cl.user_id = _user))
      )
    )
  )
$function$;

-- Fonte estrutural de quase toda permissão de gestor/team_leader sobre uma VENDA (can_view_sale,
-- delete_sales_por_papel, sales_select) — precisa enxergar o líder auxiliar igual ao principal.
CREATE OR REPLACE FUNCTION public.is_lead_of(_lider uuid, _membro uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    LEFT JOIN public.teams pt ON pt.id = t.parent_team_id
    WHERE tm.membro_id = _membro AND (
      t.lider_id = _lider
      OR pt.lider_id = _lider
      OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = t.id AND cl.user_id = _lider)
      OR (pt.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = pt.id AND cl.user_id = _lider))
    )
  )
$function$;

-- Deixa o corretor ver o profile (nome/avatar) do líder auxiliar, igual já via o do principal.
CREATE OR REPLACE FUNCTION public.sees_own_team_leader(_profile_id uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    LEFT JOIN public.teams pt ON pt.id = t.parent_team_id
    WHERE tm.membro_id = _user AND (
      t.lider_id = _profile_id
      OR pt.lider_id = _profile_id
      OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = t.id AND cl.user_id = _profile_id)
      OR (pt.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = pt.id AND cl.user_id = _profile_id))
    )
  )
$function$;

-- team_co_leaders em si: mesmo shape de RLS de team_members (admin, quem já lidera a equipe/mãe,
-- ou quem enxerga a equipe por outro motivo).
CREATE POLICY team_co_leaders_select ON public.team_co_leaders FOR SELECT TO authenticated
USING (
  has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::app_role[])
  OR sees_team(team_id, (SELECT auth.uid()))
);

CREATE POLICY team_co_leaders_write ON public.team_co_leaders FOR ALL TO authenticated
USING (
  has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::app_role[])
  OR leads_team_or_parent(team_id, (SELECT auth.uid()))
)
WITH CHECK (
  has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::app_role[])
  OR leads_team_or_parent(team_id, (SELECT auth.uid()))
);
