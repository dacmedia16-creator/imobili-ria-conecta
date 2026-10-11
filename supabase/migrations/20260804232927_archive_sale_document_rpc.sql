-- Vários corretores relataram não conseguir excluir (arquivar) um documento próprio mesmo com a
-- permissão confirmada correta em testes diretos no banco (can_view_sale/can_edit_sale_stage/
-- is_sale_locked todos retornam true para o usuário/venda/documento em questão) — reproduzido em
-- computadores e vendas diferentes, então não é sessão/cache de navegador. A causa exata na camada
-- do PostgREST não foi identificada, mas a UPDATE direta em sale_documents (sujeita a RLS a cada
-- request) está falhando de forma inconsistente pra usuários reais. Contorna o problema movendo a
-- operação pra uma função SECURITY DEFINER: reaplica a mesma checagem (já provada correta) uma
-- única vez aqui dentro, e executa a escrita com privilégio elevado — igual ao padrão já usado em
-- update_contrato_pendencia.
CREATE OR REPLACE FUNCTION public.archive_sale_document(_document_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _sale_id uuid;
BEGIN
  SELECT sale_id INTO _sale_id FROM public.sale_documents WHERE id = _document_id;
  IF _sale_id IS NULL THEN
    RAISE EXCEPTION 'Documento não encontrado.';
  END IF;

  IF NOT public.can_view_sale(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Sem permissão para acessar esta venda.';
  END IF;

  IF public.is_sale_locked(_sale_id) AND NOT public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Venda travada — só financeiro/admin podem editar documentos agora.';
  END IF;

  IF NOT public.can_edit_sale_stage(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Você não pode editar documentos nesta etapa da venda.';
  END IF;

  -- Extração de IA é cache derivado, não o documento fonte — descartada junto (mesmo comportamento
  -- de antes), agora na mesma transação da baixa lógica (não fica mais em duas chamadas separadas
  -- do cliente, cada uma sujeita à sua própria checagem de RLS).
  DELETE FROM public.document_extractions WHERE document_id = _document_id;

  UPDATE public.sale_documents
  SET deleted_at = now(), deleted_by = auth.uid()
  WHERE id = _document_id;
END;
$function$;
