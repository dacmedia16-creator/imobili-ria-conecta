-- Captação: comprovante de residência POR PROPRIETÁRIO (card t_8e496afb; pedido de Denis em 19/10/2026,
-- tópico 6238). A IA lê o comprovante com escopo do proprietário e preenche só o endereço dele se vazio.
--   1) exclusive_documents: o CHECK passa a aceitar kind 'residencia' com owner_index 0 (imóvel, como
--      já existia), 1 ou 2 (proprietário). RG/CPF/CNH e os demais tipos não mudam.
--   2) exclusive_register_document: mesma regra. O resto da função é cópia sem alteração da versão
--      vigente (20261008210000).
--   O comprovante continua OPCIONAL: exclusive_transition ('enviar') não é tocada e não o exige.
--   Storage: o caminho do arquivo não depende do proprietário (org/captação/uuid.ext); nada muda.
-- Nenhum dado é alterado. CREATE OR REPLACE preserva dono e permissões.
-- Rollback: supabase/rollback/20261019200000_captacao_residencia_proprietario.sql
BEGIN;

ALTER TABLE public.exclusive_documents DROP CONSTRAINT exclusive_documents_check;
ALTER TABLE public.exclusive_documents ADD CONSTRAINT exclusive_documents_check
  CHECK ((kind IN ('rg','cpf','cnh') AND owner_index IN (1,2)) OR
         (kind = 'residencia' AND owner_index IN (0,1,2)) OR
         (kind NOT IN ('rg','cpf','cnh','residencia') AND owner_index = 0));

CREATE OR REPLACE FUNCTION public.exclusive_register_document(_id uuid, _kind text, _owner integer, _path text, _file_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _status text; _manual boolean; _mime text;
BEGIN
  SELECT status, manual INTO _status, _manual FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  -- Comprovante de residência: do imóvel (0, como antes) ou de cada proprietário (1/2) — t_8e496afb.
  IF NOT ((_kind IN ('rg','cpf','cnh') AND _owner IN (1,2)) OR
          (_kind = 'residencia' AND _owner IN (0,1,2)) OR
          (_kind IN ('iptu','matricula','gerado','assinado') AND _owner = 0))
    OR _file_name IS NULL OR length(trim(_file_name)) NOT BETWEEN 1 AND 180
    OR _path !~ ('^' || public.current_org_id()::text || '/' || _id::text || '/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$')
  THEN RAISE EXCEPTION 'Documento inválido'; END IF;
  IF _kind = 'assinado' AND _manual THEN
    -- Cadastro manual: o próprio captador anexa o contrato já assinado (PDF ou foto) antes do envio;
    -- o gestor pode substituir enquanto confere.
    IF NOT (public.exclusive_is_editor(_id, auth.uid())
            OR (public.exclusive_is_manager(_id, auth.uid()) AND _status = 'enviada'))
    THEN RAISE EXCEPTION 'Contrato assinado não pode ser anexado agora'; END IF;
  ELSIF _kind = 'assinado' THEN
    IF NOT public.exclusive_is_manager(_id, auth.uid()) OR _status NOT IN ('enviada','em_assinatura')
      OR _path !~ '[.]pdf$' THEN RAISE EXCEPTION 'Apenas gestor pode anexar contrato assinado'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id=_id AND kind='gerado')
    THEN RAISE EXCEPTION 'Gere o contrato pelo sistema antes de anexar a versão assinada'; END IF;
  ELSIF _kind = 'gerado' THEN
    -- Contrato é gerado só por gestor, team leader ou ADM, depois do envio. Manual já vem assinado.
    IF _manual OR NOT public.exclusive_is_manager(_id, auth.uid()) OR _status <> 'enviada'
      OR _path !~ '[.]pdf$' THEN RAISE EXCEPTION 'Apenas gestor, team leader ou ADM pode gerar o contrato'; END IF;
  ELSIF NOT public.exclusive_is_editor(_id, auth.uid()) THEN
    RAISE EXCEPTION 'Upload não autorizado';
  END IF;
  SELECT metadata->>'mimetype' INTO _mime FROM storage.objects
    WHERE bucket_id = 'exclusive-captures' AND name = _path;
  IF NOT FOUND OR _mime NOT IN ('application/pdf','image/jpeg','image/png','image/webp')
    OR (_kind = 'gerado' AND _mime <> 'application/pdf')
    OR (_kind = 'assinado' AND NOT _manual AND _mime <> 'application/pdf')
  THEN RAISE EXCEPTION 'Arquivo ausente ou formato inválido'; END IF;
  INSERT INTO public.exclusive_documents(capture_id,kind,owner_index,storage_path,file_name,uploaded_by)
    VALUES (_id,_kind,_owner,_path,trim(_file_name),auth.uid())
    ON CONFLICT (capture_id,kind,owner_index) DO UPDATE
      SET storage_path=excluded.storage_path,file_name=excluded.file_name,
          uploaded_by=excluded.uploaded_by,created_at=now();
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id,auth.uid(),'documento_anexado',_kind || ':' || _owner::text);
END $function$;

COMMIT;
