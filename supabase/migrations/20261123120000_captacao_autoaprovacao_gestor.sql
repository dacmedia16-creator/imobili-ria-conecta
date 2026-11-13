-- Captação do próprio gestor/TL aprovada automaticamente quando a Clicksign devolve o contrato assinado
-- (t_e433a198, decisão de Denis 13/11/2026, tópico 6238).
--
-- Onde: dentro de clicksign_attach_signed (chamada pelo webhook clicksign-webhook no document_closed), na
-- MESMA transação que anexa o PDF assinado. Assim:
--   * idempotente: o webhook repetido cai em "signed_document_id IS NOT NULL → 'already'" antes de tudo,
--     e o envelope e a captação ficam travados (FOR UPDATE) durante a aprovação;
--   * o retorno continua 'attached' (a Edge Function não muda);
--   * se a aprovação automática falhar por qualquer motivo, o anexo continua valendo e a captação fica
--     aguardando a aprovação manual, como hoje (subtransação com EXCEPTION).
-- Regras (todas precisam valer):
--   1) fluxo normal (não é cadastro manual), envelope REAL (não modo teste), captação não arquivada/descartada;
--   2) quem capta (captor_id) é gestor ou team leader ATIVO da mesma imobiliária;
--   3) PDF gerado pelo sistema antes do assinado (já garantido pelas travas de cima: _gerado e status);
--   4) Plano de Marketing ok (mesma regra de exclusive_plano_ok / 'aprovar' manual, escrita inline: a função
--      original depende do JWT e, no webhook, responderia "ok" com o Plano vazio).
-- Aprovação igual à manual: status 'aprovada', signed_on = coalesce(signed_on, hoje SP), histórico 'aprovar'
-- (autor = o próprio gestor/TL, detalhe "Aprovada automaticamente: …"). Corretor comum, cadastro manual e
-- falta de Plano: nada muda (continua aguardando o gestor). Devolver depois continua igual (exclusive_transition
-- não é alterada).
-- Aviso: no "todos assinaram" da captação aprovada sozinha, o sino diz que já foi aprovada e o WhatsApp usa o
-- evento novo 'aprovada_auto' (texto próprio no Worker). Os demais avisos ficam iguais.
-- Rollback: supabase/rollback/20261123120000_captacao_autoaprovacao_gestor.sql
BEGIN;

ALTER TABLE public.clicksign_whatsapp_fila DROP CONSTRAINT clicksign_whatsapp_fila_evento_check;
ALTER TABLE public.clicksign_whatsapp_fila ADD CONSTRAINT clicksign_whatsapp_fila_evento_check
  CHECK (evento IN ('enviado','finalizado','recusado','prazo_perto','aprovada_auto'));

-- Captador é gestor/TL ativo da imobiliária da captação (sem depender do JWT: roda no webhook).
CREATE OR REPLACE FUNCTION public.exclusive_captor_eh_gestor(_c public.exclusive_captures)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT _c.captor_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = _c.captor_id AND p.organization_id = _c.organization_id AND p.ativo IS TRUE)
    -- Vínculo ativo com a imobiliária (o que is_active_user confere no caminho manual).
    AND EXISTS (SELECT 1 FROM public.organization_members m
                 WHERE m.user_id = _c.captor_id AND m.organization_id = _c.organization_id AND m.ativo IS TRUE)
    AND EXISTS (SELECT 1 FROM public.user_roles r
                 WHERE r.user_id = _c.captor_id AND r.organization_id = _c.organization_id
                   AND r.role IN ('gestor','team_leader'))
$function$;
REVOKE ALL ON FUNCTION public.exclusive_captor_eh_gestor(public.exclusive_captures) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_captor_eh_gestor(public.exclusive_captures) TO service_role;

CREATE OR REPLACE FUNCTION public.clicksign_attach_signed(_envelope uuid, _path text, _file_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _st text; _gerado timestamptz; _doc uuid; _mime text;
  _c public.exclusive_captures%ROWTYPE; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
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
  -- Aprovação automática da captação do próprio gestor/TL (t_e433a198). Antes de fechar o envelope, para o
  -- aviso "todos assinaram" (gatilho do envelope) já saber que a captação foi aprovada.
  BEGIN
    SELECT * INTO _c FROM public.exclusive_captures WHERE id = _e.capture_id;
    -- Plano de Marketing: MESMA regra de exclusive_plano_ok, escrita aqui porque aquela função tem dono
    -- mt_1b_definer (sem bypass de RLS) e, sem JWT (webhook), não enxerga módulos/ações e responde "ok"
    -- com o Plano vazio. shortcut: se a regra de exclusive_plano_ok mudar, mudar aqui também.
    IF NOT _e.is_test AND NOT _c.manual AND _c.archived_at IS NULL AND _c.discarded_at IS NULL
       AND public.exclusive_captor_eh_gestor(_c)
       AND (NOT (coalesce((SELECT m.enabled FROM public.organization_modules m
                            WHERE m.organization_id = _c.organization_id
                              AND m.module = 'feedback_proprietario'), false)
                 AND EXISTS (SELECT 1 FROM public.owner_feedback_actions a
                              WHERE a.organization_id = _c.organization_id AND a.list = 'marketing' AND a.active))
            OR EXISTS (SELECT 1 FROM public.owner_feedback_actions a
                        WHERE a.organization_id = _c.organization_id AND a.list = 'marketing' AND a.active
                          AND jsonb_typeof(_c.form_data->'dossie') = 'array'
                          AND (_c.form_data->'dossie') ? a.id::text)) THEN
      UPDATE public.exclusive_captures SET status = 'aprovada', updated_at = now(),
        signed_on = coalesce(signed_on, _hoje) WHERE id = _c.id;
      INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
        VALUES (_c.id, _c.captor_id, 'aprovar',
          'Aprovada automaticamente: contrato assinado pela Clicksign e Plano de Marketing marcado (captação do próprio gestor/team leader)');
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'captação: aprovação automática não aconteceu: %', left(SQLERRM, 120);
  END;
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
DECLARE _r text; _venda boolean := NEW.origem = 'venda'; _auto boolean;
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
      -- Captação do próprio gestor/TL já aprovada na mesma transação (clicksign_attach_signed).
      _auto := NOT _venda AND EXISTS (SELECT 1 FROM public.exclusive_captures c
        WHERE c.id = NEW.capture_id AND c.status = 'aprovada');
      PERFORM public.clicksign_aviso(NEW, 'finalizado',
        CASE WHEN _auto THEN 'aprovada_auto' ELSE 'finalizado' END,
        _r || ': todos assinaram',
        CASE WHEN _venda THEN 'O contrato assinado foi anexado à venda e está disponível para baixar.'
          WHEN _auto THEN 'O contrato assinado está disponível para baixar. A captação foi aprovada automaticamente.'
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

COMMIT;
