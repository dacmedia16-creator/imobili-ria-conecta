-- Rollback 1c só no clone local. Não remove blobs nem converte caminho físico.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE NOT legacy_default)
    OR EXISTS (SELECT 1 FROM storage.objects o WHERE
      split_part(o.name,'/',1) IN (SELECT id::text FROM public.organizations))
  THEN RAISE EXCEPTION 'Rollback 1c bloqueado: agencia nova ou objeto prefixado; reconciliar arquivos primeiro'; END IF;
  IF (SELECT count(*) FROM public.mt_1c_policy_backup) <> 17
    OR (SELECT count(*) FROM public.mt_1c_function_backup) <> 2
  THEN RAISE EXCEPTION 'Snapshot de policies/RPCs incompleto'; END IF;
END $$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_1c_function_backup LOOP EXECUTE f.ddl; END LOOP;
END $$;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
  LOOP EXECUTE format('DROP POLICY %I ON storage.objects',p.policyname); END LOOP;
  FOR p IN SELECT * FROM public.mt_1c_policy_backup LOOP
    EXECUTE format('CREATE POLICY %I ON storage.objects AS %s FOR %s TO %s%s%s',
      p.policyname,p.permissive,p.cmd,array_to_string(p.roles,','),
      CASE WHEN p.qual IS NULL THEN '' ELSE ' USING ('||p.qual||')' END,
      CASE WHEN p.with_check IS NULL THEN '' ELSE ' WITH CHECK ('||p.with_check||')' END);
  END LOOP;
END $$;
DROP FUNCTION public.mt_1c_storage_scope(text,text,boolean);
DROP FUNCTION public.mt_1c_relative_path(text);
DROP TABLE public.mt_1c_policy_backup,public.mt_1c_function_backup;
COMMIT;
