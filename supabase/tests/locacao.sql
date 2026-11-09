-- Suíte da migration 20261110120000 (Módulo de Locação Fase 1, t_74426f94). Roda DENTRO de transação revertida
-- (run-locacao.sh). Dados fictícios só na transação; nada fica gravado; nada é enviado a ninguém.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0). Perfis: c2 (QA A Corretor Dois, corretor dono),
-- gA (QA A Gestor, lidera c2), adm (QA A Admin), ges (QA A Corretor Tres → papel gestora), con (QA A Dono
-- Plataforma → papel contratos), vis (QA A Corretor Um → papel vistoria), a1 (UE Corretor, sem papel), fin
-- (QA A Financeiro), b1 (QA B Corretor Um), admB (QA B Admin).
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
CREATE TEMP TABLE up(item text, n int, path text);
GRANT ALL ON r, ids, js, up TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM js WHERE k = _k $$;
CREATE FUNCTION pg_temp.put(_k text, _v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO js VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.setid(_k text, _v uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('gA', 'cab7391a-463f-4d97-b99b-ced6e4696796'),
  ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('ges', 'a742cfda-4731-4fa8-989a-374d2fdf0820'),
  ('con', 'b316b223-da46-4c2c-9952-25096d5ae5ff'), ('vis', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('fin', 'b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'), ('admB', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');

-- 0) Estrutura: módulo desligado, RLS, nada exposto ---------------------------------------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE module = 'locacao'),
  'módulo nasce desligado em todas as imobiliárias (nenhuma linha)');
SELECT pg_temp.ok((SELECT count(*) FILTER (WHERE c.relrowsecurity) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('locacao_config', 'locacao_papeis', 'locacoes', 'locacao_documentos', 'locacao_eventos')) = 5,
  'as 5 tabelas novas com RLS ligada');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public'
   AND table_name IN ('locacao_config', 'locacao_papeis', 'locacoes', 'locacao_documentos', 'locacao_eventos')
   AND grantee IN ('anon', 'authenticated', 'PUBLIC')), 'nenhum grant de tabela a anon/authenticated');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname LIKE 'locacao%' AND has_function_privilege('anon', p.oid, 'EXECUTE')), 'nenhuma função locacao_* executável por anon');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname LIKE 'locacao%' AND p.prosecdef AND NOT coalesce('search_path=""' = ANY (p.proconfig), false)),
  'toda função SECURITY DEFINER com search_path vazio');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_mover(uuid,text,boolean,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_pega(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_evento(public.locacoes,text,text)', 'EXECUTE'),
  'funções internas (mover etapa, histórico) não são chamáveis pelo navegador');
SELECT pg_temp.ok((SELECT NOT public FROM storage.buckets WHERE id = 'locacao-documentos'), 'bucket de documentos é privado');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
   AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%locacao-documentos%'),
  'nenhuma política de storage para o bucket (só URL assinada pelo servidor)');
SELECT pg_temp.ok((SELECT count(*) FROM unnest(enum_range(NULL::public.sale_status))) = 17,
  'venda intocada: enum sale_status segue com 17 status');

-- 1) Módulo desligado bloqueia tudo -------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(public.locacao_enabled() = false, 'desligado: locacao_enabled() = false');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_criar()') LIKE '42501%desligada%', 'desligado: criar locação é recusado');
RESET ROLE;
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true);

-- 2) Papéis: só administração atribui -------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(public.locacao_enabled(), 'ligado na Agência A: corretor vê o módulo');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_papel_definir(%L, ''gestora'', true)', pg_temp.id('c2'))) LIKE '42501%',
  'corretor não atribui papel de locação');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_config_salvar(''{"pct_coordenador":5}'')') LIKE '42501%',
  'corretor não altera as regras');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT public.locacao_papel_definir(pg_temp.id('ges'), 'gestora', true);
SELECT public.locacao_papel_definir(pg_temp.id('con'), 'contratos', true);
SELECT public.locacao_papel_definir(pg_temp.id('vis'), 'vistoria', true);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_papel_definir(%L, ''gestora'', true)', pg_temp.id('b1'))) LIKE '42501%',
  'admin não atribui papel a pessoa de outra imobiliária');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_papel_definir(%L, ''diretor'', true)', pg_temp.id('a1'))) LIKE '22023%',
  'papel inexistente é recusado');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(public.locacao_papeis_lista()) x
   WHERE jsonb_array_length(x->'papeis') > 0) = 3, 'admin atribuiu gestora, contratos e vistoria (3 pessoas)');
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.ok(public.locacao_contexto()->'papeis' = '["gestora"]'::jsonb, 'gestora vê o próprio papel no contexto');
SELECT pg_temp.ok((public.locacao_contexto()->'config'->>'pct_coordenador')::numeric = 10
  AND (public.locacao_contexto()->'config'->>'dia_pagamento_1a15')::int = 8
  AND public.locacao_contexto()->'config'->'tabela_taxa'->>'7' = '35'
  AND jsonb_array_length(public.locacao_contexto()->'config'->'documentos'->'fiador') = 4,
  'regras padrão da maquete (coord. 10%, dia 8, taxa 7% → 35%, docs sugeridos) sem configurar nada');

