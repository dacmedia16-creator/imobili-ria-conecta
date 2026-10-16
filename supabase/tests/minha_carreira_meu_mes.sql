-- Suíte da migration 20261016120000 (Minha carreira PR 2: minhas_metas, carreira_taxas, meu_realizado).
-- Roda DENTRO de transação revertida (run-minha-carreira-meu-mes.sh). Homologação: A = Agência A (…-0001),
-- B = Agência B (2a…b0). Perfis: corretor A1 (UE Corretor), corretor A2 (QA A Corretor Um),
-- gestor A (…-0002), corretor B (QA B Corretor Um). Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
-- Linhas afetadas por um comando (UPDATE/DELETE bloqueado pela RLS afeta 0).
CREATE FUNCTION pg_temp.n(_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE _n integer; BEGIN EXECUTE _sql; GET DIAGNOSTICS _n = ROW_COUNT; RETURN _n; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.as_user(text), pg_temp.id(text),
  pg_temp.n(text) TO authenticated;

-- Venda válida (contrato assinado) com comissões por participante. _dias = dias atrás (horário de SP).
CREATE FUNCTION pg_temp.venda(_k text, _org text, _capt text, _vend text, _valor numeric, _dias int,
  _com_capt numeric, _com_vend numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _s uuid := gen_random_uuid(); _o uuid := gen_random_uuid();
  _em timestamptz := now() - make_interval(days => _dias);
BEGIN
  INSERT INTO ids VALUES (_k, _s);
  INSERT INTO public.sales (id, organization_id, corretor_id, corretor_captador_id, corretor_vendedor_id, status,
    modalidade, codigo_interno, imovel_id, imovel_endereco, valor_negociado, valor_total_comissao, data_assinatura)
  VALUES (_s, pg_temp.id(_org), pg_temp.id(_capt), pg_temp.id(_capt), pg_temp.id(_vend), 'contrato_assinado',
    'padrao', 'QA-MC2-' || _k, 'QA-MC2-' || _k, 'Rua QA Minha Carreira ' || _k, _valor, _valor * 0.06,
    (_em AT TIME ZONE 'America/Sao_Paulo')::date);
  INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
  VALUES (_s, pg_temp.id(_org), 'contrato_assinado', _em);
  INSERT INTO public.occurrences (id, sale_id, organization_id, status) VALUES (_o, _s, pg_temp.id(_org), 'pendente');
  INSERT INTO public.occurrence_commissions (occurrence_id, organization_id, papel, user_id, valor)
  VALUES (_o, pg_temp.id(_org), 'corretor_captador', pg_temp.id(_capt), _com_capt),
         (_o, pg_temp.id(_org), 'corretor_vendedor', pg_temp.id(_vend), _com_vend);
END $$;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('a2', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('ga', '10000000-0000-4000-8000-000000000002'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244');
CREATE TEMP TABLE d AS SELECT date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date AS mes,
  (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month - 1 day')::date AS fim,
  date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date AS ano;
GRANT SELECT ON d TO authenticated;

-- Módulo de captação ligado nas duas (só dentro da transação).
UPDATE public.organization_modules SET enabled = true
 WHERE organization_id IN (pg_temp.id('orgA'), pg_temp.id('orgB')) AND module = 'captacao_exclusiva';

-- Vendas: V1 (A1 capta, A2 vende) e V2 (A2 capta e vende) neste mês; V3 (A1) há 200 dias; VB na org B.
SELECT pg_temp.venda('v1', 'orgA', 'a1', 'a2', 500000, 0, 9000, 6000);
SELECT pg_temp.venda('v2', 'orgA', 'a2', 'a2', 300000, 0, 5000, 4000);
SELECT pg_temp.venda('v3', 'orgA', 'a1', 'a1', 200000, 200, 3000, 3000);
SELECT pg_temp.venda('vb', 'orgB', 'b1', 'b1', 700000, 0, 20000, 20000);
-- Captação aprovada hoje por A1 (conta no realizado) e uma descartada (não conta).
INSERT INTO ids VALUES ('cap', gen_random_uuid()), ('cap_desc', gen_random_uuid());
INSERT INTO public.exclusive_captures (id, organization_id, captor_id, created_by, template, status, form_data,
  broker_name, signed_on, discarded_at)
VALUES (pg_temp.id('cap'), pg_temp.id('orgA'), pg_temp.id('a1'), pg_temp.id('a1'), 'campolim', 'aprovada', '{}',
        'Corretor Teste', (now() AT TIME ZONE 'America/Sao_Paulo')::date, NULL),
       (pg_temp.id('cap_desc'), pg_temp.id('orgA'), pg_temp.id('a1'), pg_temp.id('a1'), 'campolim', 'aprovada', '{}',
        'Corretor Teste', (now() AT TIME ZONE 'America/Sao_Paulo')::date, now());

-- 1) Corretor A1 grava e lê a própria meta ---------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format(
  'INSERT INTO public.minhas_metas (periodo, inicio, meta_comissao, meta_vendas, meta_captacoes) VALUES (''mes'', %L, 12000, 2, 3)',
  (SELECT mes FROM d))) IS NULL, 'A1 grava a própria meta do mês');
SELECT pg_temp.ok(pg_temp.err(format(
  'INSERT INTO public.minhas_metas (periodo, inicio, meta_vgv, meta_vendas) VALUES (''ano'', %L, 9000000, 20)',
  (SELECT ano FROM d))) IS NULL, 'A1 grava a própria meta do ano');
SELECT pg_temp.ok((SELECT count(*) FROM public.minhas_metas) = 2
  AND (SELECT bool_and(user_id = pg_temp.id('a1') AND organization_id = pg_temp.id('orgA')) FROM public.minhas_metas),
  'A1 lê só as 2 metas dele, na organização A (dono e organização preenchidos sozinhos)');
SELECT pg_temp.ok(pg_temp.n(format('UPDATE public.minhas_metas SET meta_comissao = 15000 WHERE periodo = ''mes'' AND inicio = %L',
  (SELECT mes FROM d))) = 1, 'A1 atualiza a própria meta');
SELECT pg_temp.ok(pg_temp.err(format(
  'INSERT INTO public.minhas_metas (periodo, inicio, meta_vendas) VALUES (''mes'', %L, 1)', (SELECT mes FROM d))) LIKE '23505%',
  'uma meta por período (duplicada recusada)');
SELECT pg_temp.ok(pg_temp.err(format(
  'INSERT INTO public.minhas_metas (periodo, inicio, meta_vendas) VALUES (''mes'', %L, 1)', (SELECT mes FROM d) + 3)) LIKE '23514%',
  'mês precisa começar no dia 1');
SELECT pg_temp.ok(pg_temp.err(format(
  'INSERT INTO public.minhas_metas (periodo, inicio, meta_comissao) VALUES (''mes'', %L, -1)', (SELECT mes FROM d) - interval '1 month')) LIKE '23514%',
  'meta negativa recusada');

-- 2) Isolamento corretor A × corretor A ------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format(
  'INSERT INTO public.minhas_metas (user_id, periodo, inicio, meta_vendas) VALUES (%L, ''mes'', %L, 9)',
  pg_temp.id('a2'), (SELECT mes FROM d))) LIKE '42501%', 'A1 não grava meta em nome de A2');
