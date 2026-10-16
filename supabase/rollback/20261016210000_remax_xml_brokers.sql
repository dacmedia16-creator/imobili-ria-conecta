-- Rollback de 20261016210000_remax_xml_brokers (t_e8265cce). Volta o cruzamento para a versão de 20261016200000
-- (calculada na hora, sem tabelas). ATENÇÃO: apaga o cadastro do XML, os vínculos e a lista de revisão.
BEGIN;
DROP TRIGGER IF EXISTS remax_xml_runs_broker_sync ON public.remax_xml_runs;
DROP FUNCTION IF EXISTS public.remax_xml_runs_broker_sync();
DROP FUNCTION IF EXISTS public.remax_xml_revisao_resolver(uuid, text);
DROP FUNCTION IF EXISTS public.remax_xml_broker_sync(uuid, uuid);

-- remax_xml_broker_match original (copiado de 20261016200000)
CREATE OR REPLACE FUNCTION public.remax_xml_broker_match(_org uuid)
RETURNS TABLE(agent_id text, profile_id uuid, via text, candidatos integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH run AS (SELECT (public.remax_xml_last_ok(_org)).id AS id),
  ag AS (
    SELECT l.agent_id,
           array_agg(DISTINCT lower(btrim(l.corretor_email))) FILTER (WHERE nullif(btrim(l.corretor_email), '') IS NOT NULL) AS emails,
           array_agg(DISTINCT public.remax_tel_norm(l.corretor_telefone)) FILTER (WHERE public.remax_tel_norm(l.corretor_telefone) IS NOT NULL) AS tels
      FROM public.remax_xml_listings l, run
     WHERE l.organization_id = _org AND l.last_run = run.id
     GROUP BY l.agent_id
  ),
  tel_unico AS (
    SELECT t FROM ag, unnest(ag.tels) t GROUP BY t HAVING count(DISTINCT ag.agent_id) = 1
  ),
  prof AS (
    SELECT p.id, p.remax_id, lower(btrim(p.email)) AS email, public.remax_tel_norm(p.telefone) AS tel
      FROM public.profiles p WHERE p.organization_id = _org AND p.ativo
  ),
  cand AS (
    SELECT ag.agent_id,
      (SELECT array_agg(p.id) FROM prof p WHERE p.remax_id = ag.agent_id) AS by_id,
      (SELECT array_agg(p.id) FROM prof p WHERE p.email = ANY(ag.emails)) AS by_email,
      (SELECT array_agg(p.id) FROM prof p WHERE p.tel = ANY(ag.tels) AND p.tel IN (SELECT t FROM tel_unico)) AS by_tel
      FROM ag
  ),
  pick AS (
    SELECT c.agent_id,
      CASE WHEN c.by_id IS NOT NULL THEN 'id' WHEN c.by_email IS NOT NULL THEN 'email'
           WHEN c.by_tel IS NOT NULL THEN 'telefone' END AS via,
      coalesce(c.by_id, c.by_email, c.by_tel) AS ids
      FROM cand c
  ),
  one AS (
    SELECT p.agent_id, p.via, cardinality(p.ids) AS n, CASE WHEN cardinality(p.ids) = 1 THEN p.ids[1] END AS pid
      FROM pick p
  )
  SELECT o.agent_id,
    CASE WHEN o.n = 1 AND (o.via = 'id' OR NOT EXISTS (
      SELECT 1 FROM one x WHERE x.pid = o.pid AND x.agent_id <> o.agent_id)) THEN o.pid END,
    CASE WHEN o.via IS NULL THEN 'sem_cadastro'
         WHEN o.n > 1 THEN 'conflito'
         WHEN o.via <> 'id' AND EXISTS (SELECT 1 FROM one x WHERE x.pid = o.pid AND x.agent_id <> o.agent_id)
           THEN 'conflito'
         ELSE o.via END,
    coalesce(o.n, 0)
    FROM one o
$$;
REVOKE ALL ON FUNCTION public.remax_xml_broker_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remax_xml_broker_match(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.remax_xml_broker_eval(uuid, uuid);
DROP TABLE IF EXISTS public.remax_xml_broker_revisao;
DROP TABLE IF EXISTS public.remax_xml_broker_vinculos;
DROP TABLE IF EXISTS public.remax_xml_brokers;
DROP FUNCTION IF EXISTS public.remax_tel_key(text);
DROP FUNCTION IF EXISTS public.remax_email_key(text);
COMMIT;