-- 3) Etapa 1: pré-análise ---------------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.setid('L', (public.locacao_criar()->>'id')::uuid);
RESET ROLE;
SELECT pg_temp.ok((SELECT etapa FROM public.locacoes WHERE id = pg_temp.id('L')) = 'pre_analise', 'nova locação nasce na pré-análise');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('L'))) LIKE '22023%Preencha%CPF%',
  'pré-análise incompleta não é enviada (lista o que falta)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('L'), '{"senha":"x"}')) LIKE '22023%',
  'campo fora da lista é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('L'), '{"aluguel":-5}')) LIKE '22023%',
  'aluguel negativo é recusado');
SELECT public.locacao_salvar_pre(pg_temp.id('L'), jsonb_build_object(
  'candidato', jsonb_build_object('cpf', '000.111.222-33', 'nome', 'João Exemplo da Silva (fictício)', 'nascimento', '1990-04-12',
    'telefone', '(15) 90000-0001', 'email', 'joao.exemplo@teste.invalid'),
  'endereco', 'Rua Fictícia, 100 — Ap 12, Sorocaba/SP', 'tipo', 'residencial', 'garantia', 'fiador',
  'aluguel', 2100, 'condominio', 300, 'iptu', 70, 'taxa_adm', 7, 'parceria', false));
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_detalhe(%L)', pg_temp.id('L'))) LIKE '42501%',
  'outro corretor (sem papel, outra equipe) não vê a locação');
SELECT pg_temp.ok(jsonb_array_length(public.locacao_lista()) = 0, 'lista do outro corretor vem vazia');
SELECT pg_temp.as_user(pg_temp.id('gA')::text);
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'id' = pg_temp.id('L')::text, 'gestor do corretor acompanha a locação');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_enviar_pre(pg_temp.id('L'));
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'aprovacao', 'pré-análise enviada → aprovação da gestora');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, ''{}'')', pg_temp.id('L'))) LIKE '22023%etapa%',
  'corretor não edita depois de enviar');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_gestora_decidir(%L, true, NULL)', pg_temp.id('L'))) LIKE '42501%',
  'corretor não aprova a própria pré-análise');

-- 4) Etapa 2: gestora — reprovar exige motivo e volta ao corretor ------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_gestora_decidir(%L, false, '' '')', pg_temp.id('L'))) LIKE '22023%motivo%',
  'reprovar sem motivo é bloqueado');
SELECT public.locacao_gestora_decidir(pg_temp.id('L'), false, 'Renda insuficiente para o valor (fictício)');
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->>'etapa' = 'pre_analise' AND (pg_temp.j('det')->>'devolvida')::boolean
  AND pg_temp.j('det')->>'motivo_devolucao' LIKE 'Renda%', 'reprovada volta ao corretor, marcada como devolvida e com o motivo');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.j('det')->'eventos') e
   WHERE e->>'descricao' LIKE 'Pré-análise REPROVADA%' AND e->>'papel' = 'gestora' AND e->>'ator_nome' IS NOT NULL),
  'histórico registra data, papel e pessoa da reprovação');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_salvar_pre(pg_temp.id('L'), '{"garantia":"fiador","aluguel":2100}');
SELECT public.locacao_enviar_pre(pg_temp.id('L'));
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT public.locacao_gestora_decidir(pg_temp.id('L'), true, NULL);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->>'etapa' = 'documentacao' AND NOT (pg_temp.j('det')->>'devolvida')::boolean,
  'reenviada e aprovada → documentação, sem marca de devolvida');

