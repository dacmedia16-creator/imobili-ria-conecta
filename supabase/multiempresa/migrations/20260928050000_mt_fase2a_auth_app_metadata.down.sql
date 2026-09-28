-- Rollback 2a: restaura handle_new_user da 1a e remove o gatilho de app_metadata. Não mexe em dados.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_2a_function_backup) <> 1 THEN
    RAISE EXCEPTION 'Snapshot 2a incompleto';
  END IF;
END $$;
DROP TRIGGER mt_2a_on_auth_user_app_metadata ON auth.users;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_2a_function_backup LOOP EXECUTE f.ddl; END LOOP;
END $$;
DROP FUNCTION public.mt_2a_apply_app_metadata_org();
DROP FUNCTION public.mt_2a_provision_user(uuid, text, jsonb, uuid);
DROP TABLE public.mt_2a_function_backup;
COMMIT;
