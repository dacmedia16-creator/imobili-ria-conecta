-- Suíte da migration 20261109120000 (Proposta de compra 1/3, t_4cff61a6). Roda DENTRO de transação revertida
-- (run-proposta-compra.sh). Dados fictícios só na transação; nada fica gravado; nenhum WhatsApp é enviado.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0). Perfis: c2 (QA A Corretor Dois, captador da
-- captação de teste), gA (QA A Gestor, lidera c2), a1 (UE Corretor, outra equipe), adm (QA A Admin),
-- b1 (QA B Corretor Um), admB (QA B Admin).
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE tk(k text PRIMARY KEY, v text);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
GRANT ALL ON r, ids, tk, js TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
-- Chamada do servidor do ADM: service_role sem usuário (como o supabaseAdmin).
CREATE FUNCTION pg_temp.as_srv() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true),
         set_config('request.jwt.claim.sub', '', true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.t(_k text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM tk WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM js WHERE k = _k $$;
CREATE FUNCTION pg_temp.put(_k text, _v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO js VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.setid(_k text, _v uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.settk(_k text, _v text) RETURNS text LANGUAGE sql AS $$
  INSERT INTO tk VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
-- Parte da proposta pelo papel/ordem no JSON de detalhe.
CREATE FUNCTION pg_temp.parte(_det jsonb, _papel text, _ordem int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$
  SELECT (x->>'id')::uuid FROM jsonb_array_elements(_det->'partes') x
   WHERE x->>'papel' = _papel AND (x->>'ordem')::int = _ordem $$;
CREATE FUNCTION pg_temp.ip(_n int) RETURNS text LANGUAGE sql AS $$ SELECT md5('ip' || _n) || md5('x' || _n) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('gA', 'cab7391a-463f-4d97-b99b-ced6e4696796'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'), ('admB', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536'),
  ('cap', 'c0000000-0000-4000-8000-0000000000a1'), ('lead', '1e000000-0000-4000-8000-0000000000a1'),
  ('cli', '1c000000-0000-4000-8000-0000000000a1');

-- 0) Estrutura: módulo desligado, RLS e nada exposto ---------------------------------------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE module = 'proposta_compra'),
  'módulo nasce desligado em todas as imobiliárias (nenhuma linha)');
SELECT pg_temp.ok((SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('propostas_compra', 'proposta_partes', 'proposta_codigos', 'proposta_assinaturas', 'proposta_eventos',
                     'proposta_tentativas')) AND (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('propostas_compra', 'proposta_partes', 'proposta_codigos', 'proposta_assinaturas', 'proposta_eventos',
                     'proposta_tentativas')) = 6, 'as 6 tabelas novas com RLS ligada');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public'
   AND table_name IN ('propostas_compra', 'proposta_partes', 'proposta_codigos', 'proposta_assinaturas', 'proposta_eventos',
                      'proposta_tentativas') AND grantee IN ('anon', 'authenticated', 'PUBLIC')), 'nenhum grant a anon/authenticated');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname LIKE 'proposta%' AND has_function_privilege('anon', p.oid, 'EXECUTE')), 'nenhuma função proposta_* executável por anon');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname LIKE 'proposta%' AND p.prosecdef AND NOT coalesce('search_path=""' = ANY (p.proconfig), false)),
  'toda função SECURITY DEFINER com search_path vazio');
SELECT pg_temp.ok(NOT has_function_privilege('service_role', 'public.proposta_token(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.proposta_codigo_texto(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.proposta_codigo_texto(uuid)', 'EXECUTE'),
  'gerador de token/código não é chamável direto (nem service_role)');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.proposta_envio_dados(uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.proposta_envio_dados(uuid[])', 'EXECUTE'),
  'código em texto só pelo servidor do ADM (service_role)');
SELECT pg_temp.ok((SELECT count(*) FROM unnest(enum_range(NULL::public.sale_status))) = 17,
  'enum sale_status continua com os 17 status (nenhum status novo de venda)');
SELECT pg_temp.ok(pg_temp.err($$INSERT INTO public.propostas_compra (organization_id, capture_id, sinal_tipo)
  VALUES ('00000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000a1', 'penitenciais')$$) LIKE '23514%',
  'D7: sinal só arras confirmatórias (outro tipo é recusado pelo banco)');

-- Dados fictícios (só na transação): captação com 2 proprietários (1º casado), cliente + lead do CRM.
UPDATE public.exclusive_captures SET form_data = form_data || jsonb_build_object(
  'imovel', jsonb_build_object('tipo_imovel', 'Apartamento', 'endereco', 'Rua das Proposta Teste, 100',
     'complemento', 'apto 12', 'bairro', 'Jardim Teste', 'municipio', 'Sorocaba', 'estado', 'SP',
     'numero_matricula', '98.765', 'cartorio_registro', '1º CRI Sorocaba', 'classificacao_fiscal_iptu', '12.34.56',
     'valor_imovel', 'R$ 500.000,00', 'observacoes', 'OBS_INTERNA_CAPTACAO'),
  'proprietario_1', jsonb_build_object('nome_completo', 'Vendedor Um Teste', 'cpf', '111.222.333-44', 'rg', 'RGV1',
     'estado_civil', 'Casado(a)', 'telefone_1', '(15) 98888-1111', 'email', 'vend1@example.com', 'endereco_completo', 'END_V1'),
  'proprietario_2', jsonb_build_object('nome_completo', 'Vendedora Dois Teste', 'cpf', '555.666.777-88',
     'estado_civil', 'Solteira', 'telefone_1', '15988882222', 'email', 'vend2@example.com'))
 WHERE id = pg_temp.id('cap');
