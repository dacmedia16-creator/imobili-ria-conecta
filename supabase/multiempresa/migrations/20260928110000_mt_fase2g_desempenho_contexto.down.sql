-- Rollback da Fase 2g: restaura as definições exatas de funções e policies guardadas pela 2g e
-- remove a memória por comando. Não toca em dados.
BEGIN;
SET LOCAL search_path TO '';
DO $$ DECLARE f record; BEGIN
  IF (SELECT count(*) FROM public.mt_2g_backup WHERE kind = 'function') < 18
     OR (SELECT count(*) FROM public.mt_2g_backup WHERE kind = 'policy') < 30 THEN
    RAISE EXCEPTION 'Snapshot 2g incompleto';
  END IF;
  FOR f IN SELECT * FROM public.mt_2g_backup ORDER BY kind, name LOOP
    EXECUTE f.ddl;
    IF f.kind = 'function' AND
       (SELECT proowner::regrole::text FROM pg_catalog.pg_proc WHERE oid = f.name::regprocedure) <> f.owner_name THEN
      RAISE EXCEPTION 'Dono divergente apos rollback 2g: %', f.name;
    END IF;
  END LOOP;
END $$;
DROP TRIGGER mt_2g_ctx_invalidate ON public.organization_members;
DROP TRIGGER mt_2g_ctx_invalidate ON public.organizations;
DROP TRIGGER mt_2g_ctx_invalidate ON public.profiles;
DROP FUNCTION public.mt_ctx_invalidate();
DROP FUNCTION public.mt_in_ctx_org(uuid);
DROP FUNCTION public.mt_ctx_org(boolean);
DROP TABLE public.mt_2g_backup;
SELECT set_config('mt.ctx', '', false), set_config('mt.ctx_m', '', false);
COMMIT;
