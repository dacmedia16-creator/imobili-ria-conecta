-- Rollback 1e só no clone local: restaura o gatilho de ativação e remove trava/RPCs novas.
-- Não mexe em dados.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_1e_function_backup) <> 1 THEN
    RAISE EXCEPTION 'Snapshot 1e incompleto';
  END IF;
END $$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_1e_function_backup LOOP EXECUTE f.ddl; END LOOP;
END $$;
DROP TRIGGER trg_mt_1e_member_lock ON public.organization_members;
DROP FUNCTION public.mt_1e_member_lock();
DROP FUNCTION public.platform_update_organization(uuid, text, text);
DROP FUNCTION public.platform_set_organization_status(uuid, text);
DROP TABLE public.mt_1e_function_backup;
COMMIT;
