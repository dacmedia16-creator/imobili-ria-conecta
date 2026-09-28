-- Rollback da Fase 2c: restaura DDL e dono (mt_1b_definer) das duas RPCs públicas.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_2c_function_backup) <> 2 THEN
    RAISE EXCEPTION 'Snapshot 2c incompleto';
  END IF;
END $$;
-- ALTER OWNER exige CREATE no schema para o novo dono (mesmo padrão temporário da 1b).
DO $grant$ BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    GRANT CREATE ON SCHEMA public TO mt_1b_definer;
  END IF;
END $grant$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_2c_function_backup LOOP
    EXECUTE f.ddl;
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', f.signature, f.owner_name);
  END LOOP;
END $$;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
DROP FUNCTION public.mt_2c_public_org();
DROP TABLE public.mt_2c_function_backup;
COMMIT;
