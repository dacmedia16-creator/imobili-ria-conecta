-- Rollback 1d só no clone local: restaura as quatro funções de gatilho do snapshot.
-- Não mexe em dados: linhas gravadas pelo servidor já carregam organization_id explícito.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_1d_function_backup) <> 4 THEN
    RAISE EXCEPTION 'Snapshot 1d incompleto';
  END IF;
END $$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_1d_function_backup LOOP EXECUTE f.ddl; END LOOP;
END $$;
DROP FUNCTION public.mt_1d_is_service();
DROP TABLE public.mt_1d_function_backup;
COMMIT;
