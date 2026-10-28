-- Feedback ao Proprietário segue o CORRETOR ATUAL da captação (t_a2436e9f, "sim" de Denis 28/10).
-- Regra: anúncio ligado (vínculo 'ativo', o mesmo que a tela /feedback mostra como "Ligado à captação exclusiva")
--   -> responsável = exclusive_captures.captor_id (captador atual, muda na transferência).
--   Sem vínculo ativo -> responsável = portal_listing_snapshots.broker_id (regra de antes, sem mudança).
-- Pode ver/marcar: o responsável, o gestor/team leader dele (is_lead_of) e admin/super_admin.
-- O corretor antigo do anúncio PERDE o acesso quando a captação ligada é de outro corretor (Denis: "só o novo").
-- Nenhum dado muda: broker_id, views e contatos dos anúncios ficam como estão; só as regras de leitura/marcação.
-- Rollback: supabase/rollback/20261028160000_feedback_captador_atual.sql
BEGIN;

-- Captador atual do anúncio ligado (NULL = sem captação ligada ativa).
CREATE OR REPLACE FUNCTION public.owner_feedback_captador(_org uuid, _code text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT c.captor_id
    FROM public.exclusive_listing_links l
    JOIN public.exclusive_captures c ON c.id = l.capture_id AND c.organization_id = l.organization_id
   WHERE l.organization_id = _org AND l.code_key = public.portal_code_key(_code)
     AND l.status = 'ativo' AND c.discarded_at IS NULL
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_captador(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_captador(uuid, text) TO authenticated, service_role;

-- _uid pode cuidar do feedback deste anúncio? (sem a parte de admin, que fica em quem chama)
CREATE OR REPLACE FUNCTION public.owner_feedback_responsavel_ok(_uid uuid, _org uuid, _code text, _broker uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _uid IS NOT NULL AND r.resp IS NOT NULL
     AND (r.resp = _uid
          OR (public.has_any_role(_uid, ARRAY['gestor','team_leader']::public.app_role[])
              AND public.is_lead_of(_uid, r.resp)))
    FROM (SELECT coalesce(public.owner_feedback_captador(_org, _code), _broker) AS resp) r
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_responsavel_ok(uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_responsavel_ok(uuid, uuid, text, uuid) TO authenticated, service_role;

-- Marcar/ler/apagar ações (policies de owner_feedback_action_done usam esta função; elas não mudam).
CREATE OR REPLACE FUNCTION public.owner_feedback_can_edit(_code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
      OR EXISTS (
        SELECT 1 FROM public.portal_listing_snapshots s
         WHERE s.organization_id = public.current_org_id()
           AND s.listing_code = _code
           AND public.owner_feedback_responsavel_ok((SELECT auth.uid()), s.organization_id, s.listing_code, s.broker_id))
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_can_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_can_edit(text) TO authenticated, service_role;

-- Números do anúncio na tela: mesma regra (o novo captador passa a ver; o antigo deixa de ver o ligado).
DROP POLICY IF EXISTS portal_snap_read ON public.portal_listing_snapshots;
CREATE POLICY portal_snap_read ON public.portal_listing_snapshots FOR SELECT TO authenticated
  USING (
    public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
    OR public.owner_feedback_responsavel_ok((SELECT auth.uid()), organization_id, listing_code, broker_id)
  );

-- Lista base do XML na tela /feedback: mesma regra; broker_id devolvido = responsável atual (só exibição).
CREATE OR REPLACE FUNCTION public.feedback_xml_base()
RETURNS TABLE(code text, code_key text, agent_id text, broker_id uuid, corretor_xml text, tipo text,
  bairro text, cidade text, preco numeric, url text, coleta timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _run public.remax_xml_runs%ROWTYPE;
  _admin boolean;
BEGIN
  IF NOT public.remax_xml_can_read() THEN RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501'; END IF;
  IF NOT coalesce(public.owner_feedback_enabled(), false) THEN RETURN; END IF;
  _run := public.remax_xml_last_ok(_org);
  IF _run.id IS NULL THEN RETURN; END IF;
  _admin := public.has_any_role(_uid, ARRAY['admin','super_admin']::public.app_role[]);
  RETURN QUERY
  SELECT x.code, x.code_key, x.agent_id, x.resp,
         CASE WHEN _admin AND x.resp IS NULL THEN nullif(btrim(x.corretor_nome), '') END,
         x.tipo, x.bairro, x.cidade, x.preco, x.url, _run.finished_at
    FROM (SELECT l.*, coalesce(public.owner_feedback_captador(_org, l.code), m.profile_id) AS resp,
                 m.profile_id AS xml_broker
            FROM public.remax_xml_listings l
            LEFT JOIN public.remax_xml_broker_match(_org) m ON m.agent_id = l.agent_id
           WHERE l.organization_id = _org AND l.last_run = _run.id AND l.negocio = 'venda') x
   WHERE _admin OR public.owner_feedback_responsavel_ok(_uid, _org, x.code, x.xml_broker)
   ORDER BY x.code;
END $$;
REVOKE ALL ON FUNCTION public.feedback_xml_base() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feedback_xml_base() TO authenticated;

-- "Ligado à captação … captador X": nome do captador ATUAL (o contrato aprovado guarda o nome de quem assinou).
CREATE OR REPLACE FUNCTION public.owner_feedback_captacao(_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_jsonb(x) FROM (
    SELECT l.capture_id, l.status AS link_status, l.listing_code,
      nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), '') AS tipo,
      nullif(btrim(c.form_data->'imovel'->>'bairro'), '') AS bairro,
      nullif(btrim(c.form_data->'proprietario_1'->>'nome_completo'), '') AS proprietario,
      c.broker_creci AS creci,
      coalesce(nullif(btrim((SELECT p.nome FROM public.profiles p WHERE p.id = c.captor_id)), ''), c.broker_name) AS corretor
      FROM public.exclusive_listing_links l JOIN public.exclusive_captures c ON c.id = l.capture_id
     WHERE l.organization_id = public.current_org_id() AND l.code_key = public.portal_code_key(_code)
       AND l.status IN ('ativo', 'aguardando_gestor') AND c.discarded_at IS NULL
       AND public.exclusive_can_view(c.id, auth.uid())
     LIMIT 1) x
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_captacao(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_captacao(text) TO authenticated;

COMMIT;