-- 5) Etapa 3: trava de documentos ------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('det')->'checklist') = 12 AND jsonb_array_length(pg_temp.j('det')->'faltando') = 12,
  'checklist do fiador: 4 locatário + 4 fiador + 4 proprietário = 12 itens, todos faltando');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)', pg_temp.id('L'))) LIKE '22023%Faltam 12%',
  'TRAVA: não envia à gestora com documento pendente');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_preparar(%L, ''Documento inventado'', ''pdf'')', pg_temp.id('L'))) LIKE '22023%',
  'item fora da lista da garantia é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_preparar(%L, ''CPF do locatário'', ''exe'')', pg_temp.id('L'))) LIKE '22023%',
  'tipo de arquivo não aceito é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_registrar(%L, ''CPF do locatário'', %L, ''x.pdf'')',
  pg_temp.id('L'), pg_temp.id('orgA')::text || '/' || pg_temp.id('L')::text || '/' || gen_random_uuid()::text || '.pdf')) LIKE '22023%não encontrado%',
  'registrar arquivo que não foi enviado ao storage é recusado');
INSERT INTO up (item, n) SELECT x, n FROM jsonb_array_elements_text(pg_temp.j('det')->'checklist') WITH ORDINALITY t(x, n);
UPDATE up SET path = public.locacao_documento_preparar(pg_temp.id('L'), item, 'pdf')->>'path';
SELECT pg_temp.ok((SELECT bool_and(path LIKE pg_temp.id('orgA')::text || '/' || pg_temp.id('L')::text || '/%.pdf') FROM up),
  'caminho do arquivo sai do banco já na pasta imobiliária/locação');
-- Simula o upload pela URL assinada (servidor/service_role grava o objeto).
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner) SELECT 'locacao-documentos', path, pg_temp.id('c2') FROM up;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_documento_registrar(pg_temp.id('L'), item, path, 'doc-ficticio-' || n || '.pdf') FROM up WHERE n <= 11;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)', pg_temp.id('L'))) LIKE '22023%Faltam 1 %',
  'TRAVA: com 11 de 12 ainda não envia');
SELECT public.locacao_documento_registrar(pg_temp.id('L'), item, path, 'doc-ficticio-' || n || '.pdf') FROM up WHERE n = 12;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_registrar(%L, %L, %L, ''y.pdf'')', pg_temp.id('L'),
  (SELECT item FROM up WHERE n = 1), (SELECT path FROM up WHERE n = 1))) LIKE '22023%já registrado%', 'mesmo arquivo não é registrado duas vezes');
SELECT pg_temp.put('doc1', public.locacao_detalhe(pg_temp.id('L'))->'documentos'->0);
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_ver(%L)', pg_temp.j('doc1')->>'id')) LIKE '42501%',
  'pessoa de outra imobiliária não abre documento');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_enviar_documentacao(pg_temp.id('L'));
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'conferencia', 'documentação completa → conferência da gestora');

-- 6) Etapa 4: conferência — devolver exige motivo; ok vai a contratos --------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.ok(public.locacao_documento_ver((pg_temp.j('doc1')->>'id')::uuid)->>'path' LIKE pg_temp.id('orgA')::text || '/%',
  'gestora abre o documento (caminho para URL assinada)');
SELECT public.locacao_gestora_decidir(pg_temp.id('L'), false, 'Matrícula do fiador ilegível (fictício)');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'documentacao', 'documentação devolvida ao corretor com motivo');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_documento_remover((SELECT (d->>'id')::uuid FROM jsonb_array_elements(public.locacao_detalhe(pg_temp.id('L'))->'documentos') d
   WHERE d->>'item' = (SELECT item FROM up WHERE n = 7)));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)', pg_temp.id('L'))) LIKE '22023%Faltam 1 %',
  'removido 1 documento: trava volta a valer');
UPDATE up SET path = public.locacao_documento_preparar(pg_temp.id('L'), item, 'pdf')->>'path' WHERE n = 7;
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner) SELECT 'locacao-documentos', path, pg_temp.id('c2') FROM up WHERE n = 7;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_documento_registrar(pg_temp.id('L'), item, path, 'matricula-nova.pdf') FROM up WHERE n = 7;
SELECT public.locacao_enviar_documentacao(pg_temp.id('L'));
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT public.locacao_gestora_decidir(pg_temp.id('L'), true, NULL);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->>'etapa' = 'minuta' AND pg_temp.j('det')->'minuta'->>'estado' = 'elaborando',
  'conferida → setor de contratos, minuta "elaborando"');