SELECT pg_temp.ok(pg_temp.err(format(
  'INSERT INTO public.minhas_metas (organization_id, periodo, inicio, meta_vendas) VALUES (%L, ''mes'', %L, 9)',
  pg_temp.id('orgB'), (SELECT mes FROM d) - interval '2 month')) LIKE '42501%', 'A1 não grava meta na organização B');
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.minhas_metas) = 0, 'A2 não vê as metas de A1');
SELECT pg_temp.ok(pg_temp.n('UPDATE public.minhas_metas SET meta_vendas = 99') = 0
  AND pg_temp.n('DELETE FROM public.minhas_metas') = 0, 'A2 não altera nem apaga a meta de A1');
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.minhas_metas) = 0
  AND pg_temp.n('UPDATE public.minhas_metas SET meta_vendas = 99') = 0, 'gestor não altera a meta do corretor');

-- 3) Isolamento organização A × B ------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.minhas_metas) = 0, 'organização B não vê metas da A');
-- Em dois passos: num só AND o Postgres pode avaliar a subconsulta antes do INSERT.
SELECT pg_temp.ok(pg_temp.err(format(
  'INSERT INTO public.minhas_metas (periodo, inicio, meta_vendas) VALUES (''mes'', %L, 4)', (SELECT mes FROM d))) IS NULL,
  'B1 grava a própria meta na organização B');
SELECT pg_temp.ok((SELECT count(*) = 1 AND bool_and(organization_id = pg_temp.id('orgB') AND user_id = pg_temp.id('b1'))
  FROM public.minhas_metas), 'meta de B1 fica na organização B, em nome dele');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.minhas_metas) = 2, 'A1 continua vendo só as 2 dele (nada da B)');

