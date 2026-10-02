-- 20261002000004: leitor amplo (financeiro/admin/super_admin) nunca vê linha de OUTRA imobiliária
-- nas 6 tabelas da policy zz_mt_leitor_amplo_select; e papéis sem leitura ampla não ganham linhas.
-- ROLLBACK; saída: TOTAL=ok/total e FALHA <papel> <tabela> (sem PII).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE il (ok boolean, msg text) ON COMMIT DROP;
GRANT ALL ON il TO authenticated;
DO $i$
DECLARE u record; t text; fora bigint; org uuid;
  tabs text[] := ARRAY['sale_status_history','occurrences','occurrence_commissions',
    'occurrence_partners','sale_commission_extras','sale_parties'];
BEGIN
  FOR u IN
    SELECT DISTINCT ON (m.organization_id, ur.role) ur.role::text k, ur.user_id id, m.organization_id org,
      au.raw_app_meta_data am
    FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id AND p.ativo
    JOIN public.organization_members m ON m.user_id = ur.user_id AND m.ativo
    JOIN auth.users au ON au.id = ur.user_id
    ORDER BY m.organization_id, ur.role, ur.user_id
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated',
      'app_metadata', u.am)::text, true);
    PERFORM set_config('role', 'authenticated', true);
    FOREACH t IN ARRAY tabs LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS DISTINCT FROM %L', t, u.org)
        INTO fora;
      INSERT INTO il VALUES (fora = 0, u.k || ' ' || t || ' fora_da_org=' || fora);
    END LOOP;
    PERFORM set_config('role', 'none', true);
  END LOOP;
END $i$;
SELECT 'ORGS=' || count(DISTINCT organization_id) FROM public.organization_members;
SELECT 'FALHA ' || msg FROM il WHERE NOT ok;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM il;
ROLLBACK;
