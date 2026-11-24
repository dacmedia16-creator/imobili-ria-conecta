-- Rollback de 20261231120000_metas_lider_sem_equipe.sql (t_a897136b): metas_equipe_escopo volta ao corpo de
-- 20261207120000 (= produção 23/11, md5 244f48d97b231e5112c85e0e98566919). Quem lidera sem equipe vigente volta
-- para "Sem equipe" no painel Metas 2027 · Equipes. Nenhum dado muda.
BEGIN;

CREATE OR REPLACE FUNCTION public.metas_equipe_escopo(_team_id uuid)
RETURNS TABLE(user_id uuid, team_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _org uuid := public.current_org_id(); _times uuid[]; _broker boolean;
BEGIN
  _times := public.metas_equipe_times();   -- recusa quem não pode
  _broker := public.metas_equipe_broker();
  IF _team_id IS NOT NULL AND NOT (_team_id = ANY (_times)) THEN
    RAISE EXCEPTION 'Sem acesso a esta equipe' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH gente AS (
    SELECT m.user_id, public.equipe_vigente(m.user_id, now()) AS ev
      FROM public.organization_members m
      JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
     WHERE m.organization_id = _org AND m.ativo
       AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = m.user_id AND ur.organization_id = _org
                     AND ur.role IN ('corretor', 'team_leader', 'gestor'))),
  g AS (SELECT gente.user_id, CASE WHEN gente.ev = ANY (_times) THEN gente.ev END AS team_id FROM gente)
  SELECT g.user_id, g.team_id
    FROM g
   WHERE (_team_id IS NULL OR g.team_id = _team_id)
     AND (_broker OR g.team_id = ANY (_times));
END $function$;
REVOKE ALL ON FUNCTION public.metas_equipe_escopo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metas_equipe_escopo(uuid) TO service_role;

COMMIT;
