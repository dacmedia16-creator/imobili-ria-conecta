-- Clicksign — pacote de correções da auditoria t_5aabee72 (cartão t_eb3f23e0; aprovado por Denis em
-- 18/10/2026: "1 sim, 2 sim"). Rollback: supabase/rollback/20261019090000_clicksign_auditoria.sql
--
-- R6) Prazo vencido com assinatura parcial: o envelope novo já vai com
--     deadline_partial_signature_action=canceled (edge). Aqui, a proteção no banco para TODOS os
--     envelopes (inclusive os criados com o padrão antigo "closed"): envelope já cancelado (evento
--     deadline/cancel/refusal recebido antes) nunca anexa o PDF nem avisa "Todos assinaram" — as duas
--     RPCs de anexar devolvem 'stale'.
-- R3) Detalhe da recusa da Clicksign (HTTP 400/422) gravado em clicksign_envelopes.error_detail (até
--     120 caracteres, sem e-mail; a edge já tira CPF e nomes) e mostrado na tela da captação e da venda.
-- R1) Team leader passa a enviar/gerenciar pela Clicksign (captação e venda), sempre na própria org e
--     com as mesmas regras de etapa e do jurídico, e SEM ampliar o que ele já vê:
--     - venda: todas as RPCs já exigem can_view_sale (team leader = só vendas da equipe dele);
--     - captação: nova clicksign_capture_sender_ok exige exclusive_can_view para quem é só team leader
--       (gestor, jurídico e admin seguem como hoje);
--     - busca de partes extras: parceiros (occurrence_partners) só das vendas que ele já vê.
-- R5) "Conferir na Clicksign" para envio sem confirmação (sending/activate_unknown ou sending parado há
--     mais de 5 min): clicksign_reconcile_authorize (a edge consulta o envelope por GET e acerta).
-- Nenhum e-mail, CPF ou segredo entra nesta migration.

-- ===== R3) detalhe da recusa =====
ALTER TABLE public.clicksign_envelopes
  ADD COLUMN error_detail text
    CONSTRAINT clicksign_envelopes_error_detail_check
    CHECK (error_detail IS NULL OR (length(error_detail) <= 120 AND error_detail !~ '@'));
GRANT SELECT (error_detail) ON public.clicksign_envelopes TO authenticated;

-- ===== R1) quem envia =====
-- Gestor, team leader, jurídico, admin e super_admin ativos, da organização do contexto.
CREATE OR REPLACE FUNCTION public.clicksign_sender_ok(_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.exclusive_actor_active(_actor)
    AND public.has_any_role(_actor,
      ARRAY['gestor','team_leader','juridico','admin','super_admin']::public.app_role[]), false)
$$;

-- Captação: quem é só team leader envia/gerencia apenas as captações que já vê (equipe dele).
CREATE FUNCTION public.clicksign_capture_sender_ok(_actor uuid, _capture uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.clicksign_sender_ok(_actor)
    AND (public.has_any_role(_actor, ARRAY['gestor','juridico','admin','super_admin']::public.app_role[])
      OR public.exclusive_can_view(_capture, _actor)), false)
