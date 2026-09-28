-- Marco 1c: Storage com prefixo <organization_id>/; apenas clone local, após 1a+1b.
-- Objetos antigos NÃO são renomeados no catálogo: o blob físico permaneceria no caminho antigo.
-- A Única Escolha lê/remove legado sob autorização original; novas escritas exigem prefixo.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects') <> 17
    OR (SELECT count(*) FROM storage.buckets WHERE id IN
      ('avatars','sale-documents','exclusive-captures','exclusive-templates')) <> 4
  THEN RAISE EXCEPTION 'Catálogo de Storage divergente; abortando 1c'; END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN
    ('sale-documents','exclusive-captures','exclusive-templates') AND public IS DISTINCT FROM false)
  THEN RAISE EXCEPTION 'Bucket com documentos privados configurado como publico'; END IF;
END $$;

-- Snapshot das políticas para restauração exata (sem alterar objetos reais).
CREATE TABLE public.mt_1c_policy_backup AS
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='storage' AND tablename='objects';
REVOKE ALL ON public.mt_1c_policy_backup FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.mt_1c_relative_path(_name text) RETURNS text
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT CASE WHEN public.current_org_id() IS NOT NULL
    AND split_part(_name,'/',1)=public.current_org_id()::text
    THEN substr(_name,length(public.current_org_id()::text)+2) ELSE _name END
$$;
CREATE FUNCTION public.mt_1c_storage_scope(_bucket text, _name text, _new_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT COALESCE(public.current_org_id() IS NOT NULL AND _bucket IN
    ('sale-documents','exclusive-captures','exclusive-templates','avatars')
    AND CASE WHEN split_part(_name,'/',1)=public.current_org_id()::text
      THEN public.mt_1c_relative_path(_name) <> ''
      ELSE NOT _new_only AND public.current_org_id()=public.legacy_default_org_id()
        AND CASE _bucket
          WHEN 'sale-documents' THEN EXISTS (SELECT 1 FROM public.sales s
            WHERE s.id::text=split_part(_name,'/',1) AND s.organization_id=public.current_org_id())
          WHEN 'exclusive-captures' THEN EXISTS (SELECT 1 FROM public.exclusive_captures c
            WHERE c.id::text=split_part(_name,'/',1) AND c.organization_id=public.current_org_id())
          WHEN 'avatars' THEN EXISTS (SELECT 1 FROM public.profiles p
            WHERE p.id::text=split_part(_name,'/',1) AND p.organization_id=public.current_org_id())
          WHEN 'exclusive-templates' THEN _name IN ('campolim.pdf','barao-de-tatui.pdf')
          ELSE false END END,false)
$$;
REVOKE ALL ON FUNCTION public.mt_1c_relative_path(text),public.mt_1c_storage_scope(text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mt_1c_relative_path(text),public.mt_1c_storage_scope(text,text,boolean) TO authenticated,service_role;

-- Restritiva combina por AND com TODAS as permissivas; SELECT vale também para list e signed URL.
CREATE POLICY mt_1c_scope_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.mt_1c_storage_scope(bucket_id,name));
CREATE POLICY mt_1c_scope_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.mt_1c_storage_scope(bucket_id,name,true));
CREATE POLICY mt_1c_scope_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.mt_1c_storage_scope(bucket_id,name,true))
  WITH CHECK (public.mt_1c_storage_scope(bucket_id,name,true));
CREATE POLICY mt_1c_scope_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.mt_1c_storage_scope(bucket_id,name));

-- Originais referiam o primeiro segmento (venda/captação/usuário). Em novos objetos,
-- esse segmento agora é a agência; manter as autorizações de função, mas usar o caminho relativo.
DO $$ DECLARE p text; BEGIN
  FOREACH p IN ARRAY ARRAY['docs_select','docs_insert','docs_update','docs_delete',
    'co_leader_storage_read','co_leader_storage_insert','co_leader_storage_update',
    'juridico_returned_storage_read','juridico_certidao_storage_insert',
    'exclusive_storage_read','exclusive_storage_insert','exclusive_storage_signed_insert',
    'exclusive_templates_read','avatars_select','avatars_insert','avatars_update','avatars_delete']
  LOOP EXECUTE format('DROP POLICY %I ON storage.objects',p); END LOOP;
END $$;

