-- Suíte da migration 20261211130000 ("Consultar imóvel" da Locação, t_241e03a9). Roda DENTRO de transação revertida
-- (run-locacao-consultar-imovel.sh), na homologação, só com dados fictícios. Pessoas da homologação:
-- c2 = QA A Corretor Dois (corretor da Agência A), a1 = UE Corretor (outro corretor da A), b1 = QA B Corretor Um (Agência B).
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
GRANT ALL ON r, ids, js TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _uid = '' THEN '' ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM js WHERE k = _k $$;
CREATE FUNCTION pg_temp.put(_k text, _v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO js VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
-- Primeiro item da busca com este código/endereço.
CREATE FUNCTION pg_temp.item(_k text, _cod text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT x FROM jsonb_array_elements((SELECT v FROM js WHERE k = _k)) x WHERE x->>'imovel_id' IS NOT DISTINCT FROM _cod LIMIT 1 $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('a1', '10000000-0000-4000-8000-000000000003'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244');

-- Montagem (só nesta transação; gatilhos da tabela desligados para gravar as etapas direto) ---------------------
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true),
  (pg_temp.id('orgB'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
SET LOCAL session_replication_role = replica;
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, situacao, endereco, candidato, ficha, aluguel, atualizado_em) VALUES
  -- ZZQ-1: pré-análise do a1 (tem nome/CPF do candidato e aluguel: NÃO podem sair na consulta).
  (pg_temp.id('orgA'), pg_temp.id('a1'), 'pre_analise', 'ativa', 'Rua Fictícia Açaí, 100', 
   '{"nome":"Candidato Secreto","cpf":"000.111.222-33","telefone":"(15) 90000-0001"}',
   '{"imovel_id":"ZZQ-1","complemento":"Ap 11","proprietario":{"nome":"Dono Secreto"}}', 3210.55, now() - interval '3 day'),
  -- ZZQ-2: documentação do c2.
  (pg_temp.id('orgA'), pg_temp.id('c2'), 'documentacao', 'ativa', 'Avenida Teste Zzq, 200', '{}', '{"imovel_id":"ZZQ-2"}', 1500, now()),
  -- ZZQ-3: assinatura do a1 + uma encerrada antiga do mesmo imóvel (deve valer a ativa).
  (pg_temp.id('orgA'), pg_temp.id('a1'), 'assinatura', 'ativa', 'Rua Zzq Três, 30', '{}', '{"imovel_id":"ZZQ-3"}', 1800, now()),
  (pg_temp.id('orgA'), pg_temp.id('c2'), 'pre_analise', 'encerrada', 'Rua Zzq Três, 30', '{}', '{"imovel_id":"zzq-3"}', 1700, now()),
  -- ZZQ-7: encerrada em "Rua Zzq Sete" + ATIVA do mesmo código digitada "R. Sete-Zzk" (busca por endereço não pode dar Livre).
  (pg_temp.id('orgA'), pg_temp.id('c2'), 'pre_analise', 'encerrada', 'Rua Zzq Sete, 70', '{}', '{"imovel_id":"ZZQ-7"}', 900, now()),
  (pg_temp.id('orgA'), pg_temp.id('a1'), 'minuta', 'ativa', 'R. Sete-Zzk, 70', '{}', '{"imovel_id":"ZZQ-7"}', 900, now()),
  -- ZZQ-4: só encerrada (reprovada) -> Livre.
  (pg_temp.id('orgA'), pg_temp.id('a1'), 'aprovacao', 'encerrada', 'Rua Zzq Quatro, 40', '{}', '{"imovel_id":"ZZQ-4"}', 900, now()),
  -- ZZQ-5: comissão (depois da chave, ainda ativa) -> Alugado (t_56101806).
  (pg_temp.id('orgA'), pg_temp.id('c2'), 'comissao', 'ativa', 'Rua Zzq Cinco, 50', '{}', '{"imovel_id":"ZZQ-5"}', 900, now()),
  -- ZZQ-D: documentação cancelada/desistida (encerrada sem chave) -> Livre.
  (pg_temp.id('orgA'), pg_temp.id('a1'), 'documentacao', 'encerrada', 'Rua Zzq Dez, 10', '{}', '{"imovel_id":"ZZQ-D"}', 900, now()),
  -- ZZQ-6: aprovação gestora -> pré-análise.
  (pg_temp.id('orgA'), pg_temp.id('a1'), 'aprovacao', 'ativa', 'Rua Zzq Seis, 60', '{}', '{"imovel_id":"ZZQ-6"}', 900, now()),
  -- Agência B com o MESMO código: a A nunca pode ver.
  (pg_temp.id('orgB'), pg_temp.id('b1'), 'minuta', 'ativa', 'Rua Fictícia Açaí, 100', '{}', '{"imovel_id":"ZZQ-1"}', 999, now());
-- Com chave entregue (t_56101806): ZZQ-8 locação encerrada normalmente depois da chave -> Alugado;
-- ZZQ-9 alugado antigo + processo ATIVO novo em pré-análise -> vale o ativo.
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, situacao, endereco, ficha, chave_em, atualizado_em) VALUES
  (pg_temp.id('orgA'), pg_temp.id('c2'), 'comissao', 'encerrada', 'Rua Zzq Oito, 80', '{"imovel_id":"ZZQ-8"}',
   current_date - 400, now() - interval '30 day'),
  (pg_temp.id('orgA'), pg_temp.id('c2'), 'comissao', 'encerrada', 'Rua Zzq Nove, 90', '{"imovel_id":"ZZQ-9"}',
   current_date - 400, now()),
  (pg_temp.id('orgA'), pg_temp.id('a1'), 'pre_analise', 'ativa', 'Rua Zzq Nove, 90', '{"imovel_id":"ZZQ-9"}',
   NULL, now() - interval '1 day');
-- 12 imóveis "ZZW-nn" para provar o limite de 10.
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, situacao, endereco, ficha)
SELECT pg_temp.id('orgA'), pg_temp.id('c2'), 'pre_analise', 'ativa', 'Travessa Zzw ' || g, jsonb_build_object('imovel_id', 'ZZW-' || g)
  FROM generate_series(1, 12) g;
SET LOCAL session_replication_role = origin;

-- 0) Estrutura e permissões ----------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT p.prosecdef AND coalesce('search_path=""' = ANY (p.proconfig), false)
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    FROM pg_proc p WHERE p.oid = 'public.locacao_consultar_imovel(text)'::regprocedure),
  'RPC SECURITY DEFINER, search_path vazio, só para logados');
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.locacoes', 'SELECT')
  OR EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.locacoes'::regclass AND relrowsecurity),
  'tabela locacoes continua protegida (RLS / sem SELECT aberto)');