$$;
REVOKE ALL ON FUNCTION public.clicksign_capture_sender_ok(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_capture_sender_ok(uuid, uuid) TO authenticated, service_role;

-- Configuração da captação para a TELA (igual à anterior + regra do team leader + error_detail).
CREATE OR REPLACE FUNCTION public.clicksign_capture_config(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _s public.clicksign_org_settings%ROWTYPE;
  _c public.exclusive_captures%ROWTYPE; _can boolean;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL THEN RETURN jsonb_build_object('enabled', false); END IF;
  SELECT * INTO _s FROM public.clicksign_org_settings WHERE organization_id = _org;
  IF NOT FOUND OR NOT _s.enabled OR _s.access_token_secret_id IS NULL THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id AND organization_id = _org;
  IF NOT FOUND THEN RETURN jsonb_build_object('enabled', false); END IF;
  _can := public.clicksign_capture_sender_ok(auth.uid(), _id);
  IF NOT _can AND NOT coalesce(public.exclusive_can_view(_id, auth.uid()), false) THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  RETURN jsonb_build_object(
    'enabled', true,
    'test_mode', _s.test_mode,
    'can_send', _can,
    'witnesses', 2,
    'deadline_days', _s.deadline_days,
    'imobiliaria', CASE WHEN _can THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', v.id, 'nome', v.nome) ORDER BY v.nome)
      FROM public.clicksign_imobiliaria_signers(_org) v), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'corretor_email_ok', coalesce((SELECT nullif(trim(coalesce(p.email, '')), '') IS NOT NULL
      FROM public.profiles p WHERE p.id = _c.captor_id), false),
    -- Tamanho do contrato gerado (bytes, do Storage): a tela avisa antes se passar de 10 MB.
    'pdf_size', (SELECT (o.metadata->>'size')::bigint FROM public.exclusive_documents d
      JOIN storage.objects o ON o.bucket_id = 'exclusive-captures' AND o.name = d.storage_path
      WHERE d.capture_id = _id AND d.kind = 'gerado' LIMIT 1),
    'envelope', (SELECT jsonb_build_object('status', e.status, 'is_test', e.is_test,
        'created_at', e.created_at, 'updated_at', e.updated_at, 'error_code', e.error_code,
        'error_detail', e.error_detail,
        'signed', e.signed_document_id IS NOT NULL,
        'last_notified_at', e.last_notified_at,
        'notify_available_at', e.last_notified_at + interval '10 minutes')
      FROM public.clicksign_envelopes e WHERE e.capture_id = _id
      ORDER BY e.created_at DESC LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION public.clicksign_capture_authorize(_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _c public.exclusive_captures%ROWTYPE; _doc uuid;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_capture_sender_ok(auth.uid(), _id) THEN
    RAISE EXCEPTION 'Apenas gestor, team leader, jurídico ou admin da imobiliária pode enviar pela Clicksign';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clicksign_org_settings s WHERE s.organization_id = _org
      AND s.enabled AND s.access_token_secret_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Envio pela Clicksign não está habilitado para esta imobiliária';
  END IF;
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  IF _c.manual OR _c.status <> 'enviada' OR _c.archived_at IS NOT NULL OR _c.discarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'A captação precisa estar enviada ao gestor, com o contrato gerado, para ir à Clicksign';
  END IF;
  SELECT id INTO _doc FROM public.exclusive_documents WHERE capture_id = _id AND kind = 'gerado';
  IF _doc IS NULL THEN RAISE EXCEPTION 'Gere o contrato antes de enviar para assinatura'; END IF;
  IF EXISTS (SELECT 1 FROM public.clicksign_envelopes e WHERE e.source_document_id = _doc
      AND e.status IN ('sending','running')) THEN
    RAISE EXCEPTION 'Este contrato já está em envio ou em assinatura na Clicksign';
  END IF;
  RETURN _org;
END $$;

CREATE OR REPLACE FUNCTION public.clicksign_manage_authorize(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _c public.exclusive_captures%ROWTYPE;
  _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_capture_sender_ok(auth.uid(), _id) THEN
    RAISE EXCEPTION 'Apenas gestor, team leader, jurídico ou admin da imobiliária pode gerenciar a assinatura';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clicksign_org_settings s WHERE s.organization_id = _org
      AND s.enabled AND s.access_token_secret_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Clicksign não está habilitada para esta imobiliária';
  END IF;
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id AND organization_id = _org;
  IF NOT FOUND OR _c.archived_at IS NOT NULL OR _c.discarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Captação não disponível';
  END IF;
  SELECT * INTO _e FROM public.clicksign_envelopes e
    WHERE e.capture_id = _id AND e.organization_id = _org ORDER BY e.created_at DESC LIMIT 1;
  IF NOT FOUND OR _e.status <> 'running' OR _e.envelope_key IS NULL OR _e.document_key IS NULL THEN
    RAISE EXCEPTION 'Não há contrato em assinatura na Clicksign para esta captação';
  END IF;
  RETURN jsonb_build_object('org', _org, 'envelope', _e.id);
END $$;

-- Configuração da venda para a TELA: igual à anterior + error_detail no envelope.
CREATE OR REPLACE FUNCTION public.clicksign_sale_config(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _s public.clicksign_org_settings%ROWTYPE;
  _sale public.sales%ROWTYPE; _can boolean; _doc uuid;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL THEN RETURN jsonb_build_object('enabled', false); END IF;
  SELECT * INTO _s FROM public.clicksign_org_settings WHERE organization_id = _org;
  IF NOT FOUND OR NOT _s.enabled OR NOT _s.sale_enabled OR _s.access_token_secret_id IS NULL THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  SELECT * INTO _sale FROM public.sales WHERE id = _id AND organization_id = _org;
  IF NOT FOUND OR NOT coalesce(public.can_view_sale(auth.uid(), _id), false) THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  _can := public.clicksign_sender_ok(auth.uid());
  _doc := public.clicksign_sale_contrato(_id);
  RETURN jsonb_build_object(
    'enabled', true,
    'test_mode', _s.test_mode,
    'can_send', _can,
    'witnesses', 2,
    'deadline_days', _s.deadline_days,
    'libera_assinatura', _sale.contrato_libera_assinatura IS DISTINCT FROM false,
    -- size (bytes, do Storage) = a tela avisa antes de enviar se passar do limite de 10 MB.
    'contrato', (SELECT jsonb_build_object('id', d.id, 'file_name', d.file_name,
        'created_at', d.created_at,
        'size', (SELECT (o.metadata->>'size')::bigint FROM storage.objects o
          WHERE o.bucket_id = 'sale-documents' AND o.name = d.storage_path))
      FROM public.sale_documents d WHERE d.id = _doc),
    'imobiliaria', CASE WHEN _can THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', v.id, 'nome', v.nome) ORDER BY v.nome)
      FROM public.clicksign_imobiliaria_signers(_org) v), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'corretores', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', p.nome,
        'email_ok', nullif(trim(coalesce(p.email, '')), '') IS NOT NULL) ORDER BY p.nome)
      FROM public.sale_corretores(_id) c JOIN public.profiles p ON p.id = c), '[]'::jsonb),
    'envelope', (SELECT jsonb_build_object('status', e.status, 'is_test', e.is_test,
        'created_at', e.created_at, 'updated_at', e.updated_at, 'error_code', e.error_code,
        'error_detail', e.error_detail,
        'signed', e.signed_document_id IS NOT NULL,
        'last_event', e.last_event,
        'last_notified_at', e.last_notified_at,
        'notify_available_at', e.last_notified_at + interval '10 minutes',
        'cancel_requested_at', e.cancel_requested_at,
        'cancel_reason', e.cancel_reason,
        'contrato_atual', e.source_document_id IS NOT DISTINCT FROM _doc)
      FROM public.clicksign_envelopes e WHERE e.sale_id = _id AND e.organization_id = _org
      ORDER BY e.created_at DESC LIMIT 1));
END $$;

-- Partes extras "do sistema": igual à anterior, mas quem é só team leader vê parceiros apenas das
-- vendas que ele já enxerga (não amplia a visibilidade dele). Corretores da org: o team leader já lê
-- todos os perfis da org (policy profiles_self_select).
CREATE OR REPLACE FUNCTION public.clicksign_sale_extra_candidates(_id uuid, _q text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id();
  _like text := '%' || replace(replace(coalesce(trim(_q), ''), '%', ''), '_', '') || '%';
  _amplo boolean;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_sender_ok(auth.uid())
     OR NOT EXISTS (SELECT 1 FROM public.sales WHERE id = _id AND organization_id = _org)
     OR NOT coalesce(public.can_view_sale(auth.uid(), _id), false) THEN
    RETURN '[]'::jsonb;
  END IF;
  _amplo := public.has_any_role(auth.uid(),
    ARRAY['gestor','juridico','admin','super_admin']::public.app_role[]);
  RETURN coalesce((SELECT jsonb_agg(t.x ORDER BY t.x->>'tipo', t.x->>'nome') FROM (
    (SELECT jsonb_build_object('ref', 'corretor:' || p.id, 'tipo', 'corretor', 'nome', p.nome,
      'email', public.clicksign_mask_email(p.email)) AS x
    FROM public.profiles p
    JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
    WHERE p.ativo IS TRUE AND nullif(trim(coalesce(p.email, '')), '') IS NOT NULL
      AND nullif(trim(coalesce(p.nome, '')), '') IS NOT NULL AND p.nome ILIKE _like
    ORDER BY p.nome LIMIT 20)
    UNION ALL
    (SELECT pa.x FROM (
      SELECT DISTINCT ON (lower(trim(op.email))) jsonb_build_object('ref', 'parceiro:' || op.id,
        'tipo', 'parceiro', 'nome', op.nome, 'email', public.clicksign_mask_email(op.email)) AS x
      FROM public.occurrence_partners op
      WHERE op.organization_id = _org AND nullif(trim(coalesce(op.email, '')), '') IS NOT NULL
        AND nullif(trim(coalesce(op.nome, '')), '') IS NOT NULL AND op.nome ILIKE _like
        AND (_amplo OR EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = op.occurrence_id
          AND public.can_view_sale(auth.uid(), o.sale_id)))
      ORDER BY lower(trim(op.email)), op.created_at DESC) pa LIMIT 20)
    UNION ALL
    (SELECT jsonb_build_object('ref', 'parceria:' || s.id, 'tipo', 'parceiro', 'nome', s.parceria_nome,
      'email', public.clicksign_mask_email(s.parceria_email))
    FROM public.sales s
    WHERE s.id = _id AND nullif(trim(coalesce(s.parceria_email, '')), '') IS NOT NULL
      AND nullif(trim(coalesce(s.parceria_nome, '')), '') IS NOT NULL AND s.parceria_nome ILIKE _like)
  ) t), '[]'::jsonb);
END $$;

-- ===== R6) envelope cancelado nunca anexa =====
-- Captação: igual à anterior + 'stale' para envelope já cancelado (deadline/cancel/refusal).
CREATE OR REPLACE FUNCTION public.clicksign_attach_signed(_envelope uuid, _path text, _file_name text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _st text; _gerado timestamptz; _doc uuid; _mime text;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _e.signed_document_id IS NOT NULL THEN RETURN 'already'; END IF;
  -- Prazo vencido/cancelado/recusado antes do "fechou" (ex.: padrão antigo deadline=closed fecha com
  -- assinatura parcial): não anexa, não muda o status cancelado.
  IF _e.status = 'canceled' THEN RETURN 'stale'; END IF;
  SELECT status INTO _st FROM public.exclusive_captures WHERE id = _e.capture_id FOR UPDATE;
  SELECT created_at INTO _gerado FROM public.exclusive_documents
    WHERE id = _e.source_document_id AND capture_id = _e.capture_id AND kind = 'gerado';
  IF _st IS NULL OR _st NOT IN ('enviada','em_assinatura') OR _gerado IS NULL THEN
    UPDATE public.clicksign_envelopes SET status = 'closed', last_event = 'stale', updated_at = now()
      WHERE id = _envelope;
    RETURN 'stale';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id = _e.capture_id
      AND kind = 'assinado' AND created_at >= _gerado) THEN
    UPDATE public.clicksign_envelopes SET status = 'closed', last_event = 'manual_exists',
      updated_at = now() WHERE id = _envelope;
    RETURN 'manual_exists';
  END IF;
  IF _path !~ ('^' || _e.organization_id::text || '/' || _e.capture_id::text || '/[0-9a-f-]{36}[.]pdf$')
    OR _file_name IS NULL OR length(trim(_file_name)) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'Documento inválido';
  END IF;
  SELECT metadata->>'mimetype' INTO _mime FROM storage.objects
    WHERE bucket_id = 'exclusive-captures' AND name = _path;
  IF _mime IS DISTINCT FROM 'application/pdf' THEN RAISE EXCEPTION 'Arquivo ausente ou formato inválido'; END IF;
  INSERT INTO public.exclusive_documents (capture_id, kind, owner_index, storage_path, file_name, uploaded_by)
    VALUES (_e.capture_id, 'assinado', 0, _path, trim(_file_name), _e.created_by)
    ON CONFLICT (capture_id, kind, owner_index) DO UPDATE
      SET storage_path = excluded.storage_path, file_name = excluded.file_name,
          uploaded_by = excluded.uploaded_by, created_at = now()
    RETURNING id INTO _doc;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (_e.capture_id, _e.created_by, 'documento_anexado',
      'assinado:0 (Clicksign, automático' || CASE WHEN _e.is_test THEN ', TESTE' ELSE '' END || ')');
  UPDATE public.clicksign_envelopes SET status = 'closed', signed_document_id = _doc,
    last_event = 'document_closed', updated_at = now() WHERE id = _envelope;
  RETURN 'attached';