CREATE POLICY docs_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='sale-documents' AND EXISTS (SELECT 1 FROM public.sales s
  WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1) AND public.can_view_sale(auth.uid(),s.id)));
CREATE POLICY docs_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='sale-documents' AND EXISTS (SELECT 1 FROM public.sales s
  WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1)
    AND public.can_view_sale(auth.uid(),s.id) AND public.can_edit_sale_stage(auth.uid(),s.id)));
CREATE POLICY docs_update ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id='sale-documents' AND EXISTS (SELECT 1 FROM public.sales s
  WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1)
    AND public.can_view_sale(auth.uid(),s.id) AND public.can_edit_sale_stage(auth.uid(),s.id)))
  WITH CHECK (bucket_id='sale-documents' AND EXISTS (SELECT 1 FROM public.sales s
  WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1)
    AND public.can_view_sale(auth.uid(),s.id) AND public.can_edit_sale_stage(auth.uid(),s.id)));
CREATE POLICY docs_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id='sale-documents' AND EXISTS (SELECT 1 FROM public.sales s
  WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1)
    AND public.can_view_sale(auth.uid(),s.id) AND public.can_edit_sale_stage(auth.uid(),s.id)));
CREATE POLICY co_leader_storage_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='sale-documents' AND EXISTS (SELECT 1 FROM public.sales s
  WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1) AND public.can_manage_sale_as_co_leader(s.id)));
CREATE POLICY co_leader_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='sale-documents' AND EXISTS (SELECT 1 FROM public.sales s
  WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1) AND public.can_edit_sale_as_co_leader(s.id)));
CREATE POLICY co_leader_storage_update ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id='sale-documents' AND EXISTS (SELECT 1 FROM public.sales s
  WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1) AND public.can_edit_sale_as_co_leader(s.id)))
  WITH CHECK (bucket_id='sale-documents' AND EXISTS (SELECT 1 FROM public.sales s
  WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1) AND public.can_edit_sale_as_co_leader(s.id)));
CREATE POLICY juridico_returned_storage_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='sale-documents' AND EXISTS (SELECT 1 FROM public.sales s
  WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1) AND public.can_read_sale_juridico_certidao(s.id)));
CREATE POLICY juridico_certidao_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='sale-documents' AND split_part(public.mt_1c_relative_path(name),'/',2)='juridico'
  AND split_part(public.mt_1c_relative_path(name),'/',3)='certidao_juridico'
  AND split_part(public.mt_1c_relative_path(name),'/',4)<>''
  AND split_part(public.mt_1c_relative_path(name),'/',5)=''
  AND EXISTS (SELECT 1 FROM public.sales s
    WHERE s.id::text=split_part(public.mt_1c_relative_path(name),'/',1)
      AND public.can_upload_juridico_certidao(s.id)));

CREATE POLICY exclusive_storage_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='exclusive-captures' AND CASE
    WHEN split_part(public.mt_1c_relative_path(name),'/',1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.exclusive_can_view(split_part(public.mt_1c_relative_path(name),'/',1)::uuid,auth.uid())
      AND EXISTS (SELECT 1 FROM public.exclusive_documents d WHERE d.storage_path=name
        AND d.capture_id=split_part(public.mt_1c_relative_path(name),'/',1)::uuid)
    ELSE false END);
-- A RPC de registro (dono mt_1b_definer, sem BYPASSRLS) precisa verificar o
-- objeto recém-enviado ANTES de existir a linha em exclusive_documents.
CREATE POLICY mt_1c_pending_capture_read ON storage.objects FOR SELECT TO mt_1b_definer USING (
  bucket_id='exclusive-captures' AND public.mt_1c_storage_scope(bucket_id,name,true)
  AND CASE WHEN split_part(public.mt_1c_relative_path(name),'/',1)
    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.exclusive_is_editor(split_part(public.mt_1c_relative_path(name),'/',1)::uuid,auth.uid())
    ELSE false END);
CREATE POLICY exclusive_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='exclusive-captures' AND CASE
    WHEN public.mt_1c_relative_path(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$'
    THEN public.exclusive_is_editor(split_part(public.mt_1c_relative_path(name),'/',1)::uuid,auth.uid())
    ELSE false END);
