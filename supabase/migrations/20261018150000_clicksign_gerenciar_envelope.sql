-- Clicksign na CAPTAÇÃO — gestão do envelope em assinatura (cartão t_9e0dfc77; aprovado por Denis em
-- 18/10/2026): editar signatário que ainda não assinou, "Reenviar aviso" com espera mínima e dados
-- para o novo passo "Documento assinado". Rollback: supabase/rollback/20261018150000_clicksign_gerenciar_envelope.sql
-- Quem pode: gestor, jurídico, admin e super_admin da mesma org (mesma regra do envio).
-- Nenhum e-mail em claro entra no banco: signers continua só com o sha256.

ALTER TABLE public.clicksign_envelopes
  ADD COLUMN last_notified_at timestamptz,
  -- Trava curta (2 min) contra duplo clique/duas abas em reenviar/editar.
  ADD COLUMN action_lock_until timestamptz;

-- Autoriza gerenciar o envelope em assinatura da captação. Chamada pela edge function COM o JWT do
-- usuário. Devolve {org, envelope} do envelope running mais recente; falha = exceção clara.
CREATE FUNCTION public.clicksign_manage_authorize(_id uuid) RETURNS jsonb
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
REVOKE ALL ON FUNCTION public.clicksign_manage_authorize(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_manage_authorize(uuid) TO authenticated;

-- Trava atômica (service_role). 'notify': respeita 10 min desde o último aviso. Retorna ok|busy|cooldown.
CREATE FUNCTION public.clicksign_manage_lock(_envelope uuid, _kind text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  IF _kind NOT IN ('notify','edit') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND OR _e.status <> 'running' THEN RAISE EXCEPTION 'Envelope em estado inválido'; END IF;
  IF _e.action_lock_until IS NOT NULL AND _e.action_lock_until > now() THEN RETURN 'busy'; END IF;
  IF _kind = 'notify' AND _e.last_notified_at IS NOT NULL
      AND _e.last_notified_at > now() - interval '10 minutes' THEN
    RETURN 'cooldown';
  END IF;
  UPDATE public.clicksign_envelopes SET action_lock_until = now() + interval '2 minutes'
    WHERE id = _envelope;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.clicksign_manage_lock(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_manage_lock(uuid, text) TO service_role;

-- Fecha a ação (service_role): solta a trava, grava signatários (só hash) e o horário do aviso e
-- registra no histórico da captação. _action NULL = só solta a trava (ação não feita).
CREATE FUNCTION public.clicksign_manage_done(_envelope uuid, _actor uuid, _action text,
  _detail text DEFAULT NULL, _signers jsonb DEFAULT NULL, _notified boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _action IS NOT NULL AND _action NOT IN ('clicksign_aviso','clicksign_signatario') THEN
    RAISE EXCEPTION 'Ação inválida';
  END IF;
  IF _signers IS NOT NULL AND (jsonb_typeof(_signers) <> 'array'
      OR jsonb_array_length(_signers) <> jsonb_array_length(_e.signers) OR _signers::text ~ '@') THEN
    RAISE EXCEPTION 'Signatários inválidos';
  END IF;
  IF _detail IS NOT NULL AND (length(_detail) > 500 OR _detail ~ '@') THEN
    RAISE EXCEPTION 'Detalhe inválido';
  END IF;
  UPDATE public.clicksign_envelopes SET
    action_lock_until = NULL,
    signers = coalesce(_signers, signers),
    last_notified_at = CASE WHEN _notified THEN now() ELSE last_notified_at END,
    -- Aviso confirmado: some o alerta "notificação falhou" do envio.
    error_code = CASE WHEN _notified AND error_code LIKE 'notify_failed:%' THEN NULL ELSE error_code END,
    updated_at = now()
  WHERE id = _envelope;
  IF _action IS NOT NULL THEN
    INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
      VALUES (_e.capture_id, coalesce(_actor, _e.created_by), _action, _detail);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_manage_done(uuid, uuid, text, text, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_manage_done(uuid, uuid, text, text, jsonb, boolean)
  TO service_role;

-- Configuração para a TELA: igual à anterior + horário do último aviso e quando o próximo libera.
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

-- Passo "Documento assinado": quem assinou pela Clicksign (nome e papel, sem e-mail) e quando o
-- envelope fechou. Funciona mesmo com a integração desligada depois (captações antigas).
-- Devolve NULL se o assinado atual não veio da Clicksign.
CREATE FUNCTION public.clicksign_capture_signed(_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('document_id', d.id, 'is_test', e.is_test, 'closed_at', e.updated_at,
    'signers', coalesce((SELECT jsonb_agg(jsonb_build_object('papel', x->>'papel', 'nome', x->>'nome'))
      FROM jsonb_array_elements(e.signers) x), '[]'::jsonb))
  FROM public.clicksign_envelopes e
  JOIN public.exclusive_documents d ON d.id = e.signed_document_id AND d.kind = 'assinado'
  WHERE e.capture_id = _id AND e.organization_id = public.current_org_id()
    AND auth.uid() IS NOT NULL AND public.exclusive_can_view(_id, auth.uid())
  ORDER BY e.updated_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.clicksign_capture_signed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_capture_signed(uuid) TO authenticated;