-- 1) Corretor da A (c2) consulta imóveis que NÃO são dele --------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('cod1', public.locacao_consultar_imovel('zzq-1'));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('cod1')) = 1, 'por código: acha só o imóvel da própria imobiliária');
SELECT pg_temp.ok(pg_temp.item('cod1', 'ZZQ-1')->>'status' = 'pre_analise'
  AND pg_temp.item('cod1', 'ZZQ-1')->>'corretor' = 'UE Corretor'
  AND pg_temp.item('cod1', 'ZZQ-1')->>'endereco' = 'Rua Fictícia Açaí, 100 — Ap 11',
  'pré-análise de OUTRO corretor: status amarelo + nome do corretor responsável');
SELECT pg_temp.ok((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.item('cod1', 'ZZQ-1')) k)
    = ARRAY['corretor', 'endereco', 'etapa', 'imovel_id', 'processos_ativos', 'status']
  AND pg_temp.j('cod1')::text NOT LIKE '%Secreto%' AND pg_temp.j('cod1')::text NOT LIKE '%000.111%'
  AND pg_temp.j('cod1')::text NOT LIKE '%3210%' AND pg_temp.j('cod1')::text NOT LIKE '%90000%',
  'LGPD: só os 6 campos; sem candidato, CPF, telefone, proprietário ou valores');
SELECT pg_temp.put('end1', public.locacao_consultar_imovel('fictícia acai'));
SELECT pg_temp.ok(pg_temp.item('end1', 'ZZQ-1') IS NOT NULL, 'por endereço: sem diferenciar maiúsculas/acentos');
SELECT pg_temp.put('end2', public.locacao_consultar_imovel('AP 11'));
SELECT pg_temp.ok(pg_temp.item('end2', 'ZZQ-1') IS NOT NULL, 'por endereço: complemento (bloco/apto) também conta');
SELECT pg_temp.ok((public.locacao_consultar_imovel('ZZQ-2')->0->>'status') = 'documentacao'
  AND (public.locacao_consultar_imovel('ZZQ-2')->0->>'etapa') = 'documentacao', 'documentação -> laranja');
SELECT pg_temp.put('q3', public.locacao_consultar_imovel('ZZQ-3'));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('q3')) = 1 AND pg_temp.j('q3')->0->>'status' = 'contrato'
  AND (pg_temp.j('q3')->0->>'processos_ativos')::int = 1
  AND pg_temp.j('q3')->0->>'corretor' = 'UE Corretor',
  'mesmo imóvel com encerrada + assinatura: 1 linha, vale a ativa (vermelho)');
