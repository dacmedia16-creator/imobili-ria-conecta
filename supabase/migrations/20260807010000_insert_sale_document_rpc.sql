-- Mesmo bug de "new row violates row-level security policy for table sale_documents" já
-- documentado e corrigido para exclusão (archive_sale_document, 20260805000000) também acontece no
-- ENVIO de documento: corretor com permissão confirmada correta (can_view_sale/can_edit_sale_stage/
-- is_sale_locked todos true) tem o INSERT direto em sale_documents rejeitado de forma inconsistente
-- pela camada do PostgREST. Mesmo contorno: move a escrita pra uma função SECURITY DEFINER que
-- reaplica a checagem uma única vez aqui dentro e insere com privilégio elevado.
CREATE OR REPLACE FUNCTION public.insert_sale_document(
  _sale_id uuid,
  _tipo text,
  _parte text,
  _storage_path text,
  _file_name text,
  _status public.doc_status DEFAULT 'enviado',
  _descricao text DEFAULT NULL,
  _extraction_status text DEFAULT 'none'
)
RETURNS public.sale_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row public.sale_documents;
BEGIN
  IF NOT public.can_view_sale(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Sem permissão para acessar esta venda.';
  END IF;

  IF public.is_sale_locked(_sale_id) AND NOT public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Venda travada — só financeiro/admin podem editar documentos agora.';
  END IF;

  IF NOT public.can_edit_sale_stage(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Você não pode editar documentos nesta etapa da venda.';
  END IF;

  INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, uploaded_by, status, descricao, extraction_status)
  VALUES (_sale_id, _tipo, _parte, _storage_path, _file_name, auth.uid(), _status, _descricao, _extraction_status)
  RETURNING * INTO _row;

  RETURN _row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.insert_sale_document(uuid, text, text, text, text, public.doc_status, text, text) TO authenticated;
