-- Rollback de 20261123120000_captacao_autoaprovacao_gestor (t_e433a198).
-- Volta clicksign_attach_signed e clicksign_envelope_aviso_trg aos corpos de produção de 13/11/2026
-- (pg_get_functiondef), apaga a função nova e devolve a lista de eventos do WhatsApp.
-- NÃO desfaz aprovações automáticas já feitas: elas ficam como aprovações normais (o gestor pode devolver
-- pela tela, como hoje). Para listá-las: exclusive_history action='aprovar' AND detail LIKE 'Aprovada automaticamente%'.
BEGIN;

CREATE OR REPLACE FUNCTION public.clicksign_attach_signed(_envelope uuid, _path text, _file_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.clicksign_envelope_aviso_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _r text; _venda boolean := NEW.origem = 'venda';
BEGIN
  BEGIN
    _r := public.clicksign_aviso_rotulo(NEW);
    IF NEW.status = 'running' AND OLD.status IS DISTINCT FROM 'running' THEN
      PERFORM public.clicksign_aviso(NEW, 'enviado', 'enviado',
        _r || ': contrato enviado para assinatura',
        'Enviado pela Clicksign' || CASE WHEN NEW.is_test THEN ' (TESTE)' ELSE '' END
          || coalesce('. Prazo para assinar: ' || public.clicksign_data_br(NEW.deadline_at), '') || '.',
        true, NEW.created_by);
    ELSIF NEW.status = 'closed' AND NEW.signed_document_id IS NOT NULL
          AND OLD.signed_document_id IS NULL THEN
      PERFORM public.clicksign_aviso(NEW, 'finalizado', 'finalizado',
        _r || ': todos assinaram',
        CASE WHEN _venda THEN 'O contrato assinado foi anexado à venda e está disponível para baixar.'
          ELSE 'O contrato assinado está disponível para baixar. O gestor precisa aprovar a captação.' END,
        true, NULL);
    ELSIF NEW.status = 'canceled' AND OLD.status IS DISTINCT FROM 'canceled' THEN
      IF NEW.last_event = 'refusal' THEN
        PERFORM public.clicksign_aviso(NEW, 'recusado', 'recusado',
          _r || ': assinatura recusada',
          'Um signatário recusou a assinatura na Clicksign e o envio foi cancelado. Confira e envie o contrato de novo.',
          true, NULL);
      ELSIF NEW.last_event = 'deadline' THEN
        PERFORM public.clicksign_aviso(NEW, 'prazo_vencido', 'prazo_vencido',
          _r || ': prazo da assinatura venceu',
          'O prazo na Clicksign venceu sem todas as assinaturas e o envio foi cancelado. Envie o contrato de novo.',
          false, NULL);
      ELSE
        PERFORM public.clicksign_aviso(NEW, 'cancelado', 'cancelado',
          _r || ': assinatura cancelada', 'O envio pela Clicksign foi cancelado.', false, NULL);
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'clicksign aviso falhou: %', left(SQLERRM, 120);
  END;
  RETURN NULL;
END $function$;

DROP FUNCTION IF EXISTS public.exclusive_captor_eh_gestor(public.exclusive_captures);

-- Evento novo vira o 'finalizado' antigo antes de recolocar a lista fechada. O que ainda não foi enviado
-- é encerrado como ignorado (senão iria "O gestor precisa aprovar" para captação já aprovada).
UPDATE public.clicksign_whatsapp_fila SET sent_at = now(), last_error = 'rollback_aprovada_auto'
  WHERE evento = 'aprovada_auto' AND sent_at IS NULL;
UPDATE public.clicksign_whatsapp_fila SET evento = 'finalizado' WHERE evento = 'aprovada_auto';
ALTER TABLE public.clicksign_whatsapp_fila DROP CONSTRAINT clicksign_whatsapp_fila_evento_check;
ALTER TABLE public.clicksign_whatsapp_fila ADD CONSTRAINT clicksign_whatsapp_fila_evento_check
  CHECK (evento IN ('enviado','finalizado','recusado','prazo_perto'));

COMMIT;