ALTER TABLE public.clientes DISABLE TRIGGER USER;
ALTER TABLE public.leads DISABLE TRIGGER USER;
INSERT INTO public.clientes (id, organization_id, tipo_pessoa, nome, cpf_cnpj, telefone, email)
VALUES (pg_temp.id('cli'), pg_temp.id('orgA'), 'fisica', 'Comprador Do Lead', '999.888.777-66', '15977773333', 'cli@example.com');
INSERT INTO public.leads (id, organization_id, nome, telefone, email, origem, etapa, responsavel_id, atribuido_em, aceito_em,
  cliente_id, funil, capture_id)
VALUES (pg_temp.id('lead'), pg_temp.id('orgA'), 'Comprador Do Lead', '15977773333', 'lead@example.com', 'manual',
  'em_atendimento', pg_temp.id('c2'), now(), now(), pg_temp.id('cli'), 'venda', pg_temp.id('cap'));
ALTER TABLE public.clientes ENABLE TRIGGER USER;
ALTER TABLE public.leads ENABLE TRIGGER USER;
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'leads', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;

-- 1) Desligado: nada funciona ----------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(public.proposta_compra_enabled() = false, 'desligado: proposta_compra_enabled() = false');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_criar(%L, NULL)', pg_temp.id('cap'))) LIKE '42501%',
  'desligado: criar proposta recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.proposta_pendencias()') IS NULL
  AND (SELECT count(*) FROM public.proposta_pendencias()) = 0, 'desligado: O que fazer hoje sem itens de proposta');
RESET ROLE;
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (pg_temp.id('orgA'), 'proposta_compra', true), (pg_temp.id('orgB'), 'proposta_compra', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;

-- 2) Criar: preenchimento automático da captação e do lead ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_criar(%L, NULL)', pg_temp.id('cap'))) LIKE '42501%',
  'corretor de outra equipe não cria proposta na captação');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_criar(%L, %L)', pg_temp.id('cap'), gen_random_uuid())) LIKE '42501%',
  'lead inexistente é recusado');
SELECT pg_temp.put('p1', public.proposta_criar(pg_temp.id('cap'), pg_temp.id('lead')));
SELECT pg_temp.setid('p1', (pg_temp.j('p1')->>'id')::uuid);
SELECT pg_temp.ok(pg_temp.j('p1')->>'situacao' = 'rascunho' AND (pg_temp.j('p1')->>'versao')::int = 1
  AND (pg_temp.j('p1')->>'validade_dias')::int = 5 AND pg_temp.j('p1')->>'sinal_tipo' = 'confirmatorias',
  'nasce rascunho, versão 1, validade padrão 5 dias (D9) e arras confirmatórias (D7)');
SELECT pg_temp.ok(pg_temp.j('p1')->'imovel'->>'endereco' = 'Rua das Proposta Teste, 100'
  AND pg_temp.j('p1')->'imovel'->>'matricula' = '98.765' AND pg_temp.j('p1')->'imovel'->>'cartorio' = '1º CRI Sorocaba'
  AND pg_temp.j('p1')->'imovel'->>'cidade' = 'Sorocaba' AND pg_temp.j('p1')->'imovel'->>'uf' = 'SP',
  'captação → imóvel, endereço, matrícula e cartório preenchidos');
SELECT pg_temp.ok(NOT (pg_temp.j('p1')->'imovel' ? 'observacoes'), 'observação interna da captação não entra na proposta');
SELECT pg_temp.ok((SELECT x->>'nome' = 'Vendedor Um Teste' AND x->>'cpf_cnpj' = '11122233344' AND x->>'estado_civil' = 'casado'
    AND x->>'telefone' = '15988881111' AND x->>'origem' = 'captacao'
  FROM jsonb_array_elements(pg_temp.j('p1')->'partes') x WHERE x->>'papel' = 'vendedor' AND x->>'ordem' = '1'),
  'captação → vendedor 1 (nome, CPF, estado civil, celular)');
SELECT pg_temp.ok((SELECT x->>'nome' = 'Vendedora Dois Teste' AND x->>'estado_civil' = 'solteiro'
  FROM jsonb_array_elements(pg_temp.j('p1')->'partes') x WHERE x->>'papel' = 'vendedor' AND x->>'ordem' = '2'),
  'captação → vendedor 2 (todos os proprietários)');
SELECT pg_temp.ok(pg_temp.parte(pg_temp.j('p1'), 'vendedor_conjuge', 1) IS NOT NULL
  AND pg_temp.parte(pg_temp.j('p1'), 'vendedor_conjuge', 2) IS NULL,
  'cônjuge obrigatório só para o vendedor casado');
SELECT pg_temp.ok((SELECT x->>'nome' = 'Comprador Do Lead' AND x->>'cpf_cnpj' = '99988877766' AND x->>'telefone' = '15977773333'
    AND x->>'email' = 'lead@example.com' AND x->>'origem' = 'lead'
  FROM jsonb_array_elements(pg_temp.j('p1')->'partes') x WHERE x->>'papel' = 'comprador'),
  'lead do CRM → comprador (nome, celular, e-mail do lead; CPF do cadastro do cliente)');
