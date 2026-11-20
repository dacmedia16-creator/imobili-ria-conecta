-- Suíte da migration 20261212120000 (dados de pagamento do parceiro na locação, t_756c1c63). Roda DENTRO de transação
-- revertida (run-locacao-parceiro-pagamento.sh), na homologação, só com dados fictícios. Pessoas da homologação (Agência A):
-- c2 = QA A Corretor Dois (corretor dono), con = QA A Dono Plataforma (vistoria = Fernanda), ges = gestora,
-- fin = QA A Corretor Um (recebe aqui o papel Financeiro da locação), adm = administrador, a1 = UE Corretor,
-- b1/admB = Agência B.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
GRANT ALL ON r, ids, js TO authenticated, service_role, anon;
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
-- Conferências diretas na tabela (fechada ao navegador) pelo dono do banco.
CREATE FUNCTION pg_temp.pag(_k text) RETURNS public.locacao_parceiro_pagamento LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT p FROM public.locacao_parceiro_pagamento p WHERE p.locacao_id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.lan(_k text) RETURNS public.locacao_lancamentos LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT x FROM public.locacao_lancamentos x WHERE x.locacao_id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.eventos(_k text) RETURNS text LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT coalesce(string_agg(descricao, ' | ' ORDER BY id), '') FROM public.locacao_eventos WHERE locacao_id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.cnpj(_v text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_cnpj_ok(_v) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role, anon;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('ges', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('con', 'b316b223-da46-4c2c-9952-25096d5ae5ff'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'),
  ('admB', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536'), ('fin', '5745cbff-22b6-4a28-a515-dd6706504b8b');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true),
  (pg_temp.id('orgB'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.locacao_papeis (organization_id, user_id, papel) VALUES (pg_temp.id('orgA'), pg_temp.id('ges'), 'gestora'),
  (pg_temp.id('orgA'), pg_temp.id('con'), 'vistoria'), (pg_temp.id('orgA'), pg_temp.id('fin'), 'financeiro'),
  (pg_temp.id('orgA'), pg_temp.id('a1'), 'contratos')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('a1'), 'financeiro', pg_temp.id('orgA'))
ON CONFLICT DO NOTHING;
-- Duas locações fictícias da A já assinadas (L = com parceria; S = sem) e uma da B.
WITH s AS (INSERT INTO public.locacoes (organization_id, corretor_id, etapa, aluguel, taxa_adm, endereco)
  VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'pos_assinatura', 3000, 10, 'Rua Fictícia, 1') RETURNING id)
INSERT INTO ids SELECT 'L', id FROM s;
WITH s AS (INSERT INTO public.locacoes (organization_id, corretor_id, etapa, aluguel, taxa_adm, endereco)
  VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'pos_assinatura', 2000, 10, 'Rua Fictícia, 2') RETURNING id)
INSERT INTO ids SELECT 'S', id FROM s;
WITH s AS (INSERT INTO public.locacoes (organization_id, corretor_id, etapa, aluguel, taxa_adm, endereco)
  VALUES (pg_temp.id('orgB'), pg_temp.id('b1'), 'pos_assinatura', 1500, 10, 'Rua Fictícia B') RETURNING id)
INSERT INTO ids SELECT 'B', id FROM s;

-- 0) Estrutura e permissões ----------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.locacao_parceiro_pagamento'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.locacao_parceiro_pagamento', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.locacao_parceiro_pagamento', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.locacao_parceiro_pagamento', 'SELECT')
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'locacao_parceiro_pagamento'),
  'tabela de pagamento com RLS, sem política e fechada ao navegador');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('locacao_parceiro_pag_ler', 'locacao_parceiro_pag_salvar', 'locacao_parceiros_pagar',
                     'locacao_lancamento_ler', 'locacao_lancamento_salvar')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR NOT p.prosecdef OR NOT coalesce('search_path=""' = ANY (p.proconfig), false))),
  'RPCs: SECURITY DEFINER, search_path vazio, só authenticated');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('locacao_parceiro_pag_pode', 'locacao_parceiro_pag_json')
   AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'funções internas fechadas ao navegador');
