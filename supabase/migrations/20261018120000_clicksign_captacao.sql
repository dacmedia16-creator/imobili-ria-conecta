-- Clicksign API v3 na CAPTAÇÃO — 1ª entrega (cartão t_e3a0459b; decisões de Denis em 18/10/2026).
-- Desenho: configuração por organização (chave e segredo do webhook no Supabase Vault; a tabela guarda
-- só o id do segredo), rastreio de envelopes, eventos de webhook idempotentes e anexo automático do PDF
-- assinado. Fail-closed: enabled=false e test_mode=true por padrão; sem linha de configuração não há botão.
-- Signatários da captação: Proprietário 1 (+2 se houver), Corretor (e-mail do profile do captador),
-- 1 ou mais signatários da Imobiliária escolhidos da lista da org e exatamente 2 testemunhas (informadas
-- no envio). A aprovação da captação continua MANUAL: o PDF assinado só é anexado.
-- Quem envia: gestor, jurídico, admin (e super_admin), da mesma organização.
-- Signatários da Imobiliária: lista de user_ids da própria org (e-mail sempre do cadastro, como o
-- corretor), configurada pela função administrativa (service_role). A allowlist do modo teste guarda só
-- o sha256 do e-mail. Nenhum e-mail entra em migration ou código.

CREATE TABLE public.clicksign_org_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  test_mode boolean NOT NULL DEFAULT true,
  test_allowlist_sha256 text[] NOT NULL DEFAULT '{}',
  -- Usuários da própria org autorizados a assinar pela Imobiliária. Nome e e-mail vêm do profile
  -- (igual ao corretor); nenhum e-mail é guardado aqui.
  imobiliaria_signer_ids uuid[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(imobiliaria_signer_ids) <= 20),
  deadline_days integer NOT NULL DEFAULT 30 CHECK (deadline_days BETWEEN 1 AND 90),
  access_token_secret_id uuid,
  webhook_secret_id uuid,
  webhook_slug text NOT NULL UNIQUE
    DEFAULT encode(extensions.gen_random_bytes(18), 'hex') CHECK (webhook_slug ~ '^[0-9a-f]{32,64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clicksign_org_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clicksign_org_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.clicksign_org_settings TO service_role;

CREATE TABLE public.clicksign_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  origem text NOT NULL DEFAULT 'captacao' CHECK (origem IN ('captacao')),
  capture_id uuid NOT NULL,
  -- exclusive_documents.id do contrato "gerado" enviado. Sem FK: devolver apaga o gerado e o
  -- histórico do envelope precisa ficar.
  source_document_id uuid NOT NULL,
  envelope_key text UNIQUE,
  document_key text,
  status text NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending','running','closed','canceled','error')),
  is_test boolean NOT NULL,
  -- [{ "papel": text, "nome": text, "email_sha256": text }] — nunca o e-mail em claro.
  signers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(signers) = 'array'),
  signed_document_id uuid,
  last_event text,
  error_code text CHECK (error_code IS NULL OR length(error_code) <= 120),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (capture_id, organization_id)
    REFERENCES public.exclusive_captures(id, organization_id) ON DELETE CASCADE
);
-- Um único envelope em andamento por contrato gerado: impede envio em dobro (duplo clique, duas abas).
CREATE UNIQUE INDEX clicksign_envelopes_um_ativo ON public.clicksign_envelopes (source_document_id)
  WHERE status IN ('sending','running');
CREATE INDEX clicksign_envelopes_capture_idx
  ON public.clicksign_envelopes (organization_id, capture_id, created_at DESC);
CREATE INDEX clicksign_envelopes_document_idx
  ON public.clicksign_envelopes (organization_id, document_key);
ALTER TABLE public.clicksign_envelopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clicksign_envelopes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.clicksign_envelopes TO service_role;
GRANT SELECT (id, capture_id, status, is_test, last_event, error_code, signed_document_id,
  created_by, created_at, updated_at) ON public.clicksign_envelopes TO authenticated;
CREATE POLICY clicksign_envelopes_read ON public.clicksign_envelopes FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id())
  AND public.exclusive_can_view(capture_id, (SELECT auth.uid())));

CREATE TABLE public.clicksign_webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  event_name text,
  document_key text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  result text,
  UNIQUE (organization_id, body_sha256)
);
CREATE INDEX clicksign_webhook_events_org_idx
  ON public.clicksign_webhook_events (organization_id, received_at);