SELECT pg_temp.ok((SELECT x->>'origem' = 'perfil' AND x->>'telefone' IS NOT NULL
  FROM jsonb_array_elements(pg_temp.j('p1')->'partes') x WHERE x->>'papel' = 'corretor'),
  'corretor do negócio vem do perfil de quem criou');
SELECT pg_temp.ok(pg_temp.err('SELECT 1 FROM public.propostas_compra LIMIT 1') LIKE '42501%'
  AND pg_temp.err('SELECT 1 FROM public.proposta_codigos LIMIT 1') LIKE '42501%', 'tabelas sem acesso direto (authenticated)');
SELECT pg_temp.ok(jsonb_array_length(public.proposta_lista_captacao(pg_temp.id('cap'))) = 1
  AND public.proposta_lista_captacao(pg_temp.id('cap'))->0->>'comprador' = 'Comprador Do Lead',
  'aba Propostas da captação lista a proposta (comprador, situação)');

-- 3) Rascunho: pendências e salvar ------------------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_envio_preparar(%L)', pg_temp.id('p1'))) LIKE '22023%Falta preencher%',
  'rascunho incompleto não envia (lista o que falta)');
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT public.proposta_salvar(%L, '{"forma_pagamento":"permuta"}')$q$, pg_temp.id('p1'))) LIKE '23514%',
  'forma de pagamento fora da lista é recusada');
SELECT pg_temp.put('p1', public.proposta_salvar(pg_temp.id('p1'), jsonb_build_object(
  'valor_oferta', 480000, 'forma_pagamento', 'sinal_financiamento', 'sinal_valor', 48000, 'sinal_prazo_dias', 3,
  'financiamento_banco', 'Caixa', 'financiamento_valor', 384000, 'prazo_contrato_dias', 15, 'certidoes', 'vendedor_apresenta',
  'partes', jsonb_build_array(
    jsonb_build_object('papel', 'comprador', 'ordem', 1, 'nome', 'Comprador Do Lead', 'cpf_cnpj', '999.888.777-66',
                       'estado_civil', 'casado', 'telefone', '15977773333', 'email', 'lead@example.com'),
    jsonb_build_object('papel', 'comprador_conjuge', 'ordem', 1, 'nome', 'Conjuge Comprador', 'cpf_cnpj', '12312312312',
                       'telefone', '15977774444'),
    jsonb_build_object('papel', 'vendedor', 'ordem', 1, 'nome', 'Vendedor Um Teste', 'cpf_cnpj', '11122233344',
                       'estado_civil', 'casado', 'telefone', '15988881111'),
    jsonb_build_object('papel', 'vendedor_conjuge', 'ordem', 1, 'nome', 'Conjuge Vendedor', 'cpf_cnpj', '32132132132',
                       'telefone', '15988883333'),
    jsonb_build_object('papel', 'vendedor', 'ordem', 2, 'nome', 'Vendedora Dois Teste', 'cpf_cnpj', '55566677788',
                       'estado_civil', 'solteiro', 'telefone', '15988882222')))));
SELECT pg_temp.ok(pg_temp.j('p1')->'pendencias_envio' = '["PDF da proposta (gere a prévia)"]'::jsonb,
  'rascunho completo: só falta o PDF');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_registrar_pdf(%L, 99, %L)', pg_temp.id('p1'), repeat('a', 64))) LIKE '40001%',
  'PDF de outra versão é recusado');
SELECT pg_temp.put('p1', public.proposta_registrar_pdf(pg_temp.id('p1'), 1, repeat('a', 64)));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('p1')->'pendencias_envio') = 0, 'com PDF: pronto para enviar');

-- 4) Envio (sem WhatsApp: só gera os códigos) + lead na etapa Proposta ------------------------------------------------
SELECT pg_temp.put('e1', public.proposta_envio_preparar(pg_temp.id('p1')));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('e1')->'codigos') = 6,
  'enviar: 1 código por parte (comprador, cônjuge, 2 vendedores, cônjuge, corretor)');
SELECT pg_temp.ok(pg_temp.j('e1')::text !~ '"codigo"\s*:' AND NOT (pg_temp.j('e1')::text ~ 'token'),
  'resposta ao navegador do corretor não traz código nem token');
SELECT pg_temp.ok(pg_temp.j('e1')->>'situacao' = 'aguardando_assinaturas'
  AND (pg_temp.j('e1')->>'validade_ate')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date + 5,
  'aguardando assinaturas; validade = hoje + 5 dias corridos');
SELECT pg_temp.ok(coalesce((pg_temp.j('e1')->>'lead_movido')::boolean, false), 'lead movido pela função do CRM');
RESET ROLE;
SELECT pg_temp.ok((SELECT etapa FROM public.leads WHERE id = pg_temp.id('lead')) = 'proposta'
  AND EXISTS (SELECT 1 FROM public.lead_eventos WHERE lead_id = pg_temp.id('lead') AND tipo = 'etapa' AND para = 'proposta'),
  'lead na etapa "Proposta" que já existe, com evento no histórico do lead');
SELECT pg_temp.ok((SELECT bool_and(codigo_hash ~ '^[0-9a-f]{64}$') FROM public.proposta_codigos WHERE proposta_id = pg_temp.id('p1'))
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proposta_codigos'
                   AND column_name IN ('codigo', 'codigo_texto')),
  'banco guarda só o hash do código (nenhuma coluna com o código)');
SELECT pg_temp.ok((SELECT bool_and(token_hash ~ '^[0-9a-f]{64}$') FROM public.proposta_partes WHERE proposta_id = pg_temp.id('p1')),
  'banco guarda só o hash do token de cada parte');

