-- Regressão dos usuários comuns (plataforma-contexto): md5 e tempo de dashboard_stats e
-- dashboard_movimentacao_periodo para gestor, financeiro e corretor reais da cópia local.
-- Rodar ANTES e DEPOIS da migration e comparar. Não grava nada (ROLLBACK). Saída sem PII.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE bench_out (u text, ds text, dm text, ms_ds numeric, ms_dm numeric) ON COMMIT DROP;
GRANT ALL ON bench_out TO authenticated;
DO $b$
DECLARE u record; t0 timestamptz; i int; ds text; dm text; a numeric; b numeric; n int := 7;
BEGIN
  FOR u IN SELECT x.k, x.id, au.raw_app_meta_data am FROM (VALUES
      ('gestor', '0728f659-2c91-4fcb-b2e0-9d8f32bca96f'::uuid),
      ('financeiro', '11c1253a-7085-49e1-8a32-6b4bfea3be11'::uuid),
      ('corretor', '01350b6e-6f63-4a65-b1e6-0d81ef090ddf'::uuid)) x(k, id)
    JOIN auth.users au ON au.id = x.id
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated',
      'app_metadata', u.am)::text, true);
    PERFORM set_config('role', 'authenticated', true);
    ds := md5(public.dashboard_stats()::text);
    dm := md5(public.dashboard_movimentacao_periodo('2026-09-01 00:00-03', '2026-10-01 00:00-03')::text);
    t0 := clock_timestamp();
    FOR i IN 1..n LOOP PERFORM public.dashboard_stats(); END LOOP;
    a := round(extract(epoch FROM clock_timestamp() - t0) * 1000 / n, 1);
    t0 := clock_timestamp();
    FOR i IN 1..n LOOP
      PERFORM public.dashboard_movimentacao_periodo('2026-09-01 00:00-03', '2026-10-01 00:00-03');
    END LOOP;
    b := round(extract(epoch FROM clock_timestamp() - t0) * 1000 / n, 1);
    INSERT INTO bench_out VALUES (u.k, ds, dm, a, b);
    PERFORM set_config('role', 'none', true);
    RESET ROLE;
  END LOOP;
END $b$;
SELECT 'BENCH ' || u || ' ds=' || ds || ' dm=' || dm || ' ms_ds=' || ms_ds || ' ms_dm=' || ms_dm FROM bench_out ORDER BY u;
ROLLBACK;