-- 4) Taxas da calculadora --------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_taxas (user_id, ligacoes_por_visita) VALUES (NULL, 5)') LIKE '42501%',
  'corretor não grava a taxa padrão da imobiliária');
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_taxas (user_id, comissao_media, ligacoes_por_visita) VALUES (NULL, 7000, 8)') IS NULL,
  'gestor grava a taxa padrão da imobiliária');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_taxas (user_id, ligacoes_por_visita) VALUES (%L, 12)', pg_temp.id('a1'))) IS NULL,
  'A1 ajusta as próprias taxas');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_taxas) = 2, 'A1 lê o padrão da imobiliária e as próprias');
SELECT pg_temp.ok(pg_temp.n('UPDATE public.carreira_taxas SET ligacoes_por_visita = 1 WHERE user_id IS NULL') = 0,
  'A1 não altera o padrão da imobiliária');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_taxas (user_id, ligacoes_por_visita) VALUES (%L, 1)', pg_temp.id('a2'))) LIKE '42501%',
  'A1 não grava taxas em nome de A2');
SELECT pg_temp.ok(pg_temp.err('UPDATE public.carreira_taxas SET visitas_por_acm = 0 WHERE user_id IS NOT NULL') LIKE '23514%',
  'taxa zero recusada');
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_taxas) = 1 AND (SELECT user_id FROM public.carreira_taxas) IS NULL,
  'A2 vê só o padrão (não vê as taxas de A1)');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_taxas) = 0, 'organização B não vê taxas da A');

-- 5) Realizado (mesma regra dos relatórios) --------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
CREATE TEMP TABLE ra1 AS SELECT * FROM public.meu_realizado((SELECT mes FROM d), (SELECT fim FROM d));
SELECT pg_temp.ok((SELECT comissao = 9000 AND vendas = 1 AND vgv = 500000 FROM ra1),
  'A1 no mês: comissão 9.000, 1 venda, VGV 500 mil (sem a venda de 200 dias atrás)');
SELECT pg_temp.ok((SELECT como_captador = 1 AND vgv_captador = 500000 AND como_vendedor = 0 AND vgv_vendedor = 0 FROM ra1),
  'A1 no mês: 1 como captador, 0 como vendedor');
SELECT pg_temp.ok((SELECT captacoes = 1 FROM ra1), 'A1 no mês: 1 captação aprovada (a descartada não conta)');
-- V3: A1 é captador (3.000) e vendedor (3.000) -> 9.000 + 6.000 = 15.000; VGV 500 mil + 200 mil.
SELECT pg_temp.ok((SELECT comissao = 15000 AND vendas = 2 AND vgv = 700000 AND como_captador = 2 AND como_vendedor = 1
  FROM public.meu_realizado(current_date - 300, current_date)), 'janela maior inclui a venda antiga (200 dias)');
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
SELECT pg_temp.ok((SELECT comissao = 15000 AND vendas = 2 AND vgv = 800000 AND como_captador = 1 AND como_vendedor = 2
  FROM public.meu_realizado((SELECT mes FROM d), (SELECT fim FROM d))), 'A2 no mês: só o que é dele (15.000, 2 vendas)');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok((SELECT comissao = 40000 AND vendas = 1 AND vgv = 700000 AND como_captador = 1
  FROM public.meu_realizado((SELECT mes FROM d), (SELECT fim FROM d))), 'B1: só a venda da organização B');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.meu_realizado(''2026-10-31'', ''2026-10-01'')') LIKE '22023%',
  'período invertido recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.meu_realizado(''2024-01-01'', ''2026-10-01'')') LIKE '22023%',
  'período maior que 1 ano recusado');

-- 6) Sem login e anon ------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.meu_realizado(current_date, current_date)') LIKE '42501%', 'sem login: recusa');
SELECT pg_temp.ok((SELECT count(*) FROM public.minhas_metas) = 0, 'sem login: nenhuma meta visível');
RESET ROLE;
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.meu_realizado(date,date)', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'public.minhas_metas', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.carreira_taxas', 'SELECT'), 'anon não acessa tabelas nem função');

-- 7) Módulo de captação desligado: captações = NULL ("sem dado"), vendas continuam -----------
UPDATE public.organization_modules SET enabled = false WHERE organization_id = pg_temp.id('orgA') AND module = 'captacao_exclusiva';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((SELECT captacoes IS NULL AND vendas = 1 FROM public.meu_realizado((SELECT mes FROM d), (SELECT fim FROM d))),
  'módulo desligado: captações sem dado, vendas continuam');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
