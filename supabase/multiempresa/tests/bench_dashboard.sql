-- Tempo médio (ms) das RPCs da tela Início (painel do gestor/financeiro), como usuário autenticado.
-- Uso: lpsql.sh -At -v reps=5 < bench_dashboard.sql   (padrão 5 repetições). ROLLBACK; sem PII.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
\if :{?reps}
\else
\set reps 5
\endif
BEGIN;
CREATE TEMP TABLE bd (q text, ms numeric) ON COMMIT DROP;
GRANT ALL ON bd TO authenticated;
SELECT set_config('bench.reps', :'reps', true);
DO $b$
DECLARE
  actor uuid; am jsonb; t0 timestamptz; i int; n int := current_setting('bench.reps')::int;
  ini timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  fim timestamptz := (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month') AT TIME ZONE 'America/Sao_Paulo';
  qs text[]; q text; k int := 0;
BEGIN
  SELECT ur.user_id, au.raw_app_meta_data INTO actor, am
  FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id AND p.ativo
  JOIN auth.users au ON au.id = ur.user_id
  WHERE ur.role::text IN ('super_admin', 'admin') ORDER BY ur.role::text DESC, ur.user_id LIMIT 1;
  qs := ARRAY[
    'SELECT public.dashboard_stats()',
    format('SELECT public.metas_progresso(%L)', date_trunc('month', now())::date),
    'SELECT count(*) FROM public.vendas_comerciais_canonicas()',
    'SELECT count(*) FROM public.comparativo_comissao_6pct_inconsistencias()',
    'SELECT count(*) FROM public.financeiro_distribuicao_vendas()',
    format('SELECT public.dashboard_movimentacao_periodo(%L, %L)', ini, fim),
    'SELECT count(*) FROM public.vendas_comerciais_validas()',
    'SELECT count(*) FROM public.metricas_venda_sem_parceria()'];
  PERFORM set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated',
    'app_metadata', am)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  FOREACH q IN ARRAY qs LOOP
    k := k + 1;
    EXECUTE q;  -- aquecimento
    t0 := clock_timestamp();
    FOR i IN 1..n LOOP EXECUTE q; END LOOP;
    INSERT INTO bd VALUES (k || ' ' || split_part(split_part(q, 'public.', 2), '(', 1),
      round(extract(epoch FROM clock_timestamp() - t0) * 1000 / n, 1));
  END LOOP;
  PERFORM set_config('role', 'none', true);
END $b$;
SELECT 'BENCH ' || q || ' ms=' || ms FROM bd ORDER BY split_part(q, ' ', 1)::int;
ROLLBACK;
