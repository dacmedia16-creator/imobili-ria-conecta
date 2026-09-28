-- Rollback da Fase 2d: restaura a definição anterior de imprimir_ocorrencias_concluidas(uuid[]).
-- CREATE OR REPLACE mantém dono e ACL; não mexe em dados.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_2d_function_backup) <> 1 THEN
    RAISE EXCEPTION 'Snapshot 2d incompleto';
  END IF;
END $$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_2d_function_backup LOOP
    EXECUTE f.ddl;
    IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = f.signature::regprocedure) <> f.owner_name THEN
      RAISE EXCEPTION 'Dono divergente apos rollback 2d';
    END IF;
  END LOOP;
END $$;
DROP TABLE public.mt_2d_function_backup;
COMMIT;
