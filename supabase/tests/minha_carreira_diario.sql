-- Suíte da migration 20261016190000 (Minha carreira PR 5: diário de atividades, sem pontos).
-- Roda DENTRO de transação revertida (run-minha-carreira-diario.sh). Dados fictícios.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0). Perfis: corretor A1 (UE Corretor),
-- corretor A2 (QA A Corretor Um), gestor A (…-0002), corretor B1 (QA B Corretor Um).
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
-- Linhas afetadas (-1 = erro).
CREATE FUNCTION pg_temp.n(_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE _n integer;
BEGIN EXECUTE _sql; GET DIAGNOSTICS _n = ROW_COUNT; RETURN _n; EXCEPTION WHEN others THEN RETURN -1; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.n(text), pg_temp.as_user(text),
  pg_temp.id(text) TO authenticated;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('a2', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('ga', '10000000-0000-4000-8000-000000000002'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244');
CREATE TEMP TABLE d AS SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje,
  date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo')::date AS seg,
  date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date AS mes;
GRANT SELECT ON d TO authenticated;
CREATE TEMP TABLE antes AS SELECT md5(coalesce(string_agg(t, ',' ORDER BY t), '')) h FROM (
  SELECT s::text t FROM public.sales s WHERE s.organization_id IN (SELECT v FROM ids WHERE k LIKE 'org%')
  UNION ALL SELECT c::text FROM public.occurrence_commissions c WHERE c.organization_id IN (SELECT v FROM ids WHERE k LIKE 'org%')
  UNION ALL SELECT e::text FROM public.exclusive_captures e WHERE e.organization_id IN (SELECT v FROM ids WHERE k LIKE 'org%')) x;

-- 0) Escopo: sem pontos e ranking intacto ------------------------------------------------------
SELECT pg_temp.ok(to_regclass('public.carreira_pontos_tabela') IS NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'carreira_diario' AND column_name ILIKE '%ponto%'),
  'sem tabela de pontos e sem coluna de pontos no diário');
SELECT pg_temp.ok(pg_get_function_result('public.carreira_ranking(date,date)'::regprocedure) NOT ILIKE '%diario%',
  'ranking da etapa 3 não ganhou coluna do diário');

-- 1) Diário: o corretor registra o próprio ---------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo, quantidade) VALUES (''ligacao'', 6)') IS NULL,
  'A1 registra 6 ligações hoje');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo) VALUES (''visita'')') IS NULL,
  'A1 registra 1 visita com um toque (quantidade padrão 1)');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_diario (tipo, quantidade, dia) VALUES (''acm'', 1, %L)',
  (SELECT hoje - 1 FROM d))) IS NULL, 'A1 registra 1 ACM ontem');
SELECT pg_temp.ok((SELECT bool_and(user_id = pg_temp.id('a1') AND organization_id = pg_temp.id('orgA')) FROM public.carreira_diario),
  'registros ficam em nome de A1 na imobiliária A');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo) VALUES (''cafe'')') LIKE '23514%',
  'tipo fora de ligação/visita/ACM é recusado');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_diario (tipo, dia) VALUES (''ligacao'', %L)', (SELECT hoje + 1 FROM d))) LIKE '22023%'
  AND pg_temp.err(format('INSERT INTO public.carreira_diario (tipo, dia) VALUES (''ligacao'', %L)', (SELECT hoje - 40 FROM d))) LIKE '22023%',
  'data futura ou com mais de 31 dias é recusada');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo, quantidade) VALUES (''ligacao'', 0)') LIKE '23514%',
  'quantidade zero é recusada');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_diario (user_id, tipo) VALUES (%L, ''ligacao'')', pg_temp.id('a2'))) LIKE '42501%',
  'A1 não registra atividade em nome de A2');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_diario (organization_id, tipo) VALUES (%L, ''ligacao'')', pg_temp.id('orgB'))) LIKE '42501%',
  'A1 não registra atividade na imobiliária B');
SELECT pg_temp.ok(pg_temp.err('UPDATE public.carreira_diario SET quantidade = 50') LIKE '42501%',
  'ninguém edita registro (corrige apagando e registrando de novo)');

CREATE TEMP TABLE c1 AS SELECT * FROM public.meu_diario_contagens();
SELECT pg_temp.ok((SELECT array_agg(tipo ORDER BY tipo) FROM c1) = ARRAY['acm', 'ligacao', 'visita'],
  'contagens trazem sempre ligação, visita e ACM');
SELECT pg_temp.ok((SELECT hoje FROM c1 WHERE tipo = 'ligacao') = 6 AND (SELECT hoje FROM c1 WHERE tipo = 'visita') = 1
  AND (SELECT hoje FROM c1 WHERE tipo = 'acm') = 0, 'hoje de A1: 6 ligações, 1 visita, 0 ACM');
SELECT pg_temp.ok((SELECT semana FROM c1 WHERE tipo = 'acm') = CASE WHEN (SELECT hoje - 1 >= seg FROM d) THEN 1 ELSE 0 END
  AND (SELECT mes FROM c1 WHERE tipo = 'acm') = CASE WHEN (SELECT hoje - 1 >= mes FROM d) THEN 1 ELSE 0 END
  AND (SELECT semana = 6 AND mes = 6 FROM c1 WHERE tipo = 'ligacao'),
  'semana e mês contam o ACM de ontem quando cai no mesmo período');

