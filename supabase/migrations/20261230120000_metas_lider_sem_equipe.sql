-- Metas 2027 · Equipes: a meta de quem LIDERA uma equipe, mas não tem equipe vigente, cai na equipe que ele lidera
-- (cartão t_a897136b; Denis 23/11/2026, tópico 6238, opção "1"; diagnóstico t_15f1b552).
--
-- Caso real: Aline de Souza Rodrigues (Única) tem papel gestor (sem team_leader), a equipe dela não tem membros e
-- não há histórico. equipe_vigente() devolve NULL, metas_equipe_escopo devolvia team_id NULL e a meta dela ia para
-- "Sem equipe"; a aba com o nome dela ficava vazia. Em 23/11 ela é a ÚNICA pessoa nessa situação (todas as orgs).
--
-- Mudança: só metas_equipe_escopo. A equipe vigente continua mandando; a equipe liderada (mesma imobiliária, a
-- mais antiga, como em equipe_vigente) só entra quando a vigente vem NULL. equipe_vigente NÃO muda (comissões,
-- Produção por pessoa e outras telas a usam). Papéis, equipes e permissões NÃO mudam: o resultado continua
-- filtrado por metas_equipe_times/metas_equipe_broker, como antes. Dono, SECURITY DEFINER, search_path e ACL iguais.
--
-- Rollback: supabase/rollback/20261230120000_metas_lider_sem_equipe.sql (corpo de 20261207120000 = produção 23/11,
-- md5 244f48d97b231e5112c85e0e98566919). Suíte: supabase/tests/run-metas-lider-sem-equipe.sh (MIG=… = controle negativo).
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
    -- t_a897136b: sem equipe vigente, vale a equipe que a pessoa lidera nesta imobiliária (a mais antiga).
    SELECT m.user_id,
           coalesce(public.equipe_vigente(m.user_id, now()),
                    (SELECT t.id FROM public.teams t
                      WHERE t.lider_id = m.user_id AND t.organization_id = _org
                      ORDER BY t.created_at LIMIT 1)) AS ev
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