ALTER TABLE public.clicksign_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clicksign_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.clicksign_webhook_events TO service_role;

-- Signatários válidos da Imobiliária: usuários da lista que continuam ativos, membros ativos da MESMA
-- org e com e-mail no cadastro. Quem sai da org ou fica sem e-mail some da lista sozinho.
CREATE FUNCTION public.clicksign_imobiliaria_signers(_org uuid)
RETURNS TABLE (id uuid, nome text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.nome, lower(trim(p.email))
  FROM public.clicksign_org_settings s
  JOIN public.profiles p ON p.id = ANY (s.imobiliaria_signer_ids)
  WHERE s.organization_id = _org AND p.ativo IS TRUE
    AND nullif(trim(coalesce(p.email, '')), '') IS NOT NULL
    AND nullif(trim(coalesce(p.nome, '')), '') IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.organization_members m
      WHERE m.user_id = p.id AND m.organization_id = _org AND m.ativo)
$$;
REVOKE ALL ON FUNCTION public.clicksign_imobiliaria_signers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_imobiliaria_signers(uuid) TO service_role;

-- Quem pode enviar: gestor, jurídico, admin e super_admin ativos, da organização do contexto.
CREATE FUNCTION public.clicksign_sender_ok(_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.exclusive_actor_active(_actor)
    AND public.has_any_role(_actor,
      ARRAY['gestor','juridico','admin','super_admin']::public.app_role[]), false)
$$;
REVOKE ALL ON FUNCTION public.clicksign_sender_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_sender_ok(uuid) TO authenticated;

-- Configuração para a TELA (sem segredo e sem e-mail da imobiliária). enabled=false esconde o botão.
CREATE FUNCTION public.clicksign_capture_config(_id uuid) RETURNS jsonb
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
        'signed', e.signed_document_id IS NOT NULL)
      FROM public.clicksign_envelopes e WHERE e.capture_id = _id
      ORDER BY e.created_at DESC LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION public.clicksign_capture_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_capture_config(uuid) TO authenticated;