END $$;

-- Venda: igual à anterior + 'stale' para envelope já cancelado (sem anexar e sem "Todos assinaram").
CREATE OR REPLACE FUNCTION public.clicksign_sale_attach_signed(_envelope uuid, _path text, _file_name text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _st text; _doc uuid; _mime text; _err text;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND OR _e.origem <> 'venda' THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _e.signed_document_id IS NOT NULL THEN RETURN 'already'; END IF;
  -- Prazo vencido/cancelado/recusado antes do "fechou": não anexa, não avisa e não marca a venda.
  IF _e.status = 'canceled' THEN RETURN 'stale'; END IF;
  SELECT status::text INTO _st FROM public.sales WHERE id = _e.sale_id FOR UPDATE;
  IF _st IS NULL OR _st IN ('cancelada','arquivada')
     OR _e.source_document_id IS DISTINCT FROM public.clicksign_sale_contrato(_e.sale_id) THEN
    UPDATE public.clicksign_envelopes SET status = 'closed', last_event = 'stale', updated_at = now()
      WHERE id = _envelope;
    RETURN 'stale';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sale_documents d WHERE d.sale_id = _e.sale_id
      AND d.tipo = 'contrato_assinado' AND d.deleted_at IS NULL AND d.created_at >= _e.created_at) THEN
    UPDATE public.clicksign_envelopes SET status = 'closed', last_event = 'manual_exists',
      updated_at = now() WHERE id = _envelope;
    RETURN 'manual_exists';
  END IF;
  IF _path !~ ('^' || _e.organization_id::text || '/' || _e.sale_id::text
                || '/outros/contrato_assinado/[0-9a-f-]{36}[.]pdf$')
     OR _file_name IS NULL OR length(trim(_file_name)) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'Documento inválido';
  END IF;
  SELECT metadata->>'mimetype' INTO _mime FROM storage.objects
    WHERE bucket_id = 'sale-documents' AND name = _path;
  IF _mime IS DISTINCT FROM 'application/pdf' THEN RAISE EXCEPTION 'Arquivo ausente ou formato inválido'; END IF;
  INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, uploaded_by,
      status, descricao)
    VALUES (_e.sale_id, 'contrato_assinado', 'outros', _path, trim(_file_name), _e.created_by,
      'enviado', 'Assinado pela Clicksign' || CASE WHEN _e.is_test THEN ' (TESTE)' ELSE '' END)
    RETURNING id INTO _doc;
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload)
    VALUES (_e.created_by, _e.sale_id, 'document_uploaded', jsonb_build_object('tipo',
      'contrato_assinado', 'parte', 'outros', 'origem', 'clicksign', 'teste', _e.is_test));
  UPDATE public.clicksign_envelopes SET status = 'closed', signed_document_id = _doc,
    last_event = 'attached_only', updated_at = now() WHERE id = _envelope;
  IF _st <> 'aguardando_assinatura' THEN
    PERFORM public.clicksign_sale_notify(_e, 'Clicksign: contrato assinado anexado',
      'Todos assinaram e o contrato assinado foi anexado. A venda não estava aguardando assinatura; confira e marque manualmente.');
    RETURN 'attached_only';
  END IF;
  BEGIN
    PERFORM public.clicksign_sale_set_status(_e.sale_id, 'contrato_assinado', _e.created_by,
      'Automático: todos assinaram na Clicksign' || CASE WHEN _e.is_test THEN ' (TESTE)' ELSE '' END);
    PERFORM public.clicksign_sale_set_status(_e.sale_id, 'ocorrencia_pendente', _e.created_by,
      'Automático: contrato assinado');
    UPDATE public.clicksign_envelopes SET last_event = 'document_closed' WHERE id = _envelope;
    RETURN 'attached';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    UPDATE public.clicksign_envelopes SET error_code = left('mark_failed:' || _err, 120)
      WHERE id = _envelope;
    PERFORM public.clicksign_sale_notify(_e, 'Clicksign: marque o contrato como assinado',
      left('Todos assinaram e o contrato assinado foi anexado, mas a venda não pôde ser marcada sozinha: '
        || _err || '. Corrija e use "Marcar contrato assinado".', 500));
    RETURN 'attached_only';
  END;