SELECT pg_temp.ok(pg_temp.cnpj('11.222.333/0001-81') AND pg_temp.cnpj('11222333000181') AND NOT pg_temp.cnpj('11.222.333/0001-82')
  AND NOT pg_temp.cnpj('11111111111111') AND NOT pg_temp.cnpj('1122233300018') AND NOT pg_temp.cnpj(NULL), 'CNPJ: dígitos verificadores');
-- Nenhuma função antiga (lista, detalhe, links, consulta) lê a tabela nova.
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND pg_get_functiondef(p.oid) LIKE '%locacao_parceiro_pagamento%'
   AND p.proname NOT IN ('locacao_parceiro_pag_ler', 'locacao_parceiro_pag_salvar', 'locacao_parceiros_pagar',
                         'locacao_parceiro_pag_json', 'locacao_lancamento_salvar')), 'só as RPCs novas tocam nos dados de pagamento');

-- 1) Lançamento: lado do parceiro ----------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, %L)', pg_temp.id('L'),
  '{"aluguel":"3000","taxa_adm":"10","parceria":"externa","parceria_imobiliaria":"Imob Parceira (fictícia)"}')) LIKE '22023%lado%',
  'parceria externa sem lado é recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, %L)', pg_temp.id('L'),
  '{"aluguel":"3000","taxa_adm":"10","parceria":"remax","parceria_unidade":"RE/MAX X","parceria_corretor":"Ana","parceria_lado":"os_dois"}')) LIKE '22023%lado%',
  'lado inválido (dois lados externos) recusado');
SELECT pg_temp.ok((public.locacao_lancamento_salvar(pg_temp.id('L'), jsonb_build_object('aluguel', '3000', 'taxa_adm', '10',
  'parceria', 'externa', 'parceria_imobiliaria', 'Imob Parceira (fictícia)', 'parceria_corretor', 'Corretor Parceiro (fictício)',
  'parceria_creci', '12345-F', 'parceria_lado', 'captador', 'captador_id', pg_temp.id('a1')))->>'novo')::boolean,
  'externa com lado captador registrada');
SELECT pg_temp.ok((pg_temp.lan('L')).parceria_lado = 'captador' AND (pg_temp.lan('L')).captador_id IS NULL
  AND (pg_temp.lan('L')).parceria_corretor = 'Corretor Parceiro (fictício)' AND (pg_temp.lan('L')).parceria_creci = '12345-F',
  'lado do proprietário com o parceiro: captador da casa fica vazio; corretor e CRECI gravados');
SELECT pg_temp.put('lan', public.locacao_lancamento_ler(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('lan')->'valores'->>'parceria_lado' = 'captador' AND pg_temp.j('lan')->'valores'->>'parceria_creci' = '12345-F'
  AND NOT (pg_temp.j('lan')::text ~ 'documento|pix|agencia'), 'leitura do lançamento traz lado/CRECI e nenhum dado de pagamento');
SELECT pg_temp.ok((public.locacao_lancamento_salvar(pg_temp.id('S'), '{"aluguel":"2000","taxa_adm":"10","parceria_lado":"captador","parceria_creci":"9"}')->>'ok')::boolean
  AND (pg_temp.lan('S')).parceria_lado IS NULL AND (pg_temp.lan('S')).parceria_creci IS NULL, 'sem parceria: lado e CRECI ignorados');
-- Vistoria NÃO vê nem grava dados de pagamento.
SELECT pg_temp.ok((public.locacao_parceiro_pag_ler(pg_temp.id('L'))->>'pode')::boolean = false
  AND public.locacao_parceiro_pag_ler(pg_temp.id('L'))->'dados' IS NULL, 'vistoria: leitura devolve só pode=false');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_parceiro_pag_salvar(%L, %L)', pg_temp.id('L'),
  '{"favorecido_tipo":"corretor","favorecido_nome":"X","documento":"529.982.247-25","pix":"x@y.co","emite_nf":false}')) LIKE '42501%',
  'vistoria não grava dados de pagamento');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_parceiros_pagar()') LIKE '42501%', 'vistoria não vê a lista de pagamentos');

