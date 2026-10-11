-- As policies de teams/team_members/profiles ficaram se checando mutuamente via EXISTS direto
-- (teams_select consulta team_members, team_members_select consulta teams, profiles_self_select
-- consulta as duas) — Postgres detecta isso como recursão infinita (42P17) e a query inteira
-- falha. Corrige movendo essas checagens pra funções SECURITY DEFINER (mesmo padrão já usado
-- por has_role/has_any_role/is_lead_of/can_view_sale), que rodam com o dono da função e não
-- reavaliam RLS das tabelas que consultam por dentro.

CREATE OR REPLACE FUNCTION public.leads_team_or_parent(_team_id uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = _team_id AND (
      t.lider_id = _user
      OR EXISTS (SELECT 1 FROM public.teams pt WHERE pt.id = t.parent_team_id AND pt.lider_id = _user)
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.sees_team(_team_id uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.leads_team_or_parent(_team_id, _user)
    OR EXISTS (SELECT 1 FROM public.teams ct WHERE ct.parent_team_id = _team_id AND ct.lider_id = _user)
    OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = _team_id AND tm.membro_id = _user)
$function$;

CREATE OR REPLACE FUNCTION public.sees_own_team_leader(_profile_id uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    LEFT JOIN public.teams pt ON pt.id = t.parent_team_id
    WHERE tm.membro_id = _user AND (t.lider_id = _profile_id OR pt.lider_id = _profile_id)
  )
$function$;

DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams AS PERMISSIVE FOR SELECT TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR public.sees_team(teams.id, auth.uid())
);

DROP POLICY IF EXISTS teams_write ON public.teams;
CREATE POLICY teams_write ON public.teams AS PERMISSIVE FOR ALL TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR public.leads_team_or_parent(teams.id, auth.uid())
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR public.leads_team_or_parent(teams.id, auth.uid())
);

DROP POLICY IF EXISTS team_members_select ON public.team_members;
CREATE POLICY team_members_select ON public.team_members AS PERMISSIVE FOR SELECT TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR membro_id = auth.uid()
  OR public.sees_team(team_members.team_id, auth.uid())
);

DROP POLICY IF EXISTS team_members_write ON public.team_members;
CREATE POLICY team_members_write ON public.team_members AS PERMISSIVE FOR ALL TO authenticated USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR public.leads_team_or_parent(team_members.team_id, auth.uid())
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR public.leads_team_or_parent(team_members.team_id, auth.uid())
);

DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles AS PERMISSIVE FOR SELECT USING (
  (id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['gestor'::app_role, 'juridico'::app_role, 'financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])
  OR public.sees_own_team_leader(profiles.id, auth.uid())
);
