-- Tempo médio (ms, 15 repetições) das consultas afetadas pela P2, como usuário autenticado real.
-- Rodar ANTES e DEPOIS da 20261002000003. ROLLBACK; saída sem PII (só ms e tipo de plano).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE bo (q text, ms numeric, plano text) ON COMMIT DROP;
GRANT ALL ON bo TO authenticated;
DO $b$
DECLARE
  -- ator: um super_admin/admin ativo (vê tudo da imobiliária) e alvos determinísticos
  actor uuid; am jsonb; org uuid; s uuid; usr uuid; cli uuid; t0 timestamptz; i int; n int := 15;
  qs text[]; q text; k int := 0; pl text;
BEGIN
  SELECT ur.user_id, au.raw_app_meta_data, p.organization_id INTO actor, am, org
  FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id AND p.ativo
  JOIN auth.users au ON au.id = ur.user_id
  WHERE ur.role::text IN ('super_admin', 'admin') ORDER BY ur.role::text DESC, ur.user_id LIMIT 1;
  SELECT sale_id INTO s FROM public.activity_logs WHERE sale_id IS NOT NULL
    GROUP BY sale_id ORDER BY count(*) DESC, sale_id LIMIT 1;
  SELECT user_id INTO usr FROM public.occurrence_commissions WHERE user_id IS NOT NULL
    GROUP BY user_id ORDER BY count(*) DESC, user_id LIMIT 1;
  SELECT cliente_id INTO cli FROM public.sale_parties WHERE cliente_id IS NOT NULL
    GROUP BY cliente_id ORDER BY count(*) DESC, cliente_id LIMIT 1;
  qs := ARRAY[
    format('SELECT * FROM public.activity_logs WHERE sale_id = %L ORDER BY created_at DESC LIMIT 50', s),
    'SELECT * FROM public.clientes ORDER BY created_at DESC LIMIT 200',
    'SELECT * FROM public.metas',
    format('SELECT id FROM public.profiles WHERE organization_id = %L', org),
    format('SELECT * FROM public.team_co_leaders WHERE user_id = %L', usr),
    format('SELECT * FROM public.occurrence_commissions WHERE user_id = %L', usr),
    format('SELECT * FROM public.sale_parties WHERE cliente_id = %L', cli),
    'SELECT * FROM public.organization_members'];
  PERFORM set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated',
    'app_metadata', am)::text, true);
  PERFORM set_config('role', 'authenticated', true);
  FOREACH q IN ARRAY qs LOOP
    k := k + 1;
    EXECUTE 'EXPLAIN (COSTS OFF) ' || q INTO pl;  -- primeira linha do plano
    EXECUTE q;  -- aquecimento
    t0 := clock_timestamp();
    FOR i IN 1..n LOOP EXECUTE q; END LOOP;
    INSERT INTO bo VALUES ('Q' || k, round(extract(epoch FROM clock_timestamp() - t0) * 1000 / n, 2), pl);
  END LOOP;
  PERFORM set_config('role', 'none', true);
  RESET ROLE;
END $b$;
SELECT 'BENCH ' || q || ' ms=' || ms || ' plano=' || plano FROM bo ORDER BY q;
ROLLBACK;
