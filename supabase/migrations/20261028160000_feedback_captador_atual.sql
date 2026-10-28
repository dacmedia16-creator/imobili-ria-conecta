-- Feedback ao Proprietário segue o CORRETOR ATUAL da captação (t_a2436e9f, "sim" de Denis 28/10).
-- Regra: anúncio ligado a uma captação -> responsável = exclusive_captures.captor_id (captador atual, muda na
--   transferência). Sem captação ligada -> responsável = portal_listing_snapshots.broker_id (regra de antes).
-- Pode ver/marcar: o responsável, o gestor/team leader dele (is_lead_of) e admin/super_admin.
-- O corretor antigo do anúncio PERDE o acesso quando a captação ligada é de outro corretor (Denis: "só o novo").
-- "Ligado" = vínculo 'ativo' (o mesmo da tela /feedback) OU código antigo TROCADO na captação por um código
--   com outro prefixo RE/MAX (o portal passa a mostrar o novo corretor e o anúncio ganha código novo
--   "<remax_id do novo>-<seq>"). Assim o código antigo e o histórico dele continuam na mesma captação.
-- Nenhum dado muda: broker_id, views e contatos ficam como estão; só regras de leitura/marcação.
-- Rollback: supabase/rollback/20261028160000_feedback_captador_atual.sql
BEGIN;