-- 7) Etapa 5: setor de contratos ---------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''enviar_minuta'')', pg_temp.id('L'))) LIKE '42501%',
  'gestora não age como setor de contratos');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''cobrar_pendencia'', ''{"texto":""}'')', pg_temp.id('L'))) LIKE '22023%',
  'cobrar pendência sem descrição é recusado');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'cobrar_pendencia', '{"texto":"Falta e-mail do proprietário (fictício)"}');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'minuta'->>'estado' = 'pendencia'
  AND public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'minuta', 'pendência cobrada sem devolver a locação (segue na minuta)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''preparar_assinatura'')', pg_temp.id('L'))) LIKE '22023%aprovada%',
  'não prepara assinatura com minuta não aprovada');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_corretor_minuta(pg_temp.id('L'), 'resolver_pendencia', 'E-mail informado (fictício)');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'enviar_minuta');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'minuta'->>'modelo' = 'Residencial — Fiador',
  'modelo da minuta = tipo do imóvel × garantia (Residencial — Fiador)');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_corretor_minuta(%L, ''pedir_ajuste'', '''')', pg_temp.id('L'))) LIKE '22023%',
  'pedir ajuste sem descrever é recusado');
SELECT public.locacao_corretor_minuta(pg_temp.id('L'), 'pedir_ajuste', 'Proprietário pediu cláusula de pintura (fictício)');
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->'minuta'->>'estado' = 'ajuste' AND pg_temp.j('det')->'minuta'->>'ajuste_data' IS NOT NULL,
  '"minuta em ajuste" com data registrada');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'enviar_minuta');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_corretor_minuta(pg_temp.id('L'), 'de_acordo');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'preparar_assinatura');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'assinatura', 'minuta aprovada → assinatura');

-- 8) Etapa 6: assinatura (registro manual dos envelopes) ---------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''marcar_assinado'', ''{"documento":"adm"}'')', pg_temp.id('L'))) LIKE '22023%',
  'não marca assinado antes de registrar o envio');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'registrar_envio', '{"vist_junto":false}');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'assinatura'->>'adm' = 'pendente'
  AND public.locacao_detalhe(pg_temp.id('L'))->'assinatura'->>'vist' = 'nao'
  AND public.locacao_detalhe(pg_temp.id('L'))->'assinatura'->>'modo' = 'manual',
  'envio registrado: 2 envelopes pendentes, vistoria vai depois, modo manual');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'marcar_assinado', '{"documento":"adm"}');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'assinatura', 'só o contrato de administração assinado: segue em assinatura');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'marcar_assinado', '{"documento":"loc"}');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'pos_assinatura', 'os 2 contratos assinados → pós-assinatura');

-- 9) Etapas 7–8: pós-assinatura e chaves --------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pos_acao(%L, ''vistoria_pedida'')', pg_temp.id('L'))) LIKE '42501%',
  'corretor não registra vistoria (é do responsável vistoria/seguro)');
SELECT public.locacao_protocolo(pg_temp.id('L'), 'cpfl', 'CPFL-FICT-123');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'pos'->'tit'->'cpfl'->>'protocolo' = 'CPFL-FICT-123',
  'corretor envia protocolo da CPFL');
SELECT pg_temp.as_user(pg_temp.id('vis')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pos_acao(%L, ''laudo_assinado'')', pg_temp.id('L'))) LIKE '22023%pedido de vistoria%',
  'laudo só depois de pedir a vistoria');
SELECT public.locacao_pos_acao(pg_temp.id('L'), 'vistoria_pedida');
SELECT public.locacao_pos_acao(pg_temp.id('L'), 'seguro', '{"apolice":"APL-FICT-001"}');
SELECT public.locacao_pos_acao(pg_temp.id('L'), 'condominio_aviso');
SELECT public.locacao_pos_acao(pg_temp.id('L'), 'mudanca', '{"data":"2026-11-20"}');
SELECT public.locacao_pos_acao(pg_temp.id('L'), 'contestacao');
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->'pos'->>'apolice' = 'APL-FICT-001' AND pg_temp.j('det')->'pos'->>'mudanca' = '2026-11-20'
  AND pg_temp.j('det')->'pos'->>'contestacao_em' IS NOT NULL AND pg_temp.j('det')->'pos'->>'condominio_aviso' IS NOT NULL,
  'vistoria, seguro, condomínio, mudança e contestação registrados com data');
SELECT public.locacao_pos_acao(pg_temp.id('L'), 'pronto_para_chaves');
-- Regra a confirmar: chave antes do laudo. Bloqueada quando configurado; permitida com alerta no padrão.
RESET ROLE;
INSERT INTO public.locacao_config (organization_id, chave_antes_do_laudo) VALUES (pg_temp.id('orgA'), false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('vis')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pos_acao(%L, ''entregar_chaves'')', pg_temp.id('L'))) LIKE '22023%bloqueada%',
  'regra configurável: chave antes do laudo bloqueada quando a imobiliária desliga');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT public.locacao_config_salvar('{"chave_antes_do_laudo":true}');
SELECT pg_temp.as_user(pg_temp.id('vis')::text);
SELECT pg_temp.put('ch', public.locacao_pos_acao(pg_temp.id('L'), 'entregar_chaves',
  jsonb_build_object('data', ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text)));
SELECT pg_temp.ok((pg_temp.j('ch')->>'alerta')::boolean AND pg_temp.j('ch')->>'etapa' = 'comissao',
  'padrão: chave sem laudo é permitida COM ALERTA e vai para comissão');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'chave_em' = ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text,
  'data de entrega das chaves registrada');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_protocolo(pg_temp.id('L'), 'saae', 'SAAE-FICT-456');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'pos'->'tit'->'saae'->>'protocolo' = 'SAAE-FICT-456',
  'protocolo pode ser enviado mesmo já na comissão (titularidade não bloqueia)');

-- 10) Seguro obrigatório configurável (2ª locação, atalho de minuta de outra RE/MAX + vistoria junto) ----------------
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT public.locacao_config_salvar('{"seguro_incendio_obrigatorio":true}');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_config_salvar(''{"dia_pagamento_1a15":40}'')') LIKE '22023%',
  'dia de pagamento fora de 1–28 é recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_config_salvar(''{"documentos":{"outro":["x"]}}'')') LIKE '22023%',
  'lista de documentos com garantia desconhecida é recusada');
RESET ROLE;
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, minuta)
VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'minuta', 'Rua Teste, 77 (fictícia)', 3500, 'caucao', 'comercial',
        '{"estado":"elaborando","externa":false}') RETURNING pg_temp.setid('L2', id);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT public.locacao_contratos_acao(pg_temp.id('L2'), 'minuta_externa', '{"externa":true}');
SELECT public.locacao_contratos_acao(pg_temp.id('L2'), 'preparar_assinatura');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L2'))->>'etapa' = 'assinatura',
  'atalho: minuta pronta de outra RE/MAX pula a aprovação (admin age como contratos)');
SELECT public.locacao_contratos_acao(pg_temp.id('L2'), 'registrar_envio', '{"vist_junto":true}');
SELECT public.locacao_contratos_acao(pg_temp.id('L2'), 'marcar_assinado', '{"documento":"vist"}');
SELECT public.locacao_contratos_acao(pg_temp.id('L2'), 'marcar_assinado', '{"documento":"adm"}');
SELECT public.locacao_contratos_acao(pg_temp.id('L2'), 'marcar_assinado', '{"documento":"loc"}');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L2'))->'pos'->>'laudo_em' IS NOT NULL
  AND public.locacao_detalhe(pg_temp.id('L2'))->>'etapa' = 'pos_assinatura', 'vistoria junto (3º documento) já registra o laudo');
SELECT pg_temp.as_user(pg_temp.id('vis')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pos_acao(%L, ''pronto_para_chaves'')', pg_temp.id('L2'))) LIKE '22023%Seguro%',
  'regra configurável: seguro incêndio obrigatório trava a ida às chaves');

-- 11) Isolamento entre imobiliárias -----------------------------------------------------------------------------
RESET ROLE;
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgB'), 'locacao', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_lista()) = 0, 'isolamento: admin da Agência B (módulo ligado) não vê locações da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_detalhe(%L)', pg_temp.id('L'))) LIKE '42501%', 'isolamento: detalhe da A negado para B');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_gestora_decidir(%L, true, NULL)', pg_temp.id('L2'))) LIKE '42501%',
  'isolamento: B não age em locação da A');
SELECT pg_temp.ok(public.locacao_contexto()->'config'->>'seguro_incendio_obrigatorio' = 'false',
  'regras são por imobiliária: B continua com o padrão');
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.locacoes') LIKE '42501%', 'tabela direta: permission denied');

-- 12) Visão geral e comissão (leitura) --------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_lista()) = 2 AND (public.locacao_contexto()->>'ve_comissao')::boolean,
  'financeiro vê as locações e a comissão da imobiliária');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(NOT (public.locacao_contexto()->>'ve_comissao')::boolean, 'corretor não vê a tela de comissão de todos');
SELECT pg_temp.ok((SELECT bool_and(x ? 'etapa_desde' AND x ? 'corretor_nome' AND x ? 'codigo') FROM jsonb_array_elements(public.locacao_lista()) x),
  'lista traz etapa_desde (tempo parado), corretor e código LOC-xxxx');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(public.locacao_detalhe(pg_temp.id('L'))->'eventos')) >= 25,
  'histórico completo da 1ª locação (≥ 25 passos com data e responsável)');
RESET ROLE;

-- Resultado -----------------------------------------------------------------------------------------------------------
SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
