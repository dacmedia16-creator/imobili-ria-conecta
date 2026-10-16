-- Suíte da migration 20261016140000 (Minha carreira PR 3: módulo ranking_valores, carreira_ranking,
-- carreira_meus_destaques). Roda DENTRO de transação revertida (run-minha-carreira-ranking.sh).
-- Homologação: A = Agência A (slug unica-escolha, …-0001), B = Agência B (2a…b0). Perfis: corretor A1
-- (UE Corretor), corretor A2 (QA A Corretor Um), gestor A (…-0002), corretor B (QA B Corretor Um). Dados fictícios.
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
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.as_user(text), pg_temp.id(text)
  TO authenticated;

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
    'padrao', 'QA-MC3-' || _k, 'QA-MC3-' || _k, 'Rua QA Minha Carreira ' || _k, _valor, _valor * 0.06,
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
  (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month - 1 day')::date AS fim;
GRANT SELECT ON d TO authenticated;

-- 0) Padrão da chave: ligada só na Única Escolha ---------------------------------------------
SELECT pg_temp.ok((SELECT enabled FROM public.organization_modules
                    WHERE organization_id = pg_temp.id('orgA') AND module = 'ranking_valores')
  AND NOT (SELECT enabled FROM public.organization_modules
            WHERE organization_id = pg_temp.id('orgB') AND module = 'ranking_valores'),
  'chave "mostrar valores": ligada na Única Escolha (A), desligada na B');

-- Mural ligado nas duas (só dentro da transação).
UPDATE public.organization_modules SET enabled = true
 WHERE organization_id IN (pg_temp.id('orgA'), pg_temp.id('orgB')) AND module = 'mural_conquistas';
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o, 'mural_conquistas', true FROM unnest(ARRAY[pg_temp.id('orgA'), pg_temp.id('orgB')]) o
ON CONFLICT (organization_id, module) DO NOTHING;

-- Vendas: V1 (A1 capta, A2 vende) e V2 (A2 capta e vende) neste mês; V3 (A1) há 200 dias; VB na org B.
SELECT pg_temp.venda('v1', 'orgA', 'a1', 'a2', 500000, 0, 9000, 6000);
SELECT pg_temp.venda('v2', 'orgA', 'a2', 'a2', 300000, 0, 5000, 4000);
SELECT pg_temp.venda('v3', 'orgA', 'a1', 'a1', 200000, 200, 3000, 3000);
SELECT pg_temp.venda('vb', 'orgB', 'b1', 'b1', 700000, 0, 20000, 20000);
SELECT public.achievement_sync_sale(pg_temp.id(k)) FROM unnest(ARRAY['v1', 'v2', 'v3', 'vb']) k;

-- 1) Ranking com valores (chave ligada na A) -------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
CREATE TEMP TABLE rk1 AS SELECT * FROM public.carreira_ranking((SELECT mes FROM d), (SELECT fim FROM d));
SELECT pg_temp.ok((SELECT captacoes = 1 AND vendas = 2 AND pontos = 3 AND vgv = 800000 AND comissao = 15000 AND NOT eu
  FROM rk1 WHERE user_id = pg_temp.id('a2')), 'A1 vê A2 com nome, pontos (1 capt + 2 vendas), VGV 800 mil e comissão 15 mil');
SELECT pg_temp.ok((SELECT captacoes = 1 AND vendas = 0 AND pontos = 1 AND vgv = 500000 AND comissao = 9000 AND eu
  FROM rk1 WHERE user_id = pg_temp.id('a1')), 'A1 vê a própria linha marcada como "você" (VGV 500 mil, comissão 9 mil)');
SELECT pg_temp.ok((SELECT a.posicao < b.posicao FROM rk1 a, rk1 b
  WHERE a.user_id = pg_temp.id('a2') AND b.user_id = pg_temp.id('a1')), 'A2 (3 pontos) fica acima de A1 (1 ponto)');
SELECT pg_temp.ok((SELECT bool_and(valores_visiveis) FROM rk1) AND (SELECT count(*) FROM rk1 WHERE nome IS NULL) = 0,
  'chave ligada: valores visíveis e todos com nome');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_ranking(current_date - 300, current_date)
  WHERE user_id = pg_temp.id('a1') AND pontos = 3 AND comissao = 15000) = 1, 'janela maior inclui a venda antiga de A1');

