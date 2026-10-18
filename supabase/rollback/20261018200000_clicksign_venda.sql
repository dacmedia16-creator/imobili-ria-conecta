-- Rollback da migration 20261018200000_clicksign_venda.sql (cartão t_70734b3a).
-- Remove as RPCs/gatilhos da venda, restaura validate_sale_status_transition e clicksign_manage_done
-- como antes e volta clicksign_envelopes a só captação.
-- ATENÇÃO: só rode sem envelope de venda em andamento (o bloco abaixo recusa). Envelopes de venda já
-- encerrados são APAGADOS do rastreio (o contrato_assinado anexado e o histórico da venda ficam).
-- As colunas occurrence_partners.email e sales.parceria_email ficam (aditivas, podem ter dados).
-- Publicar o frontend anterior junto e remover a edge function clicksign-sale.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.clicksign_envelopes WHERE origem = 'venda' AND status IN ('sending','running')) THEN
    RAISE EXCEPTION 'Há envelope de venda em andamento: cancele na Clicksign antes do rollback';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_zz_clicksign_contrato_novo ON public.sale_documents;
DROP TRIGGER IF EXISTS trg_zz_clicksign_saiu_assinatura ON public.sales;
DROP FUNCTION IF EXISTS public.trg_clicksign_sale_contrato_novo();
DROP FUNCTION IF EXISTS public.trg_clicksign_sale_saiu_assinatura();
DROP FUNCTION IF EXISTS public.clicksign_sale_request_cancel(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_attach_signed(uuid, text, text);
DROP FUNCTION IF EXISTS public.clicksign_sale_canceled(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_mark_sent(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_notify(public.clicksign_envelopes, text, text);
DROP FUNCTION IF EXISTS public.clicksign_sale_set_status(uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.clicksign_sale_resolve_extras(uuid, uuid, text[]);
DROP FUNCTION IF EXISTS public.clicksign_sale_signed(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_extra_candidates(uuid, text);
DROP FUNCTION IF EXISTS public.clicksign_mask_email(text);
DROP FUNCTION IF EXISTS public.clicksign_sale_manage_authorize(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_authorize(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_config(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_contrato(uuid);

-- clicksign_manage_done como em 20261018150000 (histórico só da captação).
CREATE OR REPLACE FUNCTION public.clicksign_manage_done(_envelope uuid, _actor uuid, _action text,
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

DROP POLICY IF EXISTS clicksign_envelopes_read_venda ON public.clicksign_envelopes;
REVOKE SELECT (origem, sale_id, cancel_requested_at, cancel_reason) ON public.clicksign_envelopes FROM authenticated;
DELETE FROM public.clicksign_envelopes WHERE origem = 'venda';
DROP INDEX IF EXISTS public.clicksign_envelopes_venda_um_ativo;
DROP INDEX IF EXISTS public.clicksign_envelopes_sale_idx;
ALTER TABLE public.clicksign_envelopes
  DROP CONSTRAINT IF EXISTS clicksign_envelopes_sale_fk,
  DROP CONSTRAINT IF EXISTS clicksign_envelopes_alvo_check,
  DROP CONSTRAINT IF EXISTS clicksign_envelopes_origem_check,
  DROP COLUMN IF EXISTS cancel_reason,
  DROP COLUMN IF EXISTS cancel_requested_at,
  DROP COLUMN IF EXISTS sale_id,
  ALTER COLUMN capture_id SET NOT NULL,
  ADD CONSTRAINT clicksign_envelopes_origem_check CHECK (origem IN ('captacao'));
COMMIT;
-- validate_sale_status_transition: reaplique o bloco CREATE OR REPLACE de
-- supabase/migrations/20261009070000_criador_edita_rascunho.sql (versão anterior, sem o bloco Clicksign).
-- O bloco novo só libera transições sem usuário logado E com a marca clicksign.sale; sem as RPCs acima
-- ninguém define essa marca, então manter a versão nova também é seguro.