-- 2) Financeiro da locação grava (CPF e CNPJ validados) --------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_parceiro_pag_salvar(%L, %L)', pg_temp.id('L'),
  '{"favorecido_tipo":"corretor","favorecido_nome":"Corretor Parceiro","documento":"529.982.247-26","pix":"x@y.co","emite_nf":false}')) LIKE '22023%CPF%',
  'CPF com dígito errado recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_parceiro_pag_salvar(%L, %L)', pg_temp.id('L'),
  '{"favorecido_tipo":"imobiliaria","favorecido_nome":"Imob","documento":"529.982.247-25","pix":"x@y.co","emite_nf":true}')) LIKE '22023%CNPJ%',
  'imobiliária com CPF no lugar do CNPJ recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_parceiro_pag_salvar(%L, %L)', pg_temp.id('L'),
  '{"favorecido_tipo":"corretor","favorecido_nome":"Corretor Parceiro","documento":"529.982.247-25","banco":"Banco X","emite_nf":false}')) LIKE '22023%PIX%',
  'sem PIX e sem banco/agência/conta completos recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_parceiro_pag_salvar(%L, %L)', pg_temp.id('L'),
  '{"favorecido_tipo":"corretor","favorecido_nome":"Corretor Parceiro","documento":"529.982.247-25","pix":"x@y.co"}')) LIKE '22023%nota%',
  'emite NF obrigatório');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_parceiro_pag_salvar(%L, %L)', pg_temp.id('L'),
  '{"favorecido_tipo":"corretor","favorecido_nome":"C","documento":"529.982.247-25","pix":"x@y.co","emite_nf":false,"senha":"1"}')) LIKE '22023%',
  'campo desconhecido recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_parceiro_pag_salvar(%L, %L)', pg_temp.id('S'),
  '{"favorecido_tipo":"corretor","favorecido_nome":"Corretor","documento":"529.982.247-25","pix":"x@y.co","emite_nf":false}')) LIKE '22023%parceria%',
  'locação sem parceria não recebe dados de pagamento');
SELECT pg_temp.ok((public.locacao_parceiro_pag_salvar(pg_temp.id('L'), '{"favorecido_tipo":"corretor","favorecido_nome":"Corretor Parceiro (fictício)",
  "documento":"529.982.247-25","pix":"parceiro@exemplo.com","telefone":"(15) 90000-0000","email":"parceiro@exemplo.com","emite_nf":false}')->>'novo')::boolean
  AND (pg_temp.pag('L')).documento = '52998224725', 'Financeiro grava pagamento ao corretor (CPF, só dígitos)');
SELECT pg_temp.ok(NOT (public.locacao_parceiro_pag_salvar(pg_temp.id('L'), '{"favorecido_tipo":"imobiliaria","favorecido_nome":"Imob Parceira Ltda (fictícia)",
  "documento":"11.222.333/0001-81","banco":"Banco Fictício","agencia":"0001","conta":"12345-6","emite_nf":true}')->>'novo')::boolean
  AND (pg_temp.pag('L')).favorecido_tipo = 'imobiliaria' AND (pg_temp.pag('L')).documento = '11222333000181' AND (pg_temp.pag('L')).pix IS NULL
  AND (pg_temp.pag('L')).emite_nf, 'troca para imobiliária (CNPJ) com banco/agência/conta');
SELECT pg_temp.put('pl', public.locacao_parceiro_pag_ler(pg_temp.id('L')));
SELECT pg_temp.ok((pg_temp.j('pl')->>'pode')::boolean AND pg_temp.j('pl')->'dados'->>'documento' = '11222333000181'
  AND pg_temp.j('pl')->'dados'->>'conta' = '12345-6', 'Financeiro lê os dados');
SELECT pg_temp.put('lista', public.locacao_parceiros_pagar());
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('lista')->'itens') = 1
  AND pg_temp.j('lista')->'itens'->0->>'parceria_lado' = 'captador'
  AND (pg_temp.j('lista')->'itens'->0->>'aluguel')::numeric = 3000
  AND (pg_temp.j('lista')->'itens'->0->>'valor_parceiro')::numeric = 1500
  AND pg_temp.j('lista')->'itens'->0->'pagamento'->>'documento' = '11222333000181'
  AND pg_temp.j('lista')->'config' IS NOT NULL, 'lista do Financeiro: aluguel 3000/taxa 10% paga parceiro 1500');
