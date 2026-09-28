-- Rollback da Fase 2e: restaura exatamente as duas funções e as duas policies anteriores.
-- Não mexe em dados.
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_2e_backup WHERE kind = 'function') <> 2
     OR (SELECT count(*) FROM public.mt_2e_backup WHERE kind = 'policy') <> 2 THEN
    RAISE EXCEPTION 'Snapshot 2e incompleto';
  END IF;
END $$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_2e_backup WHERE kind = 'function' LOOP
    EXECUTE f.ddl;
    IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = f.name::regprocedure) <> f.owner_name THEN
      RAISE EXCEPTION 'Dono divergente apos rollback 2e: %', f.name;
    END IF;
  END LOOP;
END $$;
DROP POLICY delete_sales_por_papel ON public.sales;
DROP POLICY organization_members_select ON public.organization_members;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT * FROM public.mt_2e_backup WHERE kind = 'policy' LOOP
    EXECUTE p.ddl;
  END LOOP;
END $$;
DROP TABLE public.mt_2e_backup;
COMMIT;
