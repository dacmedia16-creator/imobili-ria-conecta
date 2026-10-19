-- Rollback de 20261019200000_captacao_residencia_proprietario.sql (card t_8e496afb).
-- Volta o CHECK e exclusive_register_document às versões anteriores (20260925100000 e 20261008210000,
-- copiadas sem alteração). ATENÇÃO: o CHECK antigo recusa comprovante de residência com proprietário
-- (owner_index 1/2). Se já houver algum, o rollback PARA com erro e nada muda — decida antes se esses
-- registros serão apagados (o arquivo no storage fica) ou mantidos sem rollback. Consulta:
--   SELECT id, capture_id, owner_index FROM public.exclusive_documents
--    WHERE kind = 'residencia' AND owner_index <> 0;
-- Publicar junto o frontend anterior (sem o campo no cartão do proprietário).
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.exclusive_documents WHERE kind = 'residencia' AND owner_index <> 0)
  THEN RAISE EXCEPTION 'Há comprovantes de residência de proprietário; trate-os antes do rollback'; END IF;
END $$;

ALTER TABLE public.exclusive_documents DROP CONSTRAINT exclusive_documents_check;
ALTER TABLE public.exclusive_documents ADD CONSTRAINT exclusive_documents_check
  CHECK ((kind IN ('rg','cpf','cnh') AND owner_index IN (1,2)) OR
         (kind NOT IN ('rg','cpf','cnh') AND owner_index = 0));

-- 20261008210000 (sem alteração)
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
  IF NOT ((_kind IN ('rg','cpf','cnh') AND _owner IN (1,2)) OR
          (_kind IN ('residencia','iptu','matricula','gerado','assinado') AND _owner = 0))
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