-- O cálculo novo não usa a tabela da comissão: também vale com taxa 8% ou 0% (sem administração).
SELECT pg_temp.ok(round(2200::numeric / 2, 2) = 1100 AND round(3000::numeric / 2, 2) = 1500,
  'regra do banco: aluguel 2200/taxa 8% = 1100; aluguel 3000/taxa 0% = 1500');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok((public.locacao_lancamento_salvar(pg_temp.id('L'), jsonb_build_object('aluguel', '2200', 'taxa_adm', '8',
  'parceria', 'externa', 'parceria_imobiliaria', 'Imob Parceira (fictícia)', 'parceria_corretor', 'Corretor Parceiro (fictício)',
  'parceria_creci', '12345-F', 'parceria_lado', 'captador'))->>'ok')::boolean, 'aluguel/taxa atualizados sem mudar parceiro');
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok((public.locacao_parceiros_pagar()->'itens'->0->>'valor_parceiro')::numeric = 1100
  AND (pg_temp.pag('L')).locacao_id IS NOT NULL, 'RPC: aluguel 2200/taxa 8% paga 1100 e preserva dados de pagamento');
SELECT pg_temp.ok(pg_temp.eventos('L') LIKE '%Dados de pagamento do parceiro registrados%'
  AND pg_temp.eventos('L') NOT LIKE '%11222333000181%' AND pg_temp.eventos('L') NOT LIKE '%52998224725%'
  AND pg_temp.eventos('L') NOT LIKE '%12345-6%' AND pg_temp.eventos('L') NOT LIKE '%parceiro@exemplo%',
  'histórico registra a ação sem documento, conta ou PIX');

-- 3) Quem NÃO vê: corretor dono, gestora, outra imobiliária --------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok((public.locacao_parceiro_pag_ler(pg_temp.id('L'))->>'pode')::boolean = false
  AND public.locacao_parceiro_pag_ler(pg_temp.id('L'))->'dados' IS NULL, 'corretor dono não vê dados de pagamento');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_parceiros_pagar()') LIKE '42501%', 'corretor não vê a lista');
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.locacao_parceiro_pagamento') LIKE '42501%', 'corretor não lê a tabela direto');
SELECT pg_temp.ok(NOT (public.locacao_detalhe(pg_temp.id('L'))::text ~ '11222333000181|12345-6|Banco Fictício')
  AND NOT (public.locacao_lista()::text ~ '11222333000181|12345-6|Banco Fictício'), 'detalhe e lista do corretor sem dados de pagamento');
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.ok((public.locacao_parceiro_pag_ler(pg_temp.id('L'))->>'pode')::boolean = false
  AND pg_temp.err('SELECT public.locacao_parceiros_pagar()') LIKE '42501%', 'gestora não vê');
