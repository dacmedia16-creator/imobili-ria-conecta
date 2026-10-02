-- Números dos painéis da tela Início por papel (1 usuário ativo de cada papel + inativo + anon).
-- Rodar ANTES e DEPOIS da 20261002000004 e comparar: linhas PAINEL devem ser idênticas.
-- Saída: só papel, uuid, nome da fonte, contagem e md5 (sem PII). Tudo em ROLLBACK.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE TEMP TABLE pr (k text, u text, f text, r text) ON COMMIT DROP;
GRANT ALL ON pr TO authenticated, anon;
DO $p$
DECLARE u record; f text; r text; n bigint; h text;
  ini timestamptz := '2026-09-01 00:00-03'; fim timestamptz := '2026-10-01 00:00-03';
  fontes text[] := ARRAY[
    'SELECT public.dashboard_stats()::text',
    'SELECT public.metas_progresso(''2026-09-01'')::text',
    format('SELECT public.dashboard_movimentacao_periodo(%L, %L)::text', ini, fim),
    'SELECT x::text FROM public.vendas_comerciais_canonicas() x',
    'SELECT x::text FROM public.vendas_comerciais_validas() x',
    'SELECT x::text FROM public.comparativo_comissao_6pct_inconsistencias() x',
    'SELECT x::text FROM public.comparativo_comissao_6pct() x',
    'SELECT x::text FROM public.financeiro_distribuicao_vendas() x',
    'SELECT x::text FROM public.sales x',
    'SELECT x::text FROM public.sale_status_history x',
    'SELECT x::text FROM public.occurrences x',
    'SELECT x::text FROM public.occurrence_commissions x',
    'SELECT x::text FROM public.occurrence_partners x',
    'SELECT x::text FROM public.sale_commission_extras x',
    'SELECT x::text FROM public.sale_parties x'];
BEGIN
  FOR u IN
    WITH amostra AS (
      SELECT ur.role::text k, ur.user_id id, row_number() OVER (PARTITION BY ur.role ORDER BY ur.user_id) rn
      FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id AND p.ativo
      UNION ALL
      SELECT 'inativo', p.id, row_number() OVER (ORDER BY p.id) FROM public.profiles p WHERE NOT p.ativo
    )
    SELECT a.k, a.id::text uid, au.raw_app_meta_data am, 'authenticated' rl
    FROM amostra a JOIN auth.users au ON au.id = a.id WHERE a.rn <= 1
    UNION ALL SELECT 'anon', 'anon', '{}'::jsonb, 'anon'
    ORDER BY 1, 2
  LOOP
    IF u.rl = 'anon' THEN
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', u.uid, 'role', 'authenticated',
        'app_metadata', u.am)::text, true);
    END IF;
    PERFORM set_config('role', u.rl, true);
    FOREACH f IN ARRAY fontes LOOP
      BEGIN
        EXECUTE format('SELECT count(*), md5(coalesce(string_agg(t, E''\n'' ORDER BY t), '''')) FROM (%s) q(t)', f)
          INTO n, h;
        r := 'n=' || n || ' h=' || left(h, 16);
      EXCEPTION WHEN OTHERS THEN r := 'erro=' || SQLSTATE;
      END;
      INSERT INTO pr VALUES (u.k, u.uid, split_part(split_part(f, 'public.', 2), ' ', 1), r);
    END LOOP;
    PERFORM set_config('role', 'none', true);
  END LOOP;
END $p$;
SELECT 'PAINEL ' || k || ' ' || u || ' ' || f || ' ' || r FROM pr ORDER BY k, u, f;
ROLLBACK;
