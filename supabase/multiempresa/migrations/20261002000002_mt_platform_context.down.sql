-- Reversão completa do contexto administrativo. Desativa sessões e auditoria desta feature;
-- restaura FKs e funções originais. Não reverte dados criados nas agências durante uso real.
BEGIN;
SET LOCAL search_path TO '';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_pc_backup WHERE kind='function')<>10
     OR (SELECT count(*) FROM public.mt_pc_author_fks)<>8
     OR (SELECT count(*) FROM pg_trigger WHERE tgname='trg_zz_pc_audit')<39 THEN
    RAISE EXCEPTION 'Snapshot plataforma incompleto; rollback abortado';
  END IF;
END $$;
DROP TRIGGER mt_pc_ctx_invalidate ON public.platform_org_context_sessions;
DROP TRIGGER mt_pc_admin_invalidate ON public.platform_admins;
DROP POLICY IF EXISTS sales_platform_context_insert ON public.sales;
DO $undo$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT c.relid::regclass AS tab FROM (
    SELECT t.tgrelid relid FROM pg_trigger t WHERE t.tgname='trg_zz_pc_audit'
  ) c LOOP
    EXECUTE format('DROP TRIGGER trg_zz_pc_audit ON %s',r.tab);
  END LOOP;
  FOR r IN SELECT * FROM public.mt_pc_author_fks LOOP
    EXECUTE format('DROP TRIGGER trg_01_pc_author_scope ON %s',r.table_name);
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.table_name,r.constraint_name);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',r.table_name,r.constraint_name,r.fk_ddl);
  END LOOP;
  FOR r IN SELECT * FROM public.mt_pc_backup WHERE kind='function' ORDER BY name LOOP
    EXECUTE r.ddl;
    IF (SELECT p.proowner::regrole::text FROM pg_proc p WHERE p.oid=r.name::regprocedure)<>r.owner_name THEN
      RAISE EXCEPTION 'Dono alterado durante rollback: %',r.name;
    END IF;
  END LOOP;
END $undo$;
DROP FUNCTION public.mt_pc_in_context();
DROP FUNCTION public.mt_pc_author_scope();
DROP FUNCTION public.mt_pc_audit_write();
DROP FUNCTION public.platform_enter_org(uuid);
DROP FUNCTION public.platform_exit_org();
DROP FUNCTION public.platform_current_org();
DROP FUNCTION public.mt_pc_context_org();
DROP FUNCTION public.mt_pc_context_id();
DROP FUNCTION public.mt_pc_auth_session();
DROP TABLE public.platform_org_context_actions;
DROP TABLE public.platform_org_context_sessions;
DROP TABLE public.mt_pc_author_fks;
DROP TABLE public.mt_pc_backup;
SELECT set_config('mt.ctx','',false), set_config('mt.ctx_m','',false);
COMMIT;