-- Autorização do envio, chamada pela edge function COM o JWT do usuário (a regra fica no banco).
-- Devolve a organização da captação; qualquer falha levanta exceção com mensagem clara.
CREATE FUNCTION public.clicksign_capture_authorize(_id uuid) RETURNS uuid
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
REVOKE ALL ON FUNCTION public.clicksign_capture_authorize(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_capture_authorize(uuid) TO authenticated;

-- ===== Somente service_role (edge functions e operação administrativa) =====

-- Lê o segredo da org no Vault. Nunca exposto a authenticated/anon.
CREATE FUNCTION public.clicksign_org_secret(_org uuid, _kind text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _sid uuid; _val text;
BEGIN
  IF _kind NOT IN ('access_token','webhook') THEN RAISE EXCEPTION 'Tipo de segredo inválido'; END IF;
  SELECT CASE WHEN _kind = 'access_token' THEN access_token_secret_id ELSE webhook_secret_id END
    INTO _sid FROM public.clicksign_org_settings WHERE organization_id = _org;
  IF _sid IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO _val FROM vault.decrypted_secrets WHERE id = _sid;
  RETURN _val;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_org_secret(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_org_secret(uuid, text) TO service_role;

-- Grava/troca a chave de API ou o segredo HMAC do webhook direto no Vault (sem log da chave).
CREATE FUNCTION public.clicksign_admin_set_secret(_org uuid, _kind text, _value text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _sid uuid; _name text;
BEGIN
  IF _kind NOT IN ('access_token','webhook') THEN RAISE EXCEPTION 'Tipo de segredo inválido'; END IF;
  IF _value IS NULL OR length(_value) NOT BETWEEN 16 AND 512 OR _value ~ '\s' THEN
    RAISE EXCEPTION 'Segredo inválido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Organização inexistente';
  END IF;
  INSERT INTO public.clicksign_org_settings (organization_id) VALUES (_org) ON CONFLICT DO NOTHING;
  SELECT CASE WHEN _kind = 'access_token' THEN access_token_secret_id ELSE webhook_secret_id END
    INTO _sid FROM public.clicksign_org_settings WHERE organization_id = _org FOR UPDATE;
  _name := 'clicksign_' || _kind || '_' || _org::text;
  IF _sid IS NULL THEN
    _sid := vault.create_secret(_value, _name, 'Clicksign ' || _kind || ' (ADM MAX)');
  ELSE
    PERFORM vault.update_secret(_sid, _value);
  END IF;
  UPDATE public.clicksign_org_settings SET updated_at = now(),
    access_token_secret_id = CASE WHEN _kind = 'access_token' THEN _sid ELSE access_token_secret_id END,
    webhook_secret_id = CASE WHEN _kind = 'webhook' THEN _sid ELSE webhook_secret_id END
  WHERE organization_id = _org;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_admin_set_secret(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_admin_set_secret(uuid, text, text) TO service_role;

-- Liga/desliga, modo teste, lista da imobiliária, allowlist de teste e prazo. NULL = não altera.
-- _signer_ids: user_ids (profiles) da PRÓPRIA org que assinam pela Imobiliária; cada um precisa estar
-- ativo, ser membro ativo da org e ter nome e e-mail no cadastro. _allowlist: e-mails em claro
-- (só o sha256 é gravado).
CREATE FUNCTION public.clicksign_admin_configure(_org uuid, _enabled boolean DEFAULT NULL,
  _test_mode boolean DEFAULT NULL, _signer_ids uuid[] DEFAULT NULL, _allowlist text[] DEFAULT NULL,
  _deadline_days integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _ids uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Organização inexistente';
  END IF;
  IF _signer_ids IS NOT NULL THEN
    SELECT coalesce(array_agg(DISTINCT u), '{}') INTO _ids FROM unnest(_signer_ids) u WHERE u IS NOT NULL;
    IF cardinality(_ids) > 20 THEN RAISE EXCEPTION 'Lista de signatários inválida'; END IF;
    IF EXISTS (SELECT 1 FROM unnest(_ids) u WHERE NOT EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
        WHERE p.id = u AND p.ativo IS TRUE
          AND nullif(trim(coalesce(p.email, '')), '') IS NOT NULL
          AND nullif(trim(coalesce(p.nome, '')), '') IS NOT NULL))
    THEN RAISE EXCEPTION 'Signatário da imobiliária precisa ser usuário ativo desta organização, com nome e e-mail no cadastro'; END IF;
  END IF;
  INSERT INTO public.clicksign_org_settings (organization_id) VALUES (_org) ON CONFLICT DO NOTHING;
  UPDATE public.clicksign_org_settings SET
    enabled = coalesce(_enabled, enabled),
    test_mode = coalesce(_test_mode, test_mode),
    imobiliaria_signer_ids = coalesce(_ids, imobiliaria_signer_ids),
    test_allowlist_sha256 = CASE WHEN _allowlist IS NULL THEN test_allowlist_sha256 ELSE
      coalesce((SELECT array_agg(DISTINCT encode(extensions.digest(lower(trim(e)), 'sha256'), 'hex'))
        FROM unnest(_allowlist) e WHERE nullif(trim(e), '') IS NOT NULL), '{}') END,
    deadline_days = coalesce(_deadline_days, deadline_days),
    updated_at = now()
  WHERE organization_id = _org;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_admin_configure(uuid, boolean, boolean, uuid[], text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_admin_configure(uuid, boolean, boolean, uuid[], text[], integer)
  TO service_role;

-- Envelope ativado: marca running e passa a captação para "em assinatura" (mesma transição que o
-- botão manual "Registrar envio para assinatura externa").
CREATE FUNCTION public.clicksign_mark_sent(_envelope uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND OR _e.status <> 'sending' OR _e.envelope_key IS NULL THEN
    RAISE EXCEPTION 'Envelope em estado inválido';
  END IF;
  UPDATE public.clicksign_envelopes SET status = 'running', updated_at = now() WHERE id = _envelope;
  UPDATE public.exclusive_captures SET status = 'em_assinatura', updated_at = now()
    WHERE id = _e.capture_id AND status = 'enviada';
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (_e.capture_id, _e.created_by, 'assinatura',
      'Enviado pela Clicksign' || CASE WHEN _e.is_test THEN ' (TESTE)' ELSE '' END);
END $$;
REVOKE ALL ON FUNCTION public.clicksign_mark_sent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_mark_sent(uuid) TO service_role;

-- Anexa o PDF assinado que chegou pelo webhook. Idempotente. NÃO aprova a captação.
-- Retorna: attached | already | stale (captação devolvida ou contrato trocado) | manual_exists.
CREATE FUNCTION public.clicksign_attach_signed(_envelope uuid, _path text, _file_name text) RETURNS text
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
REVOKE ALL ON FUNCTION public.clicksign_attach_signed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_attach_signed(uuid, text, text) TO service_role;