-- a1 = Financeiro GLOBAL (app_role) + papel Contratos da locação: nenhum dos dois dá acesso.
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((public.locacao_parceiro_pag_ler(pg_temp.id('L'))->>'pode')::boolean = false
  AND pg_temp.err('SELECT public.locacao_parceiros_pagar()') LIKE '42501%'
  AND pg_temp.err(format('SELECT public.locacao_parceiro_pag_salvar(%L, %L)', pg_temp.id('L'),
      '{"favorecido_tipo":"corretor","favorecido_nome":"X","documento":"529.982.247-25","pix":"x@y.co","emite_nf":false}')) LIKE '42501%',
  'Financeiro global e papel Contratos não veem nem gravam');
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_parceiro_pag_ler(%L)', pg_temp.id('L'))) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.locacao_parceiro_pag_salvar(%L, %L)', pg_temp.id('L'),
      '{"favorecido_tipo":"corretor","favorecido_nome":"X","documento":"529.982.247-25","pix":"x@y.co","emite_nf":false}')) LIKE '42501%',
  'administrador de outra imobiliária não lê nem grava');
SELECT pg_temp.ok(jsonb_array_length(public.locacao_parceiros_pagar()->'itens') = 0, 'lista da outra imobiliária não traz a locação da A');
RESET ROLE;
SELECT pg_temp.as_user('');
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_parceiro_pag_ler(%L)', pg_temp.id('L'))) LIKE '42501%'
  AND pg_temp.err('SELECT public.locacao_parceiros_pagar()') LIKE '42501%', 'anônimo (link público) barrado');
RESET ROLE;

-- 4) Gestão (administrador) lê e grava; voltar para "sem parceria" apaga os dados -----------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok((public.locacao_parceiro_pag_ler(pg_temp.id('L'))->>'pode')::boolean
  AND jsonb_array_length(public.locacao_parceiros_pagar()->'itens') = 1, 'administrador (gestão) vê');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok((public.locacao_lancamento_salvar(pg_temp.id('L'), jsonb_build_object('aluguel', '3100', 'taxa_adm', '10',
  'parceria', 'externa', 'parceria_imobiliaria', 'Imob Parceira (fictícia)', 'parceria_corretor', 'Corretor Parceiro (fictício)',
  'parceria_creci', '12345-F', 'parceria_lado', 'captador'))->>'ok')::boolean
  AND (pg_temp.pag('L')).locacao_id IS NOT NULL, 'mudar só o aluguel mantém os dados de pagamento');
SELECT pg_temp.ok((public.locacao_lancamento_salvar(pg_temp.id('L'), jsonb_build_object('aluguel', '3100', 'taxa_adm', '10',
  'parceria', 'remax', 'parceria_unidade', 'RE/MAX Fictícia', 'parceria_corretor', 'Outra Pessoa', 'parceria_lado', 'captador'))->>'ok')::boolean
  AND (pg_temp.pag('L')).locacao_id IS NULL AND pg_temp.eventos('L') LIKE '%Dados de pagamento do parceiro removidos%',
  'trocar o parceiro apaga os dados antigos (não paga a pessoa errada) e registra no histórico');
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok((public.locacao_parceiro_pag_salvar(pg_temp.id('L'), '{"favorecido_tipo":"imobiliaria","favorecido_nome":"RE/MAX Fictícia",
  "documento":"12.abc.345/01de-35","pix":"chave-pix","emite_nf":true}')->>'ok')::boolean
  AND (pg_temp.pag('L')).documento = '12ABC34501DE35', 'CNPJ alfanumérico (Receita 07/2026) aceito e gravado em maiúsculas');
SELECT pg_temp.ok(NOT pg_temp.cnpj('12.ABC.345/01DE-34') AND NOT pg_temp.cnpj('12ABC34501DE3A'), 'CNPJ alfanumérico com dígito errado recusado');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok((public.locacao_lancamento_salvar(pg_temp.id('L'), '{"aluguel":"3000","taxa_adm":"10","parceria":"nenhuma"}')->>'ok')::boolean
  AND (pg_temp.pag('L')).locacao_id IS NULL, 'lançamento volta para sem parceria: dados de pagamento apagados');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