-- 2) Isolamento organização A × B ------------------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FROM rk1 WHERE user_id = pg_temp.id('b1')) = 0, 'A1 não vê o corretor da organização B');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
CREATE TEMP TABLE rkb AS SELECT * FROM public.carreira_ranking((SELECT mes FROM d), (SELECT fim FROM d));
SELECT pg_temp.ok((SELECT count(*) FROM rkb WHERE user_id IN (pg_temp.id('a1'), pg_temp.id('a2'))) = 0,
  'B1 não vê corretores da organização A');
SELECT pg_temp.ok((SELECT pontos = 2 AND vgv = 700000 AND comissao = 40000 AND eu AND NOT valores_visiveis
  FROM rkb WHERE user_id = pg_temp.id('b1')), 'B1 (chave desligada na B) vê só os próprios valores');

-- 3) Chave desligada na A: só nome, posição e quantidade dos colegas -------------------------
RESET ROLE;
UPDATE public.organization_modules SET enabled = false
 WHERE organization_id = pg_temp.id('orgA') AND module = 'ranking_valores';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
CREATE TEMP TABLE rk2 AS SELECT * FROM public.carreira_ranking((SELECT mes FROM d), (SELECT fim FROM d));
SELECT pg_temp.ok((SELECT vgv IS NULL AND comissao IS NULL AND pontos = 3 AND nome IS NOT NULL AND posicao IS NOT NULL
  FROM rk2 WHERE user_id = pg_temp.id('a2')), 'chave desligada: A1 vê nome, posição e pontos de A2, sem VGV e comissão');
SELECT pg_temp.ok((SELECT count(*) FROM rk2 WHERE NOT eu AND (vgv IS NOT NULL OR comissao IS NOT NULL)) = 0
  AND NOT (SELECT bool_or(valores_visiveis) FROM rk2), 'chave desligada: nenhum valor de colega sai do banco');
SELECT pg_temp.ok((SELECT vgv = 500000 AND comissao = 9000 FROM rk2 WHERE eu), 'chave desligada: A1 continua vendo os próprios valores');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.platform_set_organization_module(%L, ''ranking_valores'', true)',
  pg_temp.id('orgA'))) LIKE '42501%', 'corretor não liga a chave');
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.platform_set_organization_module(%L, ''ranking_valores'', true)',
  pg_temp.id('orgA'))) LIKE '42501%', 'gestor da imobiliária não liga a chave (só o super-admin da plataforma)');

-- 4) Validações, usuário inativo, sem login e anon -------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_ranking(''2026-10-31'', ''2026-10-01'')') LIKE '22023%',
  'período invertido recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_ranking(''2024-01-01'', ''2026-10-01'')') LIKE '22023%',
  'período maior que 1 ano recusado');
RESET ROLE;
SELECT pg_temp.as_user('7dd997f7-2021-43ea-af9c-e758b826fcfd');  -- trava existente: só admin desativa usuário
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('a2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_ranking(current_date, current_date)') LIKE '42501%',
  'usuário inativo não vê o ranking');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_meus_destaques(10)) = 0, 'usuário inativo não vê destaques');
RESET ROLE;
SELECT pg_temp.as_user('7dd997f7-2021-43ea-af9c-e758b826fcfd');
UPDATE public.profiles SET ativo = true WHERE id = pg_temp.id('a2');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_ranking(current_date, current_date)') LIKE '42501%',
  'sem login: ranking recusado');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_meus_destaques(10)) = 0, 'sem login: nenhum destaque');
RESET ROLE;
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.carreira_ranking(date,date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.carreira_meus_destaques(integer)', 'EXECUTE'),
  'anon não executa ranking nem destaques');

-- 5) Destaques do Mural ----------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
CREATE TEMP TABLE da1 AS SELECT * FROM public.carreira_meus_destaques(10);
SELECT pg_temp.ok((SELECT count(*) FROM da1) = 2
  AND (SELECT count(*) FROM da1 d JOIN public.achievement_posts p ON p.id = d.id
        WHERE p.sale_id IN (pg_temp.id('v1'), pg_temp.id('v3'))) = 2,
  'A1 vê só os 2 destaques em que participa (V1 e V3)');
