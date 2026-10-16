-- Suíte da migration 20261016170000 (Minha carreira PR 4: minhas_comissoes, bloco "Meu dinheiro").
-- Roda DENTRO de transação revertida (run-minha-carreira-meu-dinheiro.sh). Dados fictícios.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0). Perfis: corretor A1, corretor A2, corretor B1.
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

-- Venda com ocorrência e comissões por participante. _assinada = false: venda ainda não assinada (não conta).
CREATE FUNCTION pg_temp.venda(_k text, _org text, _capt text, _vend text, _valor numeric,
  _com_capt numeric, _com_vend numeric, _assinada boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _s uuid := gen_random_uuid(); _o uuid := gen_random_uuid();
BEGIN
  INSERT INTO ids VALUES (_k, _s), ('o' || _k, _o);
  INSERT INTO public.sales (id, organization_id, corretor_id, corretor_captador_id, corretor_vendedor_id, status,
    modalidade, codigo_interno, imovel_id, imovel_endereco, imovel_bairro, tipo_imovel, valor_negociado,
    valor_total_comissao, data_assinatura)
  VALUES (_s, pg_temp.id(_org), pg_temp.id(_capt), pg_temp.id(_capt), pg_temp.id(_vend),
    CASE WHEN _assinada THEN 'contrato_assinado' ELSE 'contrato_conferencia_gestor' END::public.sale_status,
    'padrao', 'QA-MC4-' || _k, 'QA-MC4-' || _k, 'Rua QA Minha Carreira ' || _k, 'Bairro QA', 'Casa', _valor,
    _valor * 0.06, CASE WHEN _assinada THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date END);
  IF _assinada THEN
    INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
    VALUES (_s, pg_temp.id(_org), 'contrato_assinado', now());
  END IF;
  INSERT INTO public.occurrences (id, sale_id, organization_id, status) VALUES (_o, _s, pg_temp.id(_org), 'pendente');
  INSERT INTO public.occurrence_commissions (occurrence_id, organization_id, papel, user_id, valor)
  VALUES (_o, pg_temp.id(_org), 'corretor_captador', pg_temp.id(_capt), _com_capt),
         (_o, pg_temp.id(_org), 'corretor_vendedor', pg_temp.id(_vend), _com_vend);
END $$;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('a2', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244');

-- V1: A1 capta (9 mil), A2 vende (6 mil). Comissão da venda prevista em 2 parcelas: 10 mil a receber
--     e 5 mil já recebidos. V2: A2 capta e vende, sem previsão. V3: A1, venda não assinada (não conta).
--     VB: B1 na organização B.
SELECT pg_temp.venda('v1', 'orgA', 'a1', 'a2', 500000, 9000, 6000);
SELECT pg_temp.as_user('7dd997f7-2021-43ea-af9c-e758b826fcfd');  -- trava existente: só financeiro/admin dá baixa
UPDATE public.occurrences SET prev_recebimento_data = current_date + 20, prev_recebimento_valor = 10000, prev_recebimento_forma = 'pix',
       prev_recebimento2_data = current_date - 5, prev_recebimento2_valor = 5000, prev_recebimento2_forma = 'pix',
       prev_recebimento2_recebido_em = current_date - 4, prev_recebimento2_recebido_valor = 5000
 WHERE id = pg_temp.id('ov1');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.venda('v2', 'orgA', 'a2', 'a2', 300000, 5000, 4000);
SELECT pg_temp.venda('v3', 'orgA', 'a1', 'a1', 200000, 3000, 3000, false);
SELECT pg_temp.venda('vb', 'orgB', 'b1', 'b1', 700000, 20000, 20000);
UPDATE public.occurrences SET prev_recebimento_data = current_date + 10, prev_recebimento_valor = 40000, prev_recebimento_forma = 'pix'
 WHERE id = pg_temp.id('ovb');
CREATE TEMP TABLE antes AS SELECT md5(string_agg(t, ',' ORDER BY t)) h FROM (
  SELECT o::text t FROM public.occurrences o WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT c::text FROM public.occurrence_commissions c JOIN public.occurrences o ON o.id = c.occurrence_id
   WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT s::text FROM public.sales s WHERE s.id IN (SELECT v FROM ids)) x;

-- 1) Parte do próprio corretor, parcela a parcela ---------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
CREATE TEMP TABLE m1 AS SELECT * FROM public.minhas_comissoes();
SELECT pg_temp.ok((SELECT count(*) FROM m1) = 2 AND (SELECT count(DISTINCT sale_id) FROM m1) = 1
  AND (SELECT bool_and(sale_id = pg_temp.id('v1')) FROM m1), 'A1 vê só a venda V1 (assinada), em 2 parcelas');
SELECT pg_temp.ok((SELECT valor_previsto = 6000 AND recebido_em IS NULL AND parcela = 1 AND parcelas = 2
  AND data_prevista = current_date + 20 FROM m1 WHERE parcela = 1), 'parcela 1 a receber: 6 mil (9 mil × 10/15)');
SELECT pg_temp.ok((SELECT valor_previsto = 3000 AND valor_recebido = 3000 AND recebido_em = current_date - 4
  FROM m1 WHERE parcela = 2), 'parcela 2 recebida: 3 mil (9 mil × 5/15)');
SELECT pg_temp.ok((SELECT sum(valor_previsto) FROM m1) = 9000 AND (SELECT bool_and(minha_comissao = 9000) FROM m1),
  'soma das parcelas fecha com a comissão de A1 (9 mil)');
SELECT pg_temp.ok((SELECT bool_and(papel = 'captador') FROM m1), 'papel de A1 na venda: captador');
SELECT pg_temp.ok((SELECT bool_and(imovel = 'Casa · Bairro QA') FROM m1), 'imóvel descrito por tipo e bairro, sem cliente');
SELECT pg_temp.ok((SELECT count(*) FROM m1 WHERE sale_id = pg_temp.id('v3')) = 0, 'venda não assinada não aparece');

SELECT pg_temp.as_user(pg_temp.id('a2')::text);
CREATE TEMP TABLE m2 AS SELECT * FROM public.minhas_comissoes();
SELECT pg_temp.ok((SELECT sum(valor_previsto) FROM m2 WHERE sale_id = pg_temp.id('v1')) = 6000,
  'A2 vê só a parte dele em V1 (6 mil), não a de A1');
SELECT pg_temp.ok((SELECT data_prevista IS NULL AND valor_previsto = 9000 AND parcelas = 1 AND papel = 'captador e vendedor'
  FROM m2 WHERE sale_id = pg_temp.id('v2')), 'venda sem previsão: 1 linha "sem data" com a parte inteira (9 mil)');

-- 2) Isolamento organização A × B -------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
CREATE TEMP TABLE mb AS SELECT * FROM public.minhas_comissoes();
SELECT pg_temp.ok((SELECT count(*) FROM mb) = 1 AND (SELECT valor_previsto = 40000 FROM mb WHERE sale_id = pg_temp.id('vb')),
  'B1 vê só a própria comissão na organização B (40 mil)');
