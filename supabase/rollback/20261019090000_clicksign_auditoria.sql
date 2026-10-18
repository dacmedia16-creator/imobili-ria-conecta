-- Rollback de 20261019090000_clicksign_auditoria.sql (cartão t_eb3f23e0). Volta as funções às
-- versões anteriores (copiadas sem alteração de 20261018120000, 150000 e 200000), remove as funções
-- novas e a coluna error_detail. Não apaga envelopes nem eventos. Rodar numa transação só.
-- Depois do rollback: o team leader volta a não enviar; envelopes antigos com deadline+document_closed
-- voltam a poder anexar (só os criados ANTES do deploy da edge nova, que usam deadline=closed).
BEGIN;
DROP FUNCTION IF EXISTS public.clicksign_reconcile_apply(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.clicksign_reconcile_authorize(text, uuid);

-- 20261018120000
CREATE OR REPLACE FUNCTION public.clicksign_sender_ok(_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.exclusive_actor_active(_actor)
    AND public.has_any_role(_actor,
      ARRAY['gestor','juridico','admin','super_admin']::public.app_role[]), false)
$$;

CREATE OR REPLACE FUNCTION public.clicksign_capture_authorize(_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _c public.exclusive_captures%ROWTYPE; _doc uuid;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_sender_ok(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas gestor, jurídico ou admin da imobiliária pode enviar pela Clicksign';
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

CREATE OR REPLACE FUNCTION public.clicksign_attach_signed(_envelope uuid, _path text, _file_name text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _st text; _gerado timestamptz; _doc uuid; _mime text;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _e.signed_document_id IS NOT NULL THEN RETURN 'already'; END IF;
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

-- 20261018150000
CREATE OR REPLACE FUNCTION public.clicksign_manage_authorize(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _c public.exclusive_captures%ROWTYPE;
  _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_sender_ok(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas gestor, jurídico ou admin da imobiliária pode gerenciar a assinatura';
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
  _can := public.clicksign_sender_ok(auth.uid());
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
    'envelope', (SELECT jsonb_build_object('status', e.status, 'is_test', e.is_test,
        'created_at', e.created_at, 'error_code', e.error_code,
        'signed', e.signed_document_id IS NOT NULL,
        'last_notified_at', e.last_notified_at,
        'notify_available_at', e.last_notified_at + interval '10 minutes')
      FROM public.clicksign_envelopes e WHERE e.capture_id = _id
      ORDER BY e.created_at DESC LIMIT 1));
END $$;

-- 20261018200000
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
    'contrato', (SELECT jsonb_build_object('id', d.id, 'file_name', d.file_name,
        'created_at', d.created_at) FROM public.sale_documents d WHERE d.id = _doc),
    'imobiliaria', CASE WHEN _can THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', v.id, 'nome', v.nome) ORDER BY v.nome)
      FROM public.clicksign_imobiliaria_signers(_org) v), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'corretores', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', p.nome,
        'email_ok', nullif(trim(coalesce(p.email, '')), '') IS NOT NULL) ORDER BY p.nome)
      FROM public.sale_corretores(_id) c JOIN public.profiles p ON p.id = c), '[]'::jsonb),
    'envelope', (SELECT jsonb_build_object('status', e.status, 'is_test', e.is_test,
        'created_at', e.created_at, 'error_code', e.error_code,
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

CREATE OR REPLACE FUNCTION public.clicksign_sale_extra_candidates(_id uuid, _q text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id();
  _like text := '%' || replace(replace(coalesce(trim(_q), ''), '%', ''), '_', '') || '%';
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_sender_ok(auth.uid())
     OR NOT EXISTS (SELECT 1 FROM public.sales WHERE id = _id AND organization_id = _org)
     OR NOT coalesce(public.can_view_sale(auth.uid(), _id), false) THEN
    RETURN '[]'::jsonb;
  END IF;
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
      ORDER BY lower(trim(op.email)), op.created_at DESC) pa LIMIT 20)
    UNION ALL
    (SELECT jsonb_build_object('ref', 'parceria:' || s.id, 'tipo', 'parceiro', 'nome', s.parceria_nome,
      'email', public.clicksign_mask_email(s.parceria_email))
    FROM public.sales s
    WHERE s.id = _id AND nullif(trim(coalesce(s.parceria_email, '')), '') IS NOT NULL
      AND nullif(trim(coalesce(s.parceria_nome, '')), '') IS NOT NULL AND s.parceria_nome ILIKE _like)
  ) t), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.clicksign_sale_attach_signed(_envelope uuid, _path text, _file_name text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _st text; _doc uuid; _mime text; _err text;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND OR _e.origem <> 'venda' THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _e.signed_document_id IS NOT NULL THEN RETURN 'already'; END IF;
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

DROP FUNCTION IF EXISTS public.clicksign_capture_sender_ok(uuid, uuid);
ALTER TABLE public.clicksign_envelopes DROP COLUMN IF EXISTS error_detail;
COMMIT;
