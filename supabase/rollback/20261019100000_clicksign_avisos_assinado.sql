-- Rollback de 20261019100000_clicksign_avisos_assinado.sql (cartão t_f8dc8b99). Volta a policy de
-- exclusive_documents à versão de 20261008160000 (assinado só para gestor/admin ou após a aprovação),
-- remove gatilhos, funções, a fila de WhatsApp, a tabela de avisos e a coluna deadline_at.
-- Não apaga envelopes, eventos nem notificações já gravadas no sino. Rodar numa transação só.
BEGIN;
DROP TRIGGER IF EXISTS clicksign_envelope_aviso ON public.clicksign_envelopes;
DROP TRIGGER IF EXISTS clicksign_envelope_prazo ON public.clicksign_envelopes;

DROP POLICY IF EXISTS exclusive_documents_read ON public.exclusive_documents;
CREATE POLICY exclusive_documents_read ON public.exclusive_documents
  FOR SELECT TO authenticated
  USING (
    public.exclusive_can_view(capture_id, (SELECT auth.uid()))
    AND (
      kind NOT IN ('gerado','assinado')
      OR public.exclusive_is_manager(capture_id, (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.exclusive_captures c
                 WHERE c.id = exclusive_documents.capture_id
                   AND (c.status = 'aprovada' OR (c.manual AND exclusive_documents.kind = 'assinado')))
    )
  );

DROP FUNCTION IF EXISTS public.clicksign_whatsapp_marcar(bigint, text, text);
DROP FUNCTION IF EXISTS public.clicksign_whatsapp_pendentes(integer);
DROP FUNCTION IF EXISTS public.clicksign_lembrete_prazo(timestamptz);
DROP FUNCTION IF EXISTS public.clicksign_aviso_assinou(uuid, text, bigint);
DROP FUNCTION IF EXISTS public.clicksign_papel_por_sha(public.clicksign_envelopes, text);
DROP FUNCTION IF EXISTS public.clicksign_envelope_aviso_trg();
DROP FUNCTION IF EXISTS public.clicksign_envelope_prazo_trg();
DROP FUNCTION IF EXISTS public.clicksign_aviso(public.clicksign_envelopes, text, text, text, text, boolean, uuid);
DROP FUNCTION IF EXISTS public.clicksign_aviso_destinos(public.clicksign_envelopes, uuid);
DROP FUNCTION IF EXISTS public.clicksign_aviso_rotulo(public.clicksign_envelopes);
DROP FUNCTION IF EXISTS public.clicksign_data_br(timestamptz);
DROP FUNCTION IF EXISTS public.clicksign_assinado_liberado(uuid, uuid, uuid);
DROP TABLE IF EXISTS public.clicksign_whatsapp_fila;
DROP TABLE IF EXISTS public.clicksign_avisos;
ALTER TABLE public.clicksign_envelopes DROP COLUMN IF EXISTS deadline_at;
COMMIT;