-- 2) Corretor A × corretor A -----------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_diario) = 0, 'A2 não vê o diário de A1');
SELECT pg_temp.ok(pg_temp.n('DELETE FROM public.carreira_diario') = 0, 'A2 não apaga o diário de A1');
SELECT pg_temp.ok((SELECT sum(hoje + mes) FROM public.meu_diario_contagens()) = 0, 'contagens de A2 não incluem as de A1');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_diario_equipe(current_date - 30, current_date)') LIKE '42501%',
  'corretor não vê o diário da equipe');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo, quantidade) VALUES (''visita'', 2)') IS NULL,
  'A2 registra 2 visitas');

-- 3) Gestor: só leitura da equipe --------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_diario) = 4, 'gestor A lê o diário da equipe A (A1 e A2)');
SELECT pg_temp.ok(pg_temp.n('DELETE FROM public.carreira_diario') = 0, 'gestor não apaga o diário dos corretores');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_diario (user_id, tipo) VALUES (%L, ''ligacao'')', pg_temp.id('a1'))) LIKE '42501%',
  'gestor não registra atividade em nome do corretor');
CREATE TEMP TABLE eq AS SELECT * FROM public.carreira_diario_equipe((SELECT hoje - 31 FROM d), (SELECT hoje FROM d));
SELECT pg_temp.ok((SELECT ligacoes = 6 AND visitas = 1 AND acms = 1 FROM eq WHERE user_id = pg_temp.id('a1'))
  AND (SELECT ligacoes = 0 AND visitas = 2 AND acms = 0 FROM eq WHERE user_id = pg_temp.id('a2'))
  AND (SELECT count(*) FROM eq) = 2,
  'resumo da equipe: A1 6/1/1, A2 0/2/0 (ligações/visitas/ACMs)');

-- 4) Organização A × B ------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_diario) = 0, 'B1 não vê o diário da imobiliária A');
SELECT pg_temp.ok(pg_temp.n('DELETE FROM public.carreira_diario') = 0, 'B1 não apaga o diário da imobiliária A');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo) VALUES (''visita'')') IS NULL,
  'B1 registra 1 visita');
SELECT pg_temp.ok((SELECT organization_id = pg_temp.id('orgB') FROM public.carreira_diario),
  'registro de B1 fica na imobiliária B');
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_diario WHERE organization_id = pg_temp.id('orgB')) = 0
  AND (SELECT count(*) FROM public.carreira_diario_equipe((SELECT hoje - 31 FROM d), (SELECT hoje FROM d)) WHERE user_id = pg_temp.id('b1')) = 0,
  'gestor A não vê o diário da imobiliária B');

-- 5) Apagar o próprio registro -----------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.n('DELETE FROM public.carreira_diario WHERE tipo = ''acm''') = 1, 'A1 apaga o próprio registro');

-- 6) Inativo, sem login e anon -----------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.as_user('7dd997f7-2021-43ea-af9c-e758b826fcfd');  -- trava existente: só admin desativa usuário
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('a1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_diario) = 0, 'inativo não lê o próprio diário');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo) VALUES (''ligacao'')') LIKE '42501%', 'inativo não registra');
SELECT pg_temp.ok(pg_temp.n('DELETE FROM public.carreira_diario') = 0, 'inativo não apaga');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.meu_diario_contagens()') LIKE '42501%', 'inativo não consulta contagens');
RESET ROLE;
SELECT pg_temp.as_user('7dd997f7-2021-43ea-af9c-e758b826fcfd');
UPDATE public.profiles SET ativo = true WHERE id = pg_temp.id('a1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.meu_diario_contagens()') LIKE '42501%', 'sem login: recusado');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_diario) = 0, 'sem login: não lê o diário');
RESET ROLE;
SELECT pg_temp.ok(NOT has_table_privilege('anon', 'public.carreira_diario', 'SELECT,INSERT,UPDATE,DELETE'), 'anon sem acesso à tabela');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.meu_diario_contagens()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.carreira_diario_equipe(date,date)', 'EXECUTE'), 'anon não executa as funções');
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.carreira_diario', 'UPDATE'), 'authenticated sem UPDATE no diário');
SELECT pg_temp.ok((SELECT bool_and(prosecdef AND proconfig = ARRAY['search_path=""']) FROM pg_proc
  WHERE oid IN ('public.meu_diario_contagens()'::regprocedure, 'public.carreira_diario_equipe(date,date)'::regprocedure,
                'public.carreira_diario_validar()'::regprocedure)),
  'funções SECURITY DEFINER com search_path vazio');
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE tablename = 'carreira_diario' AND permissive = 'RESTRICTIVE') = 2,
  'isolamento por imobiliária e usuário ativo são restritivos');

-- 7) Nada mudou em vendas, comissões e captações -----------------------------------------------
SELECT pg_temp.ok((SELECT h FROM antes) = (SELECT md5(coalesce(string_agg(t, ',' ORDER BY t), '')) FROM (
  SELECT s::text t FROM public.sales s WHERE s.organization_id IN (SELECT v FROM ids WHERE k LIKE 'org%')
  UNION ALL SELECT c::text FROM public.occurrence_commissions c WHERE c.organization_id IN (SELECT v FROM ids WHERE k LIKE 'org%')
  UNION ALL SELECT e::text FROM public.exclusive_captures e WHERE e.organization_id IN (SELECT v FROM ids WHERE k LIKE 'org%')) x),
  'diário não altera vendas, comissões nem captações');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