-- Servidor do ADM (service_role, sem usuário no token) lê as mensagens a enviar (dry-run: nada sai daqui).
SELECT pg_temp.as_srv();
SET LOCAL ROLE service_role;
SELECT pg_temp.put('d1', public.proposta_envio_dados(ARRAY(SELECT (x->>'codigo_id')::uuid
  FROM jsonb_array_elements(pg_temp.j('e1')->'codigos') x)));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('d1')) = 6 AND (SELECT bool_and(x->>'codigo' ~ '^[0-9]{6}$'
   AND x->>'token' ~ '^[A-Za-z0-9_-]{43}$' AND x->>'imobiliaria' IS NOT NULL AND x->>'endereco' LIKE 'Rua das Proposta Teste%'
   AND x->>'corretor_telefone' ~ '^[0-9]{10,13}$') FROM jsonb_array_elements(pg_temp.j('d1')) x),
  'dados da mensagem: código de 6 dígitos, token, imobiliária, endereço e celular do corretor');
SELECT pg_temp.ok((SELECT count(DISTINCT x->>'token') = 6 AND count(DISTINCT x->>'codigo') >= 5
  FROM jsonb_array_elements(pg_temp.j('d1')) x), 'cada parte tem link próprio e código próprio');
SELECT pg_temp.settk(x->>'papel' || (x->>'ordem'), x->>'token'), pg_temp.settk('cod_' || (x->>'papel') || (x->>'ordem'), x->>'codigo')
  FROM jsonb_array_elements(pg_temp.j('d1')) x;
SELECT public.proposta_envio_resultado((x->>'codigo_id')::uuid, true) FROM jsonb_array_elements(pg_temp.j('d1')) x;
SELECT pg_temp.ok(jsonb_array_length(public.proposta_envio_dados(ARRAY(SELECT (x->>'codigo_id')::uuid
  FROM jsonb_array_elements(pg_temp.j('e1')->'codigos') x))) = 0, 'código já enviado não é lido de novo');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_detalhe(%L)', pg_temp.id('p1'))) LIKE '42501%',
  'service_role sem login não lê o detalhe interno');

-- 5) Página pública: só a proposta, só para quem tem o token ------------------------------------------------------------
SELECT pg_temp.put('l_comp', public.proposta_publica_ler(pg_temp.t('comprador1'), pg_temp.ip(1)));
SELECT pg_temp.ok((pg_temp.j('l_comp')->>'ok')::boolean AND pg_temp.j('l_comp')->'voce'->>'papel' = 'comprador'
  AND pg_temp.j('l_comp')->'valores'->>'oferta' = '480000.00' AND pg_temp.j('l_comp')->'valores'->>'sinal_tipo' = 'confirmatorias',
  'link do comprador abre a proposta inteira (valores, condições, imóvel)');
SELECT pg_temp.ok(pg_temp.j('l_comp')::text !~ '(11122233344|55566677788|12312312312|32132132132|99988877766|1598888|1597777|example\.com|OBS_INTERNA|RGV1|END_V1)',
  'link não mostra CPF, telefone ou e-mail de ninguém nem dado interno da captação');
SELECT pg_temp.ok(pg_temp.j('l_comp')->'voce'->>'documento_final' = '66' AND jsonb_array_length(pg_temp.j('l_comp')->'partes') = 6
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.j('l_comp')->'partes') x
                   WHERE x ?| ARRAY['cpf_cnpj', 'telefone', 'email', 'id']),
  'partes só com nome/papel/assinou; da própria parte só os 2 últimos dígitos do documento');
SELECT pg_temp.ok(NOT (pg_temp.j('l_comp') ?| ARRAY['capture_id', 'lead_id', 'corretor_id', 'pdf_hash', 'eventos', 'venda_id']),
  'sem ids internos, histórico ou venda no link');
SELECT pg_temp.ok(public.proposta_publica_ler(pg_temp.t('vendedor1'), pg_temp.ip(1))->'voce'->>'papel' = 'vendedor',
  'cada token abre como a própria parte');
SELECT pg_temp.ok(public.proposta_publica_ler(repeat('x', 43), pg_temp.ip(1))->>'erro' = 'indisponivel',
  'token inexistente: indisponível');
SELECT public.proposta_publica_ler(repeat('y', 43), pg_temp.ip(2)) FROM generate_series(1, 10);
SELECT pg_temp.ok(public.proposta_publica_ler(repeat('z', 43), pg_temp.ip(2))->>'erro' = 'limite',
  '10 tokens errados do mesmo IP em 15 min: limite');
SELECT pg_temp.ok((public.proposta_publica_ler(pg_temp.t('comprador1'), pg_temp.ip(2))->>'ok')::boolean,
  'token certo abre mesmo com o IP no limite');

-- 6) Código: errado, vencido, limite, reenviado -------------------------------------------------------------------------
SELECT pg_temp.settk('hash', pg_temp.j('l_comp')->>'conteudo_hash');
SELECT pg_temp.ok(public.proposta_publica_assinar(pg_temp.t('comprador1'), pg_temp.t('cod_comprador1'), pg_temp.t('hash'),
  false, '200.1.1.1', 'UA', pg_temp.ip(3))->>'erro' = 'aceite_obrigatorio', 'sem "Li e concordo" não assina');
