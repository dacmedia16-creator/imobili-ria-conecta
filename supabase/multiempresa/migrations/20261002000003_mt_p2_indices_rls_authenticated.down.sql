-- Reversão de 20261002000003: remove os índices P2-B e restaura papéis e texto exatos das 46 policies
-- a partir do snapshot public.mt_p2_backup. Não toca em dados.
BEGIN;
SET LOCAL search_path TO '';
DO $$ BEGIN
  IF to_regclass('public.mt_p2_backup') IS NULL OR (SELECT count(*) FROM public.mt_p2_backup) <> 46 THEN
    RAISE EXCEPTION 'Snapshot P2 ausente/incompleto; rollback abortado';
  END IF;
END $$;

DROP INDEX public.idx_p2b_activity_logs_sale_created;
DROP INDEX public.idx_p2b_profiles_org;
DROP INDEX public.idx_p2b_team_co_leaders_user;
DROP INDEX public.idx_p2b_occurrence_commissions_user;
DROP INDEX public.idx_p2b_sale_parties_cliente;
DROP INDEX public.idx_p2b_clientes_created_by;
DROP INDEX public.idx_p2b_exclusive_history_capture;
DROP INDEX public.idx_p2b_metas_corretor;
DROP INDEX public.idx_p2b_metas_team;
DROP INDEX public.idx_p2b_platform_sale_cancellations_sale;

DO $restore$ DECLARE b record; BEGIN
  FOR b IN SELECT * FROM public.mt_p2_backup LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO %s', b.policy_name, b.table_name,
      (SELECT string_agg(quote_ident(x), ', ') FROM unnest(string_to_array(b.roles, ',')) x));
    IF b.qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', b.policy_name, b.table_name, b.qual);
    END IF;
    IF b.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', b.policy_name, b.table_name, b.with_check);
    END IF;
  END LOOP;
END $restore$;

DO $check$ BEGIN
  IF EXISTS (SELECT 1 FROM public.mt_p2_backup b JOIN pg_catalog.pg_policies p
      ON p.schemaname='public' AND p.tablename=b.table_name AND p.policyname=b.policy_name
      WHERE array_to_string(p.roles, ',') <> b.roles
         OR p.qual IS DISTINCT FROM b.qual OR p.with_check IS DISTINCT FROM b.with_check) THEN
    RAISE EXCEPTION 'Policies nao voltaram ao snapshot';
  END IF;
END $check$;
DROP TABLE public.mt_p2_backup;
COMMIT;
