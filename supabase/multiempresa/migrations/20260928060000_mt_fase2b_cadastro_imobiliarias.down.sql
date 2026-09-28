-- Rollback da Fase 2b. Arquivos de logo precisam ser removidos antes pela Storage API
-- (DELETE direto em storage.objects é bloqueado no Supabase hospedado); com arquivos, aborta.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'organization-logos') THEN
    RAISE EXCEPTION 'Remova os logos pela Storage API antes do rollback 2b';
  END IF;
END $$;
-- Bucket vazio (conferido acima): libera o gatilho protect_delete só nesta transação.
DO $$ BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.buckets WHERE id = 'organization-logos';
END $$;
DROP FUNCTION public.mt_2b_org_auth_users(uuid);
DROP FUNCTION public.platform_update_organization_profile(uuid, text, text, text);
DROP INDEX public.organizations_cnpj_unique;
ALTER TABLE public.organizations
  DROP COLUMN logo_path, DROP COLUMN cor_secundaria, DROP COLUMN cor_primaria, DROP COLUMN cnpj;
COMMIT;
