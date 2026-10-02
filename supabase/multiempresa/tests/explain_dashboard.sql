-- EXPLAIN ANALYZE do núcleo das RPCs da tela Início, como admin autenticado. ROLLBACK; sem PII.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', ur.user_id, 'role', 'authenticated',
  'app_metadata', au.raw_app_meta_data)::text, true)
FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id AND p.ativo
JOIN auth.users au ON au.id = ur.user_id
WHERE ur.role::text IN ('super_admin', 'admin') ORDER BY ur.role::text DESC, ur.user_id LIMIT 1 \gset
SET LOCAL ROLE authenticated;
\echo '### sales (RLS)'
EXPLAIN (ANALYZE, BUFFERS OFF, TIMING ON, SUMMARY ON) SELECT count(*) FROM public.sales;
\echo '### sale_status_history (RLS)'
EXPLAIN (ANALYZE, BUFFERS OFF, TIMING ON, SUMMARY ON) SELECT count(*) FROM public.sale_status_history;
\echo '### occurrences (RLS)'
EXPLAIN (ANALYZE, BUFFERS OFF, TIMING ON, SUMMARY ON) SELECT count(*) FROM public.occurrences;
\echo '### occurrence_commissions (RLS)'
EXPLAIN (ANALYZE, BUFFERS OFF, TIMING ON, SUMMARY ON) SELECT count(*) FROM public.occurrence_commissions;
\echo '### occurrence_partners (RLS)'
EXPLAIN (ANALYZE, BUFFERS OFF, TIMING ON, SUMMARY ON) SELECT count(*) FROM public.occurrence_partners;
\echo '### sale_commission_extras (RLS)'
EXPLAIN (ANALYZE, BUFFERS OFF, TIMING ON, SUMMARY ON) SELECT count(*) FROM public.sale_commission_extras;
\echo '### calcular_distribuicao_venda x todas'
EXPLAIN (ANALYZE, BUFFERS OFF, TIMING ON, SUMMARY ON) SELECT count(public.calcular_distribuicao_venda(s.*)) FROM public.sales s;
ROLLBACK;