SELECT pg_temp.ok(public.proposta_publica_assinar(pg_temp.t('comprador1'), pg_temp.t('cod_comprador1'), repeat('0', 64),
  true, '200.1.1.1', 'UA', pg_temp.ip(3))->>'erro' = 'versao_mudou', 'texto diferente do lido: não assina');
SELECT pg_temp.put('w1', public.proposta_publica_assinar(pg_temp.t('comprador1'),
  CASE WHEN pg_temp.t('cod_comprador1') = '000000' THEN '000001' ELSE '000000' END, pg_temp.t('hash'), true, '200.1.1.1', 'UA', pg_temp.ip(3)));
SELECT pg_temp.ok(pg_temp.j('w1')->>'erro' = 'codigo_errado' AND (pg_temp.j('w1')->>'restantes')::int = 4,
  'código errado: recusa e informa 4 tentativas restantes');
SELECT public.proposta_publica_assinar(pg_temp.t('comprador1'), 'abc', pg_temp.t('hash'), true, NULL, NULL, pg_temp.ip(3))
  FROM generate_series(1, 4);
SELECT pg_temp.ok(public.proposta_publica_assinar(pg_temp.t('comprador1'), pg_temp.t('cod_comprador1'), pg_temp.t('hash'),
  true, '200.1.1.1', 'UA', pg_temp.ip(3))->>'erro' = 'limite', 'depois de 5 erros: limite (nem o código certo vale)');
RESET ROLE;
SELECT pg_temp.ok((SELECT tentativas FROM public.proposta_codigos WHERE parte_id = pg_temp.parte(pg_temp.j('p1'), 'comprador')
   ORDER BY criado_em DESC LIMIT 1) = 5, 'tentativas gravadas no código (5)');
UPDATE public.proposta_codigos SET expira_em = now() - interval '1 minute'
 WHERE parte_id = pg_temp.parte(pg_temp.j('p1'), 'vendedor', 2) AND usado_em IS NULL AND invalidado_em IS NULL;
SELECT pg_temp.as_srv();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.proposta_publica_assinar(pg_temp.t('vendedor2'), pg_temp.t('cod_vendedor2'), pg_temp.t('hash'),
  true, '200.1.1.1', 'UA', pg_temp.ip(3))->>'erro' = 'codigo_vencido', 'código vencido: não assina');
RESET ROLE;
-- Reenvio (backdate: dentro da transação o relógio não anda).
UPDATE public.proposta_codigos SET criado_em = criado_em - interval '2 minutes' WHERE proposta_id = pg_temp.id('p1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('e2', public.proposta_envio_preparar(pg_temp.id('p1'),
  ARRAY[pg_temp.parte(pg_temp.j('p1'), 'comprador'), pg_temp.parte(pg_temp.j('p1'), 'vendedor', 2)]));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('e2')->'codigos') = 2, 'reenviar: código novo só para as partes escolhidas');
SELECT pg_temp.ok(jsonb_array_length(public.proposta_envio_preparar(pg_temp.id('p1'),
  ARRAY[pg_temp.parte(pg_temp.j('p1'), 'comprador')])->'aguarde') = 1, 'reenvio repetido em menos de 60 s: aguarde (sem disparo em massa)');
RESET ROLE;
SELECT pg_temp.as_srv();
SET LOCAL ROLE service_role;
SELECT pg_temp.put('d2', public.proposta_envio_dados(ARRAY(SELECT (x->>'codigo_id')::uuid
  FROM jsonb_array_elements(pg_temp.j('e2')->'codigos') x)));
SELECT pg_temp.settk('new_' || (x->>'papel') || (x->>'ordem'), x->>'codigo') FROM jsonb_array_elements(pg_temp.j('d2')) x;
SELECT pg_temp.ok((SELECT x->>'token' FROM jsonb_array_elements(pg_temp.j('d2')) x WHERE x->>'papel' = 'comprador') = pg_temp.t('comprador1'),
  'reenvio mantém o mesmo link da parte');
SELECT pg_temp.ok(pg_temp.t('cod_vendedor2') = pg_temp.t('new_vendedor2')
  OR public.proposta_publica_assinar(pg_temp.t('vendedor2'), pg_temp.t('cod_vendedor2'), pg_temp.t('hash'),
       true, '200.1.1.1', 'UA', pg_temp.ip(3))->>'erro' = 'codigo_errado', 'código anterior deixa de valer após o reenvio');
SELECT pg_temp.put('s_comp', public.proposta_publica_assinar(pg_temp.t('comprador1'), pg_temp.t('new_comprador1'), pg_temp.t('hash'),
  true, '200.1.1.1', 'Mozilla/5.0 (iPhone) Teste', pg_temp.ip(3)));
SELECT pg_temp.ok(pg_temp.j('s_comp')->>'resultado' = 'assinado' AND (pg_temp.j('s_comp')->>'faltam')::int = 5,
  'código reenviado certo: comprador assina (faltam 5)');
SELECT pg_temp.ok(public.proposta_publica_assinar(pg_temp.t('comprador1'), pg_temp.t('new_comprador1'), pg_temp.t('hash'),
  true, '200.1.1.1', 'UA', pg_temp.ip(3))->>'erro' = 'ja_assinado', 'não assina duas vezes');