END $$;

-- ===== R5) conferir envio sem confirmação =====
-- Autoriza "Conferir na Clicksign" (com o JWT do usuário). _kind: 'captacao' | 'venda'. Só o envelope
-- mais recente, em 'sending' com activate_unknown ou parado há mais de 5 minutos. Devolve {org, envelope}.
CREATE FUNCTION public.clicksign_reconcile_authorize(_kind text, _id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _e public.clicksign_envelopes%ROWTYPE; _can boolean;
BEGIN
  IF _kind NOT IN ('captacao','venda') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  -- (CASE fora do IF: o plpgsql corta a condição do IF no primeiro THEN.)
  _can := CASE _kind WHEN 'captacao' THEN public.clicksign_capture_sender_ok(auth.uid(), _id)
    ELSE public.clicksign_sender_ok(auth.uid()) END;
  IF auth.uid() IS NULL OR _org IS NULL OR NOT coalesce(_can, false) THEN
    RAISE EXCEPTION 'Apenas gestor, team leader, jurídico ou admin da imobiliária pode conferir o envio';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clicksign_org_settings s WHERE s.organization_id = _org
      AND s.enabled AND (_kind = 'captacao' OR s.sale_enabled) AND s.access_token_secret_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Clicksign não está habilitada para esta imobiliária';
  END IF;
  IF _kind = 'captacao' THEN
    IF NOT EXISTS (SELECT 1 FROM public.exclusive_captures WHERE id = _id AND organization_id = _org) THEN
      RAISE EXCEPTION 'Captação não disponível';
    END IF;
    SELECT * INTO _e FROM public.clicksign_envelopes e
      WHERE e.capture_id = _id AND e.organization_id = _org ORDER BY e.created_at DESC LIMIT 1;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.sales WHERE id = _id AND organization_id = _org)
       OR NOT coalesce(public.can_view_sale(auth.uid(), _id), false) THEN
      RAISE EXCEPTION 'Venda não disponível';
    END IF;
    SELECT * INTO _e FROM public.clicksign_envelopes e
      WHERE e.sale_id = _id AND e.organization_id = _org ORDER BY e.created_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND OR _e.status <> 'sending'
     OR NOT (coalesce(_e.error_code, '') = 'activate_unknown'
             OR _e.updated_at < now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Não há envio sem confirmação para conferir';
  END IF;
  RETURN jsonb_build_object('org', _org, 'envelope', _e.id);
END $$;
REVOKE ALL ON FUNCTION public.clicksign_reconcile_authorize(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_reconcile_authorize(text, uuid) TO authenticated;

-- Aplica o que a Clicksign respondeu no GET do envelope (service_role, edge). _remote:
--   running → o envio valeu: segue como um envio confirmado (mark_sent da captação ou da venda);
--   draft   → nunca foi ativado: nada foi enviado aos signatários; libera novo envio (status error);
--   missing → envelope não existe/nem foi criado: idem;
--   outro (closed/canceled) → não mexe; pede conferência manual.
-- Retorna: sent | released | manual | already.
CREATE FUNCTION public.clicksign_reconcile_apply(_envelope uuid, _remote text, _actor uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _e.status <> 'sending' THEN RETURN 'already'; END IF;
  IF _remote = 'running' AND _e.envelope_key IS NOT NULL THEN
    UPDATE public.clicksign_envelopes SET error_code = NULL, error_detail = NULL WHERE id = _envelope;
    IF _e.origem = 'venda' THEN
      PERFORM public.clicksign_sale_mark_sent(_envelope);
      INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload)
        VALUES (coalesce(_actor, _e.created_by), _e.sale_id, 'clicksign_conferido',
          jsonb_build_object('resultado', 'em assinatura'));
    ELSE
      PERFORM public.clicksign_mark_sent(_envelope);
    END IF;
    RETURN 'sent';
  END IF;
  IF _remote IN ('draft','missing') THEN
    UPDATE public.clicksign_envelopes SET status = 'error', error_code = 'reconcile:' || _remote,
      error_detail = NULL, updated_at = now() WHERE id = _envelope;
    RETURN 'released';
  END IF;
  UPDATE public.clicksign_envelopes SET error_code = left('reconcile_manual:' || coalesce(_remote, '?'), 120),
    updated_at = now() WHERE id = _envelope;
  RETURN 'manual';
END $$;
REVOKE ALL ON FUNCTION public.clicksign_reconcile_apply(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_reconcile_apply(uuid, text, uuid) TO service_role;
