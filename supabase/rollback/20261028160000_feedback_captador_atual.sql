-- Rollback de 20261028160000_feedback_captador_atual.sql: volta a regra antiga (só broker_id do anúncio).
-- Não mexe em dados. Marcações feitas pelo novo captador continuam gravadas (só deixam de aparecer para ele).
BEGIN;

CREATE OR REPLACE FUNCTION public.owner_feedback_can_edit(_code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
      OR EXISTS (
        SELECT 1 FROM public.portal_listing_snapshots s
         WHERE s.organization_id = public.current_org_id()
           AND s.listing_code = _code
           AND s.broker_id IS NOT NULL
           AND (s.broker_id = (SELECT auth.uid())
                OR (public.has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader']::public.app_role[])
                    AND public.is_lead_of((SELECT auth.uid()), s.broker_id))))
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_can_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_can_edit(text) TO authenticated, service_role;

DROP POLICY IF EXISTS portal_snap_read ON public.portal_listing_snapshots;
CREATE POLICY portal_snap_read ON public.portal_listing_snapshots FOR SELECT TO authenticated
  USING (
    broker_id = (SELECT auth.uid())
    OR public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
    OR (broker_id IS NOT NULL
        AND public.has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader']::public.app_role[])
        AND public.is_lead_of((SELECT auth.uid()), broker_id))
  );

CREATE OR REPLACE FUNCTION public.feedback_xml_base()
RETURNS TABLE(code text, code_key text, agent_id text, broker_id uuid, corretor_xml text, tipo text,
  bairro text, cidade text, preco numeric, url text, coleta timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _run public.remax_xml_runs%ROWTYPE;
  _admin boolean; _lead boolean;
BEGIN
  IF NOT public.remax_xml_can_read() THEN RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501'; END IF;
  IF NOT coalesce(public.owner_feedback_enabled(), false) THEN RETURN; END IF;
  _run := public.remax_xml_last_ok(_org);
  IF _run.id IS NULL THEN RETURN; END IF;
  _admin := public.has_any_role(_uid, ARRAY['admin','super_admin']::public.app_role[]);
  _lead := public.has_any_role(_uid, ARRAY['gestor','team_leader']::public.app_role[]);
  RETURN QUERY
  SELECT l.code, l.code_key, l.agent_id, m.profile_id,
         CASE WHEN _admin AND m.profile_id IS NULL THEN nullif(btrim(l.corretor_nome), '') END,
         l.tipo, l.bairro, l.cidade, l.preco, l.url, _run.finished_at
    FROM public.remax_xml_listings l
    LEFT JOIN public.remax_xml_broker_match(_org) m ON m.agent_id = l.agent_id
   WHERE l.organization_id = _org AND l.last_run = _run.id AND l.negocio = 'venda'
     AND (_admin OR m.profile_id = _uid
          OR (_lead AND m.profile_id IS NOT NULL AND public.is_lead_of(_uid, m.profile_id)))
   ORDER BY l.code;
END $$;

CREATE OR REPLACE FUNCTION public.owner_feedback_captacao(_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_jsonb(x) FROM (
    SELECT l.capture_id, l.status AS link_status, l.listing_code,
      nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), '') AS tipo,
      nullif(btrim(c.form_data->'imovel'->>'bairro'), '') AS bairro,
      nullif(btrim(c.form_data->'proprietario_1'->>'nome_completo'), '') AS proprietario,
      c.broker_creci AS creci, c.broker_name AS corretor
      FROM public.exclusive_listing_links l JOIN public.exclusive_captures c ON c.id = l.capture_id
     WHERE l.organization_id = public.current_org_id() AND l.code_key = public.portal_code_key(_code)
       AND l.status IN ('ativo', 'aguardando_gestor') AND c.discarded_at IS NULL
       AND public.exclusive_can_view(c.id, auth.uid())
     LIMIT 1) x
$$;

DROP FUNCTION IF EXISTS public.owner_feedback_historico(text);
DROP FUNCTION IF EXISTS public.owner_feedback_chaves(boolean);
DROP FUNCTION IF EXISTS public.owner_feedback_responsavel_ok(text, uuid);
DROP FUNCTION IF EXISTS public.owner_feedback_captura(uuid, text);

COMMIT;
