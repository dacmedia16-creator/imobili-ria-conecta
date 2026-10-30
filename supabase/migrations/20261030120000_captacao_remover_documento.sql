-- t_5ab6dad4 — Captação: remover documento anexado por engano (sem enviar outro no lugar).
-- Aditiva: só cria a função exclusive_remove_document; nenhuma tabela, policy ou dado alterado.
--
-- Regra:
--  * só o editor da captação (exclusive_is_editor: quem vê a captação, na mesma imobiliária, com
--    status rascunho/devolvida e não arquivada) remove;
--  * 'gerado' nunca é removido por aqui; 'assinado' só na captação manual (mesma regra de anexar
--    do editor em rascunho/devolvida). O 'assinado' da captação normal continua só com o gestor;
--  * apaga a linha de exclusive_documents e grava exclusive_history 'documento_removido'.
--
-- Arquivo do Storage: o Supabase barra DELETE direto em storage.objects (trigger
-- protect_objects_delete), e o bucket exclusive-captures não tem policy de DELETE. Por isso a
-- função DEVOLVE o storage_path e a server function removerDocumentoCaptacao apaga o objeto
-- (service_role) depois de conferir que ele pertence a esta captação e que nenhuma linha o usa.
-- Rollback: supabase/rollback/20261030120000_captacao_remover_documento.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.exclusive_remove_document(_id uuid, _kind text, _owner integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _status text; _manual boolean; _path text;
BEGIN
  SELECT status, manual INTO _status, _manual FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  IF NOT ((_kind IN ('rg','cpf','cnh') AND _owner BETWEEN 1 AND 60) OR
          (_kind = 'residencia' AND _owner BETWEEN 0 AND 60) OR
          (_kind IN ('iptu','matricula','gerado','assinado') AND _owner = 0))
  THEN RAISE EXCEPTION 'Documento inválido'; END IF;
  IF _kind = 'gerado' OR (_kind = 'assinado' AND NOT _manual) THEN
    RAISE EXCEPTION 'Este documento não pode ser removido';
  END IF;
  IF _status NOT IN ('rascunho','devolvida') OR NOT public.exclusive_is_editor(_id, auth.uid()) THEN
    RAISE EXCEPTION 'Remoção não autorizada';
  END IF;
  DELETE FROM public.exclusive_documents
   WHERE capture_id = _id AND kind = _kind AND owner_index = _owner
  RETURNING storage_path INTO _path;
  IF _path IS NULL THEN RAISE EXCEPTION 'Documento não encontrado'; END IF;
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),'documento_removido',_kind || ':' || _owner::text);
  RETURN _path;
END $function$;
REVOKE ALL ON FUNCTION public.exclusive_remove_document(uuid,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_remove_document(uuid,text,integer) TO authenticated;

COMMIT;
