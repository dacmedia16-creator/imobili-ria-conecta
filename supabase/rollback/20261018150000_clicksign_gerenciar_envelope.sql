-- Rollback da migration 20261018150000_clicksign_gerenciar_envelope.sql (cartão t_9e0dfc77).
-- Remove as RPCs novas, restaura clicksign_capture_config como em 20261018120000 e tira as colunas
-- last_notified_at / action_lock_until. O histórico já gravado (clicksign_aviso / clicksign_signatario)
-- e os signatários atualizados (só hash) são mantidos.
-- ATENÇÃO: publicar o frontend anterior junto e remover a edge function clicksign-manage.
BEGIN;
DROP FUNCTION IF EXISTS public.clicksign_capture_signed(uuid);
DROP FUNCTION IF EXISTS public.clicksign_manage_done(uuid, uuid, text, text, jsonb, boolean);
DROP FUNCTION IF EXISTS public.clicksign_manage_lock(uuid, text);
DROP FUNCTION IF EXISTS public.clicksign_manage_authorize(uuid);

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
        'signed', e.signed_document_id IS NOT NULL)
      FROM public.clicksign_envelopes e WHERE e.capture_id = _id
      ORDER BY e.created_at DESC LIMIT 1));
END $$;

ALTER TABLE public.clicksign_envelopes
  DROP COLUMN IF EXISTS action_lock_until,
  DROP COLUMN IF EXISTS last_notified_at;
COMMIT;