RESET ROLE;
SELECT pg_temp.ok((SELECT a.nome = 'Comprador Do Lead' AND a.telefone = '15977773333' AND a.ip = '200.1.1.1'
    AND a.user_agent LIKE 'Mozilla%' AND a.pdf_hash = repeat('a', 64) AND a.conteudo_hash = pg_temp.t('hash')
    AND a.versao = 1 AND a.assinado_em IS NOT NULL
  FROM public.proposta_assinaturas a WHERE a.parte_id = pg_temp.parte(pg_temp.j('p1'), 'comprador') AND a.invalidada_em IS NULL),
  'assinatura registra nome, telefone, data/hora, IP, aparelho, hash do texto e hash do PDF');

-- 7) Texto alterado depois de assinar: nova versão invalida as assinaturas ----------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('p1', public.proposta_salvar(pg_temp.id('p1'), '{"observacoes":"Mesma coisa"}'::jsonb));
SELECT pg_temp.put('p1', public.proposta_salvar(pg_temp.id('p1'), '{"valor_oferta":470000}'::jsonb));
SELECT pg_temp.ok((pg_temp.j('p1')->>'versao')::int = 2 AND pg_temp.j('p1')->>'situacao' = 'rascunho'
  AND pg_temp.j('p1')->>'pdf_hash' IS NULL, 'valor mudou após assinatura: versão 2, volta a rascunho e pede PDF novo');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.j('p1')->'partes') x WHERE x->>'assinado_em' IS NOT NULL),
  'nenhuma assinatura vale na versão 2');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.j('p1')->'eventos') x WHERE x->>'tipo' = 'nova_versao'),
  'nova versão registrada no histórico');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.proposta_assinaturas WHERE proposta_id = pg_temp.id('p1')
   AND invalidada_em IS NOT NULL AND invalidada_motivo = 'nova_versao') = 1
  AND NOT EXISTS (SELECT 1 FROM public.proposta_codigos WHERE proposta_id = pg_temp.id('p1') AND usado_em IS NULL AND invalidado_em IS NULL),
  'assinatura antiga fica no histórico como invalidada; códigos em aberto morrem');
SELECT pg_temp.as_srv();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.proposta_publica_ler(pg_temp.t('comprador1'), pg_temp.ip(1))->>'erro' = 'indisponivel',
  'link fica indisponível enquanto a nova versão está em rascunho');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.proposta_registrar_pdf(pg_temp.id('p1'), 2, repeat('b', 64));
RESET ROLE;
UPDATE public.proposta_codigos SET criado_em = criado_em - interval '2 minutes' WHERE proposta_id = pg_temp.id('p1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.put('e3', public.proposta_envio_preparar(pg_temp.id('p1')));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('e3')->'codigos') = 6, 'versão 2 enviada: código novo para todas as partes');
RESET ROLE;
SELECT pg_temp.as_srv();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.proposta_publica_assinar(pg_temp.t('comprador1'), pg_temp.t('new_comprador1'), pg_temp.t('hash'),
  true, '200.1.1.1', 'UA', pg_temp.ip(3))->>'erro' = 'versao_mudou', 'quem leu a versão 1 não assina a versão 2');

-- 8) Todas as partes assinam a versão 2 → aceita ------------------------------------------------------------------------
SELECT pg_temp.put('d3', public.proposta_envio_dados(ARRAY(SELECT (x->>'codigo_id')::uuid
  FROM jsonb_array_elements(pg_temp.j('e3')->'codigos') x)));
SELECT pg_temp.settk('hash2', public.proposta_publica_ler(pg_temp.t('comprador1'), pg_temp.ip(1))->>'conteudo_hash');
SELECT pg_temp.ok(pg_temp.t('hash2') <> pg_temp.t('hash'), 'hash do texto mudou com a versão');
SELECT pg_temp.put('s_' || (x->>'papel') || (x->>'ordem'), public.proposta_publica_assinar(x->>'token', x->>'codigo',
  pg_temp.t('hash2'), true, '200.1.1.2', 'UA', pg_temp.ip(4)))
  FROM jsonb_array_elements(pg_temp.j('d3')) x WHERE x->>'papel' <> 'corretor';
SELECT pg_temp.ok((SELECT count(*) = 5 AND bool_and(v->>'resultado' = 'assinado') FROM js WHERE k IN ('s_comprador1', 's_comprador_conjuge1',
  's_vendedor1', 's_vendedor2', 's_vendedor_conjuge1')), '5 partes assinam a versão 2');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(public.proposta_detalhe(pg_temp.id('p1'))->>'situacao' = 'aguardando_assinaturas',
  'falta o corretor: continua aguardando (aceita só com todas as partes)');
SELECT pg_temp.ok((SELECT count(*) FROM public.proposta_pendencias() WHERE kind = 'proposta_falta_assinar'
  AND proposta_id = pg_temp.id('p1')) = 1, 'O que fazer hoje: parte que ainda não assinou');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_criar_venda(%L)', pg_temp.id('p1'))) LIKE '22023%',
  'sem aceite: não cria venda');
RESET ROLE;
SELECT pg_temp.as_srv();
SET LOCAL ROLE service_role;
SELECT pg_temp.put('s_corretor1', public.proposta_publica_assinar(x->>'token', x->>'codigo', pg_temp.t('hash2'), true,
  '200.1.1.3', 'UA', pg_temp.ip(4))) FROM jsonb_array_elements(pg_temp.j('d3')) x WHERE x->>'papel' = 'corretor';
SELECT pg_temp.ok(pg_temp.j('s_corretor1')->>'situacao' = 'aceita' AND (pg_temp.j('s_corretor1')->>'faltam')::int = 0,
  'última parte assina: proposta aceita');