-- Captação a que o código pertence (NULL = nenhuma). Uso interno (só funções SECURITY DEFINER chamam).
CREATE OR REPLACE FUNCTION public.owner_feedback_captura(_org uuid, _code text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  WITH k AS (SELECT public.portal_code_key(_code) AS key)
  SELECT coalesce(
    (SELECT l.capture_id FROM k, public.exclusive_listing_links l
       JOIN public.exclusive_captures c ON c.id = l.capture_id AND c.organization_id = l.organization_id
      WHERE l.organization_id = _org AND l.code_key = k.key AND l.status = 'ativo' AND c.discarded_at IS NULL
      LIMIT 1),
    -- Código antigo trocado pelo código novo (outro prefixo) na MESMA captação, e não ligado a outra.
    (SELECT l.capture_id FROM k, public.exclusive_listing_links l
       JOIN public.exclusive_captures c ON c.id = l.capture_id AND c.organization_id = l.organization_id
       JOIN public.exclusive_listing_links n ON n.capture_id = l.capture_id AND n.status = 'ativo'
      WHERE l.organization_id = _org AND l.code_key = k.key AND l.status = 'encerrado'
        AND l.note LIKE 'Trocado por %' AND substr(n.code_key, 1, 9) <> substr(l.code_key, 1, 9)
        AND c.discarded_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.exclusive_listing_links x WHERE x.organization_id = _org
                          AND x.code_key = k.key AND x.status IN ('ativo', 'aguardando_gestor'))
      ORDER BY l.ended_at DESC LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_captura(uuid, text) FROM PUBLIC, anon, authenticated;

-- O usuário logado pode cuidar do feedback deste código? (admin fica em quem chama)
-- Sempre usa o usuário e a imobiliária da sessão: não serve para consultar outra imobiliária.
CREATE OR REPLACE FUNCTION public.owner_feedback_responsavel_ok(_code text, _broker uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(r.uid IS NOT NULL AND r.resp IS NOT NULL
     AND (r.resp = r.uid
          OR (public.has_any_role(r.uid, ARRAY['gestor','team_leader']::public.app_role[])
              AND public.is_lead_of(r.uid, r.resp))), false)
    FROM (SELECT auth.uid() AS uid,
                 coalesce((SELECT c.captor_id FROM public.exclusive_captures c
                            WHERE c.id = public.owner_feedback_captura(public.current_org_id(), _code)), _broker) AS resp) r
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_responsavel_ok(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_responsavel_ok(text, uuid) TO authenticated, service_role;

-- Marcar/ler/apagar ações (policies de owner_feedback_action_done usam esta função; elas não mudam).
CREATE OR REPLACE FUNCTION public.owner_feedback_can_edit(_code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
      OR EXISTS (
        SELECT 1 FROM public.portal_listing_snapshots s
         WHERE s.organization_id = public.current_org_id()
           AND s.listing_code = _code
           AND public.owner_feedback_responsavel_ok(s.listing_code, s.broker_id))
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_can_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_can_edit(text) TO authenticated, service_role;

-- Números do anúncio na tela: mesma regra (o novo captador passa a ver; o antigo deixa de ver o ligado).
DROP POLICY IF EXISTS portal_snap_read ON public.portal_listing_snapshots;
CREATE POLICY portal_snap_read ON public.portal_listing_snapshots FOR SELECT TO authenticated
  USING (
    public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
    OR public.owner_feedback_responsavel_ok(listing_code, broker_id)
  );

-- Histórico de ações da MESMA captação: o código aberto + códigos antigos trocados (somente leitura).
CREATE OR REPLACE FUNCTION public.owner_feedback_historico(_code text)
RETURNS TABLE(action_id uuid, done_at timestamptz, listing_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.current_org_id(); _cap uuid;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT coalesce(public.owner_feedback_enabled(), false)
     OR NOT public.owner_feedback_can_edit(_code) THEN RETURN; END IF;
  _cap := public.owner_feedback_captura(_org, _code);
  RETURN QUERY
  SELECT d.action_id, d.done_at, d.listing_code FROM public.owner_feedback_action_done d
   WHERE d.organization_id = _org
     AND (d.listing_code = _code
          OR (_cap IS NOT NULL AND public.portal_code_key(d.listing_code) IN (
                SELECT l.code_key FROM public.exclusive_listing_links l
                 WHERE l.organization_id = _org AND l.capture_id = _cap
                   AND public.owner_feedback_captura(_org, l.listing_code) = _cap)))
   ORDER BY d.done_at;
END $$;
REVOKE ALL ON FUNCTION public.owner_feedback_historico(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_historico(text) TO authenticated;

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
    FROM (SELECT l.*, coalesce((SELECT c.captor_id FROM public.exclusive_captures c
                                 WHERE c.id = public.owner_feedback_captura(_org, l.code)), m.profile_id) AS resp,
                 m.profile_id AS xml_broker
            FROM public.remax_xml_listings l
            LEFT JOIN public.remax_xml_broker_match(_org) m ON m.agent_id = l.agent_id
           WHERE l.organization_id = _org AND l.last_run = _run.id AND l.negocio = 'venda') x
   WHERE _admin OR public.owner_feedback_responsavel_ok(x.code, x.xml_broker)
   ORDER BY x.code;
END $$;
REVOKE ALL ON FUNCTION public.feedback_xml_base() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feedback_xml_base() TO authenticated;

-- "Ligado à captação … captador X": nome do captador ATUAL (o contrato aprovado guarda o nome de quem assinou).
-- Código antigo trocado: aparece ligado à mesma captação, com codigo_atual = código novo.
CREATE OR REPLACE FUNCTION public.owner_feedback_captacao(_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_jsonb(x) FROM (
    SELECT l.capture_id, l.status AS link_status, l.listing_code,
      nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), '') AS tipo,
      nullif(btrim(c.form_data->'imovel'->>'bairro'), '') AS bairro,
      nullif(btrim(c.form_data->'proprietario_1'->>'nome_completo'), '') AS proprietario,
      c.broker_creci AS creci,
      coalesce(nullif(btrim((SELECT p.nome FROM public.profiles p WHERE p.id = c.captor_id)), ''), c.broker_name) AS corretor,
      NULL::text AS codigo_atual
      FROM public.exclusive_listing_links l JOIN public.exclusive_captures c ON c.id = l.capture_id
     WHERE l.organization_id = public.current_org_id() AND l.code_key = public.portal_code_key(_code)
       AND l.status IN ('ativo', 'aguardando_gestor') AND c.discarded_at IS NULL
       AND public.exclusive_can_view(c.id, auth.uid())
    UNION ALL
    SELECT n.capture_id, 'ativo', n.listing_code,
      nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), ''),
      nullif(btrim(c.form_data->'imovel'->>'bairro'), ''),
      nullif(btrim(c.form_data->'proprietario_1'->>'nome_completo'), ''),
      c.broker_creci,
      coalesce(nullif(btrim((SELECT p.nome FROM public.profiles p WHERE p.id = c.captor_id)), ''), c.broker_name),
      n.listing_code
      FROM public.exclusive_captures c
      JOIN public.exclusive_listing_links n ON n.capture_id = c.id AND n.status = 'ativo'
     WHERE c.id = public.owner_feedback_captura(public.current_org_id(), _code)
       AND n.code_key <> public.portal_code_key(_code)
       AND public.exclusive_can_view(c.id, auth.uid())
     LIMIT 1) x
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_captacao(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_captacao(text) TO authenticated;

COMMIT;