CREATE POLICY exclusive_storage_signed_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='exclusive-captures' AND CASE
    WHEN public.mt_1c_relative_path(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}[.]pdf$'
    THEN public.exclusive_is_manager(split_part(public.mt_1c_relative_path(name),'/',1)::uuid,auth.uid())
    ELSE false END AND EXISTS (SELECT 1 FROM public.exclusive_captures c
      WHERE c.id::text=split_part(public.mt_1c_relative_path(name),'/',1)
      AND c.status IN ('enviada','em_assinatura')));
CREATE POLICY exclusive_templates_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='exclusive-templates' AND public.mt_1c_relative_path(name) IN ('campolim.pdf','barao-de-tatui.pdf')
  AND public.exclusive_capture_enabled() AND public.exclusive_actor_active(auth.uid())
  AND public.has_any_role(auth.uid(),ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[]));

-- avatars é público por contrato legado: SQL limita listagem/escrita autenticada,
-- mas URLs públicas não passam por RLS. Privacidade de imagem exige migração de produto separada.
CREATE POLICY avatars_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id='avatars' AND EXISTS (SELECT 1 FROM public.profiles p
    WHERE p.id::text=split_part(public.mt_1c_relative_path(name),'/',1)
      AND p.organization_id=public.current_org_id()));
CREATE POLICY avatars_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id='avatars' AND (storage.foldername(public.mt_1c_relative_path(name)))[1]=auth.uid()::text);
CREATE POLICY avatars_update ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id='avatars' AND (storage.foldername(public.mt_1c_relative_path(name)))[1]=auth.uid()::text)
  WITH CHECK (bucket_id='avatars' AND (storage.foldername(public.mt_1c_relative_path(name)))[1]=auth.uid()::text);
CREATE POLICY avatars_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id='avatars' AND (storage.foldername(public.mt_1c_relative_path(name)))[1]=auth.uid()::text);

-- Duas RPCs conferem caminhos na aplicação: atualizar somente trechos conhecidos,
-- preservando integralmente a lógica de papéis e de aprovação vigente no clone.
CREATE TABLE public.mt_1c_function_backup AS
SELECT p.oid::regprocedure::text signature, pg_get_functiondef(p.oid) ddl FROM pg_proc p
WHERE p.oid IN ('public.exclusive_register_document(uuid,text,integer,text,text)'::regprocedure,
  'public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)'::regprocedure);
REVOKE ALL ON public.mt_1c_function_backup FROM PUBLIC,anon,authenticated;
DO $rpc$ DECLARE def text; before_text text; BEGIN
  def:=pg_get_functiondef('public.exclusive_register_document(uuid,text,integer,text,text)'::regprocedure);
  before_text:='_path !~ (''^'' || _id::text ||';
  IF (length(def)-length(replace(def,before_text,'')))/length(before_text) <> 1
  THEN RAISE EXCEPTION 'Validação de captação divergente'; END IF;
  def:=replace(def,before_text,'_path !~ (''^'' || public.current_org_id()::text || ''/'' || _id::text ||');
  EXECUTE def;
  def:=pg_get_functiondef('public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)'::regprocedure);
  before_text:='split_part(_storage_path, ''/'', ';
  IF (length(def)-length(replace(def,before_text,'')))/length(before_text) <> 10
    OR position('  INSERT INTO public.sale_documents' IN def)=0
  THEN RAISE EXCEPTION 'Validação de venda divergente'; END IF;
  def:=replace(def,before_text,'split_part(public.mt_1c_relative_path(_storage_path), ''/'', ');
  def:=replace(def,'  INSERT INTO public.sale_documents',
    '  IF NOT ((public.mt_1c_storage_scope(''sale-documents'',_storage_path,true)'
    || E'\n    AND split_part(public.mt_1c_relative_path(_storage_path),''/'',1) = _sale_id::text)'
    || E'\n    OR EXISTS (SELECT 1 FROM public.sale_documents d WHERE d.sale_id=_sale_id'
    || E'\n      AND d.storage_path=_storage_path AND d.organization_id=public.current_org_id())) THEN'
    || E'\n    RAISE EXCEPTION ''Caminho fora da agencia/venda'' USING ERRCODE=''42501'';'
    || E'\n  END IF;' || E'\n\n  INSERT INTO public.sale_documents');
  EXECUTE def;
END $rpc$;
COMMIT;