SELECT pg_temp.ok(public.proposta_publica_ler(pg_temp.t('vendedor1'), pg_temp.ip(1))->>'situacao' = 'aceita',
  'link mostra a proposta aceita');
RESET ROLE;

-- 9) Venda em rascunho SÓ com o clique -----------------------------------------------------------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.sales WHERE exclusive_capture_id = pg_temp.id('cap')),
  'aceite sozinho não cria venda');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_criar_venda(%L)', pg_temp.id('p1'))) LIKE '42501%',
  'corretor de fora da equipe não cria a venda');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('v1', public.proposta_criar_venda(pg_temp.id('p1')));
SELECT pg_temp.setid('venda', (pg_temp.j('v1')->>'venda_id')::uuid);
SELECT pg_temp.ok((pg_temp.j('v1')->>'criada')::boolean AND pg_temp.id('venda') IS NOT NULL, 'clique: venda criada');
SELECT pg_temp.ok(NOT (public.proposta_criar_venda(pg_temp.id('p1'))->>'criada')::boolean
  AND public.proposta_criar_venda(pg_temp.id('p1'))->>'venda_id' = pg_temp.id('venda')::text, 'segundo clique não duplica');
RESET ROLE;
SELECT pg_temp.ok((SELECT s.status::text = 'rascunho' AND s.modalidade = 'padrao' AND s.valor_negociado = 470000
    AND s.exclusive_capture_id = pg_temp.id('cap') AND s.matricula LIKE '98.765%' AND s.organization_id = pg_temp.id('orgA')
  FROM public.sales s WHERE s.id = pg_temp.id('venda')), 'venda em rascunho (status existente) com imóvel, matrícula e valor');
SELECT pg_temp.ok((SELECT count(*) FROM public.sales WHERE exclusive_capture_id = pg_temp.id('cap')) = 1, 'uma venda só');
SELECT pg_temp.ok((SELECT p.nome = 'Comprador Do Lead' AND p.cpf_cnpj = '99988877766' AND p.conjuge_nome = 'Conjuge Comprador'
  FROM public.sale_parties p WHERE p.sale_id = pg_temp.id('venda') AND p.papel = 'comprador_1'),
  'sale_parties: comprador e cônjuge levados da proposta');
SELECT pg_temp.ok((SELECT string_agg(p.papel || '=' || p.nome, ',' ORDER BY p.papel) FROM public.sale_parties p
   WHERE p.sale_id = pg_temp.id('venda') AND p.papel LIKE 'vendedor%') = 'vendedor_1=Vendedor Um Teste,vendedor_2=Vendedora Dois Teste'
  AND (SELECT conjuge_nome FROM public.sale_parties WHERE sale_id = pg_temp.id('venda') AND papel = 'vendedor_1') = 'Conjuge Vendedor',
  'sale_parties: vendedores (e cônjuge) sem digitar de novo');
SELECT pg_temp.ok((SELECT sp.tipo_pagamento = 'financiamento' AND sp.entrada_valor = 48000 AND sp.financiamento_banco = 'Caixa'
    AND sp.financiamento_valor = 384000 AND sp.observacoes LIKE '%arras confirmatórias%'
  FROM public.sale_payment sp WHERE sp.sale_id = pg_temp.id('venda')), 'pagamento levado (sinal, banco e valor financiado)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.sale_status_history WHERE sale_id = pg_temp.id('venda')
   AND para::text <> 'rascunho'), 'nenhuma mudança de status da venda');
SELECT pg_temp.ok((SELECT etapa FROM public.leads WHERE id = pg_temp.id('lead')) = 'proposta', 'lead continua na etapa Proposta');

-- 10) Recusa, contraproposta e vencida ----------------------------------------------------------------------------------
DELETE FROM public.sales WHERE id = pg_temp.id('venda');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.setid('p2', (public.proposta_criar(pg_temp.id('cap'), NULL)->>'id')::uuid);
SELECT public.proposta_salvar(pg_temp.id('p2'), jsonb_build_object('valor_oferta', 400000, 'forma_pagamento', 'a_vista',
  'prazo_contrato_dias', 10, 'certidoes', 'dispensadas', 'partes', jsonb_build_array(
    jsonb_build_object('papel', 'comprador', 'nome', 'Empresa Compradora Ltda', 'tipo_pessoa', 'juridica',
                       'cpf_cnpj', '12.345.678/0001-90', 'telefone', '15966665555'),
    jsonb_build_object('papel', 'vendedor', 'ordem', 1, 'nome', 'Vendedor Um Teste', 'cpf_cnpj', '11122233344',
                       'estado_civil', 'solteiro', 'telefone', '15988881111'))));
SELECT pg_temp.ok(public.proposta_detalhe(pg_temp.id('p2'))->'pendencias_envio' = '["PDF da proposta (gere a prévia)"]'::jsonb,
  'comprador PJ (CNPJ) sem estado civil/cônjuge; vendedor solteiro sem cônjuge');
SELECT public.proposta_registrar_pdf(pg_temp.id('p2'), 1, repeat('c', 64));
SELECT public.proposta_envio_preparar(pg_temp.id('p2'));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_recusar(%L, %L)', pg_temp.id('p2'), '')) LIKE '22023%',
  'recusa exige motivo');