SELECT pg_temp.put('q4', public.locacao_consultar_imovel('ZZQ-4'));
SELECT pg_temp.ok(pg_temp.j('q4')->0->>'status' = 'livre' AND pg_temp.j('q4')->0->'corretor' = 'null'::jsonb
  AND pg_temp.j('q4')->0->'etapa' = 'null'::jsonb AND (pg_temp.j('q4')->0->>'processos_ativos')::int = 0,
  'só encerrada/reprovada: Livre, sem corretor');
SELECT pg_temp.put('q7', public.locacao_consultar_imovel('rua zzq sete'));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('q7')) = 1 AND pg_temp.j('q7')->0->>'status' = 'contrato'
  AND pg_temp.j('q7')->0->>'corretor' = 'UE Corretor' AND pg_temp.j('q7')->0->>'endereco' = 'R. Sete-Zzk, 70',
  'busca por endereço antigo acha o processo ativo do mesmo código (sem Livre falso)');
SELECT pg_temp.put('q5', public.locacao_consultar_imovel('ZZQ-5'));
SELECT pg_temp.ok(pg_temp.j('q5')->0->>'status' = 'alugado' AND pg_temp.j('q5')->0->'corretor' = 'null'::jsonb
  AND (pg_temp.j('q5')->0->>'processos_ativos')::int = 0, 'comissão (chave já entregue) -> Alugado, sem corretor');
SELECT pg_temp.put('q8', public.locacao_consultar_imovel('ZZQ-8'));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('q8')) = 1 AND pg_temp.j('q8')->0->>'status' = 'alugado'
  AND pg_temp.j('q8')->0->'corretor' = 'null'::jsonb AND pg_temp.j('q8')->0->'etapa' = 'null'::jsonb,
  'encerrada normalmente depois da chave -> Alugado (não Livre)');
SELECT pg_temp.put('q9', public.locacao_consultar_imovel('zzq nove'));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('q9')) = 1 AND pg_temp.j('q9')->0->>'status' = 'pre_analise'
  AND pg_temp.j('q9')->0->>'corretor' = 'UE Corretor' AND (pg_temp.j('q9')->0->>'processos_ativos')::int = 1,
  'alugado antigo + processo ativo novo: vale o ativo (pré-análise)');
SELECT pg_temp.put('q10', public.locacao_consultar_imovel('ZZQ-D'));
SELECT pg_temp.ok(pg_temp.j('q10')->0->>'status' = 'livre' AND pg_temp.j('q10')->0->'corretor' = 'null'::jsonb,
  'cancelada/desistida sem chave -> Livre');
SELECT pg_temp.ok(public.locacao_consultar_imovel('ZZQ-6')->0->>'status' = 'pre_analise', 'aprovação gestora -> amarelo');
SELECT pg_temp.ok(public.locacao_consultar_imovel('nada-zzq-existe') = '[]'::jsonb, 'nada achado: lista vazia');
SELECT pg_temp.ok(jsonb_array_length(public.locacao_consultar_imovel('zzw-')) = 10, 'no máximo 10 resultados');
SELECT pg_temp.ok(public.locacao_consultar_imovel('zz%') = '[]'::jsonb
  AND public.locacao_consultar_imovel('z_q') = '[]'::jsonb, '% e _ digitados não viram curinga');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_consultar_imovel(''zz'')') LIKE '22023%3 letras%'
  AND pg_temp.err('SELECT public.locacao_consultar_imovel(''  z  '')') LIKE '22023%'
  AND pg_temp.err('SELECT public.locacao_consultar_imovel(NULL)') LIKE '22023%'
  AND pg_temp.err(format('SELECT public.locacao_consultar_imovel(%L)', repeat('a', 101))) LIKE '22023%',
  'termo mínimo de 3 caracteres e máximo de 100');

-- 2) Outra imobiliária (b1) só vê a dela -------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.put('b', public.locacao_consultar_imovel('ZZQ'));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('b')) = 1 AND pg_temp.j('b')->0->>'status' = 'contrato'
  AND pg_temp.j('b')->0->>'corretor' = 'QA B Corretor Um',
  'multiempresa: Agência B só vê o próprio processo do mesmo código');

-- 3) Sem login / módulo desligado ---------------------------------------------------------------------------------
SELECT pg_temp.as_user('');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_consultar_imovel(''ZZQ-1'')') LIKE '42501%', 'sem login: recusado');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_consultar_imovel(''ZZQ-1'')') LIKE '42501%', 'anon: sem permissão');
RESET ROLE;
UPDATE public.organization_modules SET enabled = false WHERE organization_id = pg_temp.id('orgA') AND module = 'locacao';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_consultar_imovel(''ZZQ-1'')') LIKE '42501%Locação desligada%',
  'Locação desligada na imobiliária: recusado');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
