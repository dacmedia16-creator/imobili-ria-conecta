-- Rollback da Fase 2f: restaura a trigger de status e a policy de exclusão da 2e; remove o caminho de
-- cancelamento da plataforma. Recusa se já houver cancelamento auditado (não apaga auditoria).
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_2f_backup WHERE kind = 'function') <> 1
     OR (SELECT count(*) FROM public.mt_2f_backup WHERE kind = 'policy') <> 1 THEN
    RAISE EXCEPTION 'Snapshot 2f incompleto';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_sale_cancellations) THEN
    RAISE EXCEPTION 'Ha cancelamentos auditados; exporte platform_sale_cancellations antes do rollback 2f';
  END IF;
END $$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_2f_backup WHERE kind = 'function' LOOP
    EXECUTE f.ddl;
    IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = f.name::regprocedure) <> f.owner_name THEN
      RAISE EXCEPTION 'Dono divergente apos rollback 2f: %', f.name;
    END IF;
  END LOOP;
END $$;
DROP FUNCTION public.platform_cancel_sale(uuid, text);
DROP TABLE public.platform_sale_cancellations;
DROP POLICY delete_sales_por_papel ON public.sales;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT * FROM public.mt_2f_backup WHERE kind = 'policy' LOOP
    EXECUTE p.ddl;
  END LOOP;
END $$;
DROP TABLE public.mt_2f_backup;
COMMIT;