SELECT pg_temp.ok(public.proposta_recusar(pg_temp.id('p2'), 'Vendedor quer mais')->>'situacao' = 'recusada', 'recusada com motivo');
SELECT pg_temp.ok(public.proposta_detalhe(pg_temp.id('p2'))->>'recusa_motivo' = 'Vendedor quer mais', 'motivo guardado');
SELECT pg_temp.put('p3', public.proposta_contraproposta(pg_temp.id('p2')));
SELECT pg_temp.setid('p3', (pg_temp.j('p3')->>'id')::uuid);
SELECT pg_temp.ok(pg_temp.j('p3')->>'situacao' = 'rascunho' AND pg_temp.j('p3')->>'origem_id' = pg_temp.id('p2')::text
  AND (pg_temp.j('p3')->>'valor_oferta')::numeric = 400000 AND jsonb_array_length(pg_temp.j('p3')->'partes') = 3,
  'contraproposta: nova proposta já preenchida (valores e partes), em rascunho');
SELECT pg_temp.ok(public.proposta_detalhe(pg_temp.id('p2'))->>'situacao' = 'contraproposta', 'a anterior fica no histórico como contraproposta');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(public.proposta_lista_captacao(pg_temp.id('cap')))) = 3,
  'histórico da captação com as 3 propostas');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_contraproposta(%L)', pg_temp.id('p3'))) LIKE '22023%',
  'contraproposta de rascunho é recusada');
SELECT public.proposta_registrar_pdf(pg_temp.id('p3'), 1, repeat('d', 64));
SELECT public.proposta_envio_preparar(pg_temp.id('p3'));
RESET ROLE;
UPDATE public.propostas_compra SET validade_ate = (now() AT TIME ZONE 'America/Sao_Paulo')::date + 2 WHERE id = pg_temp.id('p3');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok((SELECT dias FROM public.proposta_pendencias() WHERE kind = 'proposta_vencendo' AND proposta_id = pg_temp.id('p3')) = 2,
  'O que fazer hoje: proposta vencendo em 2 dias');
RESET ROLE;
UPDATE public.propostas_compra SET validade_ate = (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1 WHERE id = pg_temp.id('p3');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(public.proposta_detalhe(pg_temp.id('p3'))->>'situacao' = 'vencida', 'vencida calculada pela validade (sem cron)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.proposta_pendencias() WHERE proposta_id = pg_temp.id('p3')),
  'vencida sai do O que fazer hoje');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_envio_preparar(%L)', pg_temp.id('p3'))) LIKE '22023%vencida%',
  'vencida não reenvia');
SELECT pg_temp.ok(public.proposta_contraproposta(pg_temp.id('p3'))->>'situacao' = 'rascunho', 'vencida aceita contraproposta');
RESET ROLE;
SELECT pg_temp.as_srv();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.proposta_publica_assinar(public.proposta_envio_dados(ARRAY[]::uuid[])->>0, '123456', 'x', true, NULL, NULL,
  pg_temp.ip(5))->>'ok' = 'false', 'assinar sem token válido: recusado');
RESET ROLE;
SELECT pg_temp.ok((SELECT string_agg(DISTINCT situacao, ',' ORDER BY situacao) FROM public.propostas_compra
   WHERE capture_id = pg_temp.id('cap')) = 'aceita,contraproposta,rascunho',
  'situações gravadas usadas: rascunho, aceita, contraproposta (recusada virou contraproposta; vencida é calculada)');

-- 11) Permissões e isolamento entre imobiliárias ------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('gA')::text);
SELECT pg_temp.ok(public.proposta_detalhe(pg_temp.id('p1'))->>'id' = pg_temp.id('p1')::text, 'gestor que lidera o captador vê a proposta');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(public.proposta_detalhe(pg_temp.id('p1'))->>'id' = pg_temp.id('p1')::text
  AND NOT (public.proposta_detalhe(pg_temp.id('p1'))->>'pode_operar')::boolean, 'admin da imobiliária vê (só leitura)');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_detalhe(%L)', pg_temp.id('p1'))) LIKE '42501%'
  AND jsonb_array_length(public.proposta_lista_captacao(pg_temp.id('cap'))) = 0, 'corretor de outra equipe não vê');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_detalhe(%L)', pg_temp.id('p1'))) LIKE '42501%', 'imobiliária B: corretor não vê proposta da A');
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.proposta_detalhe(%L)', pg_temp.id('p1'))) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.proposta_salvar(%L, %L)', pg_temp.id('p1'), '{}')) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.proposta_envio_preparar(%L)', pg_temp.id('p3'))) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.proposta_criar(%L, NULL)', pg_temp.id('cap'))) LIKE '42501%'
  AND jsonb_array_length(public.proposta_lista_captacao(pg_temp.id('cap'))) = 0,
  'imobiliária B: admin não lê, não edita, não envia nem cria na captação da A');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.err($$INSERT INTO public.propostas_compra (organization_id, capture_id)
  VALUES ('2a000000-0000-4000-8000-0000000000b0', 'c0000000-0000-4000-8000-0000000000a1')$$) LIKE '23503%',
  'FK composta: proposta da B não pode apontar para captação da A');

-- 12) Módulo desligado depois: link e assinatura param ------------------------------------------------------------------
UPDATE public.organization_modules SET enabled = false WHERE organization_id = pg_temp.id('orgA') AND module = 'proposta_compra';
SELECT pg_temp.as_srv();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.proposta_publica_ler(pg_temp.t('vendedor1'), pg_temp.ip(1))->>'erro' = 'indisponivel',
  'módulo desligado: link indisponível');
RESET ROLE;

-- Resultado -----------------------------------------------------------------------------------------------------------
SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