SELECT pg_temp.ok((SELECT count(*) FROM mb WHERE sale_id IN (pg_temp.id('v1'), pg_temp.id('v2'))) = 0,
  'B1 não vê vendas da organização A');
SELECT pg_temp.ok((SELECT count(*) FROM m1 WHERE sale_id = pg_temp.id('vb')) = 0, 'A1 não vê vendas da organização B');

-- 3) Usuário inativo, sem login e anon --------------------------------------------------------
RESET ROLE;
SELECT pg_temp.as_user('7dd997f7-2021-43ea-af9c-e758b826fcfd');  -- trava existente: só admin desativa usuário
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('a2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.minhas_comissoes()') LIKE '42501%', 'usuário inativo não vê comissões');
RESET ROLE;
SELECT pg_temp.as_user('7dd997f7-2021-43ea-af9c-e758b826fcfd');
UPDATE public.profiles SET ativo = true WHERE id = pg_temp.id('a2');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.minhas_comissoes()') LIKE '42501%', 'sem login: recusado');
RESET ROLE;
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.minhas_comissoes()', 'EXECUTE'), 'anon não executa');
SELECT pg_temp.ok((SELECT provolatile = 's' FROM pg_proc WHERE oid = 'public.minhas_comissoes()'::regprocedure),
  'função é só leitura (STABLE)');

-- 4) Nada foi alterado em vendas, ocorrências e comissões -------------------------------------
SELECT pg_temp.ok((SELECT h FROM antes) = (SELECT md5(string_agg(t, ',' ORDER BY t)) FROM (
  SELECT o::text t FROM public.occurrences o WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT c::text FROM public.occurrence_commissions c JOIN public.occurrences o ON o.id = c.occurrence_id
   WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT s::text FROM public.sales s WHERE s.id IN (SELECT v FROM ids)) x),
  'consultas não alteram vendas, ocorrências nem comissões');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