SELECT pg_temp.ok((SELECT papel FROM da1 d JOIN public.achievement_posts p ON p.id = d.id WHERE p.sale_id = pg_temp.id('v1')) = 'captação'
  AND (SELECT papel FROM da1 d JOIN public.achievement_posts p ON p.id = d.id WHERE p.sale_id = pg_temp.id('v3')) = 'captou e vendeu',
  'papel do corretor no destaque');
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_meus_destaques(10)) = 2, 'A2 vê os destaques dele (V1 e V2)');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_meus_destaques(10) d JOIN public.achievement_posts p ON p.id = d.id
  WHERE p.sale_id = pg_temp.id('vb')) = 1 AND (SELECT count(*) FROM public.carreira_meus_destaques(10) d
  JOIN public.achievement_posts p ON p.id = d.id WHERE p.organization_id <> pg_temp.id('orgB')) = 0,
  'B1 vê só destaque da organização B');
RESET ROLE;
UPDATE public.organization_modules SET enabled = false WHERE organization_id = pg_temp.id('orgA') AND module = 'mural_conquistas';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_meus_destaques(10)) = 0, 'Mural desligado: sem destaques');
RESET ROLE;

-- 6) Clube RE/MAX ----------------------------------------------------------------------------
-- V4: A1 capta e vende no ano civil anterior (comissão 100 mil + 50 mil = 150 mil -> Executive).
SELECT pg_temp.venda('v4', 'orgA', 'a1', 'a1', 2500000, 0, 100000, 50000);
UPDATE public.sales SET data_assinatura = make_date(extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::int - 1, 6, 15)
 WHERE id = pg_temp.id('v4');
UPDATE public.sale_status_history SET created_at = make_date(extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::int - 1, 6, 15) + time '12:00'
 WHERE sale_id = pg_temp.id('v4');
SELECT pg_temp.ok((SELECT count(*) = 7 AND min(origem) = 'Tabela de referência 2025' AND bool_and(ano = 2025)
  FROM public.clube_remax_faixas WHERE organization_id = pg_temp.id('orgA')), 'carga inicial: 7 faixas da tabela de referência 2025');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
CREATE TEMP TABLE cl1 AS SELECT * FROM public.carreira_clube(NULL);
SELECT pg_temp.ok((SELECT vgc_ano_anterior = 150000 AND clube_atual = 'Executive' FROM cl1),
  'A1: clube atual Executive (VGC 150 mil no ano anterior)');
SELECT pg_temp.ok((SELECT vgc_ano_corrente = 15000 AND clube_buscando IS NULL AND proximo_clube = 'Executive'
  AND falta_proximo = 117696 FROM cl1), 'A1: ano corrente 15 mil, faltam 117.696 para o Executive');
SELECT pg_temp.ok((SELECT tabela_buscando = 2025 AND origem = 'Tabela de referência 2025' FROM cl1),
  'sem tabela do ano, usa a de referência 2025 e informa a origem');
SELECT pg_temp.ok((SELECT count(*) FROM public.clube_remax_faixas) = 7, 'corretor lê as faixas da própria imobiliária');
SELECT pg_temp.ok(pg_temp.err('UPDATE public.clube_remax_faixas SET vgc_minimo = 1') IS NULL
  AND (SELECT min(vgc_minimo) FROM public.clube_remax_faixas) = 132696, 'corretor não altera as faixas');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.clube_remax_faixas (ano, ordem, nome, vgc_minimo) VALUES (2026, 1, ''X'', 1)') LIKE '42501%',
  'corretor não cria faixa');
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
SELECT pg_temp.ok((SELECT vgc_ano_anterior = 0 AND clube_atual IS NULL FROM public.carreira_clube(NULL)),
  'A2 não soma o VGC de A1');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok((SELECT vgc_ano_corrente = 40000 AND vgc_ano_anterior = 0 FROM public.carreira_clube(NULL)),
  'B1: só o VGC da organização B');
SELECT pg_temp.ok((SELECT count(*) FROM public.clube_remax_faixas WHERE organization_id = pg_temp.id('orgA')) = 0,
  'organização B não vê as faixas da A');
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.clube_remax_faixas (ano, ordem, nome, vgc_minimo, origem) VALUES (%s, 1, ''Executive'', 100000, ''Tabela %s'')',
  extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::int, extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::int)) IS NULL,
  'gestor cadastra faixa do ano novo');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((SELECT clube_atual = 'Executive' AND tabela_atual = extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::int
  FROM public.carreira_clube(NULL)), 'com tabela do ano cadastrada, o clube atual usa a tabela nova');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_clube(NULL)') LIKE '42501%', 'sem login: clube recusado');
RESET ROLE;
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.carreira_clube(integer)', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'public.clube_remax_faixas', 'SELECT'), 'anon não acessa clube nem faixas');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
