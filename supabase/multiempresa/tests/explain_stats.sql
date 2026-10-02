-- Perfil das partes de dashboard_stats/financeiro_distribuicao_vendas por papel. ROLLBACK; sem PII.
-- Uso: lpsql.sh -At -v papel=admin < explain_stats.sql
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
\if :{?papel}
\else
\set papel admin
\endif
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', ur.user_id, 'role', 'authenticated',
  'app_metadata', au.raw_app_meta_data)::text, true)
FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id AND p.ativo
JOIN auth.users au ON au.id = ur.user_id
WHERE ur.role::text = :'papel' ORDER BY ur.user_id LIMIT 1 \gset
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE tt (k text, ms numeric) ON COMMIT DROP;
DO $d$
DECLARE t0 timestamptz; q text; qs text[] := ARRAY[
  'SELECT count(*) FROM public.sales',
  'SELECT count(public.calcular_distribuicao_venda(s.*)) FROM public.sales s',
  'SELECT count(*) FROM public.sales s WHERE public.is_sale_corretor(auth.uid(), s.id)',
  'SELECT count(*) FROM public.sales s WHERE public.is_sale_responsavel(auth.uid(), s.id)',
  'SELECT count(*) FROM public.occurrences o JOIN public.sales s ON s.id = o.sale_id',
  'SELECT count(*) FROM public.occurrence_commissions',
  'SELECT count(*) FROM public.occurrence_partners',
  'SELECT count(*) FROM public.sale_commission_extras',
  'SELECT count(*) FROM public.sale_status_history',
  'SELECT count(*) FROM public.metricas_venda_sem_parceria()',
  'SELECT public.dashboard_stats()',
  'SELECT count(*) FROM public.financeiro_distribuicao_vendas()'];
BEGIN
  FOREACH q IN ARRAY qs LOOP
    EXECUTE q; t0 := clock_timestamp(); EXECUTE q; EXECUTE q;
    INSERT INTO tt VALUES (q, round(extract(epoch FROM clock_timestamp() - t0) * 500, 1));
  END LOOP;
END $d$;
SELECT 'T ' || ms || ' ms  ' || k FROM tt;
ROLLBACK;
