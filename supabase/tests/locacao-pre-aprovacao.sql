-- Suíte da migration 20261124130000 (pré-aprovação por garantia + link do cliente, t_b2ce1207). Roda DENTRO de
-- transação revertida (run-locacao-pre-aprovacao.sh). Dados fictícios só na transação; nada é enviado a ninguém.
-- Homologação: A = Agência A (…-0001, módulo Locação ligado), B = Agência B (2a…b0). c2 = QA A Corretor Dois (dono),
-- ges = QA A Corretor Tres (papel gestora), adm = QA A Admin, b1 = QA B Corretor Um.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE toks(k text PRIMARY KEY, t text);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
GRANT ALL ON r, ids, toks, js TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.t(_k text) RETURNS text LANGUAGE sql AS $$ SELECT t FROM toks WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM js WHERE k = _k $$;
CREATE FUNCTION pg_temp.put(_k text, _v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO js VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.ip(_c text) RETURNS text LANGUAGE sql AS $$ SELECT repeat(_c, 64) $$;
-- Dados mínimos da pré-aprovação (imóvel + locatário) para uma garantia; _extra entra por cima.
CREATE FUNCTION pg_temp.pre(_g text, _cand jsonb DEFAULT NULL, _ficha jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('garantia', _g, 'endereco', 'Rua Exemplo, 120 · Sorocaba', 'aluguel', 2500, 'condominio', 420,
    'iptu', 95, 'ficha', jsonb_build_object('cep', '18035-120') || _ficha,
    'candidato', coalesce(_cand, jsonb_build_object('cpf', '529.982.247-25', 'nome', 'Ana Exemplo Fictícia',
      'nascimento', '1990-04-12', 'telefone', '(15) 90000-0000', 'email', 'ana@exemplo.invalid'))) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('ges', 'a742cfda-4731-4fa8-989a-374d2fdf0820'),
  ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244');
INSERT INTO ids SELECT k, gen_random_uuid() FROM unnest(ARRAY['SEG','CAU','FIA','LOFT','OUT','TROCA','CLI','CLI2','CLIF','B']) k;
INSERT INTO public.locacoes(id, organization_id, corretor_id, garantia)
  SELECT pg_temp.id(k), pg_temp.id('orgA'), pg_temp.id('c2'), 'seguro_fianca'
    FROM unnest(ARRAY['SEG','CAU','FIA','LOFT','OUT','TROCA','CLI','CLI2','CLIF']) k;
INSERT INTO public.locacoes(id, organization_id, corretor_id, garantia) VALUES (pg_temp.id('B'), pg_temp.id('orgB'), pg_temp.id('b1'), 'fiador');

-- 0) Estrutura ------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relrowsecurity
   AND relname IN ('locacao_pre_modos', 'locacao_pre_links', 'locacao_pre_link_arquivos')) = 3, 'RLS nas 3 tabelas novas');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public'
   AND table_name LIKE 'locacao_pre%' AND grantee IN ('anon', 'authenticated', 'PUBLIC')), 'nenhum grant de tabela ao navegador');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.locacao_pre_link_ler(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_pre_link_ler(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_pre_link_enviar(text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.locacao_pre_link_enviar(text,text)', 'EXECUTE'),
  'link público só pela server function (service_role)');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_pre_faltando(public.locacoes)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.locacao_pre_links_emitir(uuid,text)', 'EXECUTE'), 'regras internas fechadas');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname LIKE 'locacao_pre%' AND p.prosecdef AND NOT coalesce('search_path=""' = ANY (p.proconfig), false)),
  'SECURITY DEFINER com search_path vazio');
SELECT pg_temp.ok(public.locacao_cpf_ok('529.982.247-25') AND public.locacao_cpf_ok('11144477735')
  AND NOT public.locacao_cpf_ok('000.111.222-33') AND NOT public.locacao_cpf_ok('111.111.111-11')
  AND NOT public.locacao_cpf_ok('529.982.247'), 'CPF validado pelos dígitos');
SELECT pg_temp.ok(public.locacao_renda_ok('7800.00') AND NOT public.locacao_renda_ok('0') AND NOT public.locacao_renda_ok('7.800,00'),
  'renda em reais (número > 0)');

-- 1) Isolamento multiempresa ---------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('SEG'), pg_temp.pre('seguro_fianca'))) LIKE '42501%',
  'B não salva pré-aprovação da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('SEG'))) LIKE '42501%', 'B não envia a pré-aprovação da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pre_links_modo(%L, ''cliente'')', pg_temp.id('CLI'))) LIKE '42501%',
  'B não muda o modo da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pre_links_lista(%L)', pg_temp.id('CLI'))) LIKE '42501%', 'B não lê os links da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pre_links_emitir(%L, ''locatario'')', pg_temp.id('CLI'))) LIKE '42501%',
  'B não gera link na A');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pre_links_modo(%L, ''cliente'')', pg_temp.id('B'))) LIKE '42501%',
  'A não muda o modo da B');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('B'))) LIKE '42501%', 'A não envia a pré-aprovação da B');

-- 2) Modo "Eu preencho": obrigatórios por garantia, somente dados ---------------------------------------------------------
SELECT public.locacao_salvar_pre(pg_temp.id('SEG'), pg_temp.pre('seguro_fianca',
  '{"cpf":"000.111.222-33","nome":"Ana Exemplo Fictícia","nascimento":"1990-04-12","telefone":"(15) 90000-0000","email":"ana@exemplo.invalid"}'));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('SEG'))) LIKE '22023%Preencha: CPF do locatário',
  'seguro: CPF com dígito errado barra o envio');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('SEG'),
  pg_temp.pre('caucao', '{"renda":"abc"}'))) LIKE '22023%', 'renda que não é valor em R$ é recusada');
SELECT public.locacao_salvar_pre(pg_temp.id('SEG'), jsonb_build_object('ficha', '{}'::jsonb, 'endereco', null));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('SEG'))) LIKE '22023%Preencha: CEP, endereço do imóvel, CPF do locatário',
  'imóvel: CEP e endereço obrigatórios em todas as garantias');
SELECT public.locacao_salvar_pre(pg_temp.id('SEG'), pg_temp.pre('seguro_fianca'));
SELECT pg_temp.ok(public.locacao_enviar_pre(pg_temp.id('SEG'))->>'etapa' = 'aprovacao',
  'seguro-fiança: só imóvel + locatário (sem ID do imóvel, metragem, proprietário, captador nem anexo)');

SELECT public.locacao_salvar_pre(pg_temp.id('CAU'), pg_temp.pre('caucao'));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('CAU'))) LIKE '22023%Preencha: renda do locatário',
  'caução: exige a renda do locatário');
SELECT public.locacao_salvar_pre(pg_temp.id('CAU'), jsonb_build_object('candidato', pg_temp.pre('caucao')->'candidato' || '{"renda":"7800.00"}'));
SELECT pg_temp.ok(public.locacao_enviar_pre(pg_temp.id('CAU'))->>'etapa' = 'aprovacao', 'caução: com renda, envia');

SELECT public.locacao_salvar_pre(pg_temp.id('FIA'), pg_temp.pre('fiador', NULL, '{}'));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('FIA')))
  LIKE '22023%Preencha: renda do locatário, nome completo do fiador, CPF do fiador, renda do fiador, nº da matrícula do imóvel do fiador',
  'fiador: exige renda do locatário e nome, CPF, renda e matrícula do fiador');
SELECT public.locacao_salvar_pre(pg_temp.id('FIA'), pg_temp.pre('fiador',
  pg_temp.pre('fiador')->'candidato' || '{"renda":"7800.00"}',
  '{"fiador":{"nome":"Bruno Exemplo Fictício","cpf":"111.444.777-35","renda":"12000.00"}}'));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('FIA')))
  LIKE '22023%Preencha: nº da matrícula do imóvel do fiador', 'fiador: número da matrícula é obrigatório');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('FIA'),
  jsonb_build_object('ficha', '{"fiador":{"renda":"doze mil"}}'::jsonb))) LIKE '22023%', 'renda do fiador inválida é recusada');
-- Anexo da matrícula: opcional, só esse item na pré-aprovação.
SELECT pg_temp.ok(public.locacao_documento_preparar(pg_temp.id('FIA'), 'Matrícula do imóvel do fiador (quitado)', 'pdf') ? 'path',
  'fiador: anexo da matrícula liberado na pré-aprovação');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_preparar(%L, ''RG/CNH do locatário'', ''pdf'')', pg_temp.id('FIA'))) LIKE '22023%',
  'outros documentos continuam só depois da aprovação');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_preparar(%L, ''Matrícula do imóvel do fiador (quitado)'', ''pdf'')', pg_temp.id('CAU'))) LIKE '22023%',
  'sem fiador, não há anexo na pré-aprovação');
SELECT public.locacao_salvar_pre(pg_temp.id('FIA'), jsonb_build_object('ficha',
  '{"cep":"18035-120","fiador":{"nome":"Bruno Exemplo Fictício","cpf":"111.444.777-35","renda":"12000.00","matricula":"45678"}}'::jsonb));
SELECT pg_temp.ok(public.locacao_enviar_pre(pg_temp.id('FIA'))->>'etapa' = 'aprovacao', 'fiador: completo e SEM anexo, envia');

SELECT public.locacao_salvar_pre(pg_temp.id('LOFT'), pg_temp.pre('loft', NULL, '{"garantia_outra":"Aprovação Loft nº 123 (fictício)"}'));
SELECT pg_temp.ok(public.locacao_enviar_pre(pg_temp.id('LOFT'))->>'etapa' = 'aprovacao', 'Loft: igual seguro-fiança + observação livre');
SELECT public.locacao_salvar_pre(pg_temp.id('OUT'), pg_temp.pre('outras'));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('OUT'))) LIKE '22023%Preencha: observação da garantia',
  'caucionamento/outras: pede a observação (qual garantia)');
SELECT public.locacao_salvar_pre(pg_temp.id('OUT'), jsonb_build_object('ficha', '{"cep":"18035-120","garantia_outra":"Caucionamento de imóvel"}'::jsonb));
SELECT pg_temp.ok(public.locacao_enviar_pre(pg_temp.id('OUT'))->>'etapa' = 'aprovacao', 'caucionamento/outras: com observação, envia');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, ''{"garantia":"boleto"}'')', pg_temp.id('TROCA'))) LIKE '22023%',
  'garantia fora da lista é recusada');

-- Troca de garantia reajusta os obrigatórios.
SELECT public.locacao_salvar_pre(pg_temp.id('TROCA'), pg_temp.pre('seguro_fianca'));
SELECT public.locacao_salvar_pre(pg_temp.id('TROCA'), '{"garantia":"fiador"}');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('TROCA'))) LIKE '22023%renda do locatário, nome completo do fiador%',
  'troca seguro → fiador: passam a valer os campos do fiador');
SELECT public.locacao_salvar_pre(pg_temp.id('TROCA'), '{"garantia":"titulo_capitalizacao"}');
SELECT pg_temp.ok(public.locacao_enviar_pre(pg_temp.id('TROCA'))->>'etapa' = 'aprovacao', 'troca fiador → título: volta ao conjunto do seguro');

-- 3) Depois da aprovação: a Documentação cobra os documentos completos; esteira aceita as garantias novas --------------
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT public.locacao_gestora_decidir(pg_temp.id(k), true, NULL) FROM unnest(ARRAY['SEG', 'FIA', 'LOFT']) k;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('seg', public.locacao_detalhe(pg_temp.id('SEG')));
SELECT pg_temp.put('fia', public.locacao_detalhe(pg_temp.id('FIA')));
SELECT pg_temp.put('loft', public.locacao_detalhe(pg_temp.id('LOFT')));
SELECT pg_temp.ok(pg_temp.j('seg')->>'etapa' = 'documentacao' AND jsonb_array_length(pg_temp.j('seg')->'faltando') > 0,
  'aprovada: os documentos completos são cobrados só agora');
SELECT pg_temp.ok(pg_temp.j('loft')->'partes'->1->>'rotulo' = 'Garantia — Loft (antiga CredPago)'
  AND jsonb_array_length(pg_temp.j('loft')->'partes') = 3, 'checklist mostra a garantia Loft');
SELECT pg_temp.ok((pg_temp.j('fia')->'faltando' ? 'Matrícula do imóvel do fiador (quitado)')
  AND (pg_temp.j('fia')->'faltando') @> '["RG/CNH do fiador"]', 'fiador sem anexo: a matrícula fica pedida na Documentação');
SELECT pg_temp.ok(public.locacao_documento_preparar(pg_temp.id('SEG'), 'RG/CNH do locatário', 'pdf') ? 'path',
  'Documentação aceita os itens normais depois da aprovação');
RESET ROLE;
SELECT pg_temp.ok(public.locacao_garantia_rotulo('titulo_capitalizacao') = 'Título de capitalização'
  AND public.locacao_garantia_rotulo('outras') = 'Caucionamento / outras', 'nome das garantias novas para a minuta');
SELECT pg_temp.ok(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'locacao_contratos_garantia_check')) LIKE '%loft%titulo_capitalizacao%outras%',
  'contrato financeiro aceita as garantias novas');
-- A tela de Regras envia TODAS as listas juntas (salvar substitui o conjunto): o teste faz igual.
SELECT pg_temp.put('docs', public.locacao_docs_padrao() || '{"loft":["Aprovação da Loft"]}');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok((public.locacao_config_salvar(jsonb_build_object('documentos', pg_temp.j('docs')))->'documentos'->'loft'->>0) = 'Aprovação da Loft',
  'Regras: a gestão define a lista de documentos da Loft');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('LOFT'))->'faltando' ? 'Aprovação da Loft', 'lista da Loft entra no checklist');

-- 4) Modo "Cliente preenche" na pré-aprovação ----------------------------------------------------------------------------
SELECT public.locacao_salvar_pre(pg_temp.id('CLI'), pg_temp.pre('caucao', '{"nome":"Nome Digitado Pelo Corretor"}'));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pre_links_emitir(%L, ''locatario'')', pg_temp.id('CLI'))) LIKE '22023%',
  'sem o modo cliente não gera link');
SELECT public.locacao_pre_links_modo(pg_temp.id('CLI'), 'cliente');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pre_links_emitir(%L, ''fiador'')', pg_temp.id('CLI'))) LIKE '22023%',
  'caução: não existe link de fiador');
INSERT INTO toks SELECT 'loc', public.locacao_pre_links_emitir(pg_temp.id('CLI'), 'locatario')->>'token';
RESET ROLE;
SELECT pg_temp.ok((SELECT token_hash <> pg_temp.t('loc') AND token_hash = encode(extensions.digest(pg_temp.t('loc'), 'sha256'), 'hex')
  AND expira_em BETWEEN now() + interval '6 days 23 hours' AND now() + interval '7 days 1 minute'
  FROM public.locacao_pre_links WHERE locacao_id = pg_temp.id('CLI')), 'só o hash é salvo; vale 7 dias');
SET LOCAL ROLE service_role;
SELECT pg_temp.put('ler', public.locacao_pre_link_ler(pg_temp.t('loc'), pg_temp.ip('1')));
SELECT pg_temp.ok((pg_temp.j('ler')->>'ok')::boolean AND pg_temp.j('ler')->>'parte' = 'locatario'
  AND (pg_temp.j('ler')->>'pede_renda')::boolean, 'cliente abre só a parte do locatário (caução pede renda)');
SELECT pg_temp.ok(NOT (pg_temp.j('ler')::text ~ '(aluguel|condominio|iptu|endereco|taxa|2500|Nome Digitado|captador|proprietario)'),
  'cliente não vê valores da negociação, o imóvel nem o que o corretor digitou');
-- Escopos separados: o token da pré-aprovação não abre a Documentação (tabela do PR #316) e vice-versa.
SELECT pg_temp.ok(NOT (public.locacao_link_ler(pg_temp.t('loc'), pg_temp.ip('1'))->>'ok')::boolean,
  'link da pré-aprovação não abre a Documentação');
SELECT pg_temp.ok(NOT (public.locacao_pre_link_salvar(pg_temp.t('loc'), pg_temp.ip('1'), '{"aluguel":"1"}')->>'ok')::boolean
  AND NOT (public.locacao_pre_link_salvar(pg_temp.t('loc'), pg_temp.ip('1'), '{"matricula":"1"}')->>'ok')::boolean,
  'cliente não grava campo fora da sua parte');
SELECT pg_temp.ok(NOT (public.locacao_pre_link_salvar(pg_temp.t('loc'), pg_temp.ip('1'), '{"renda":"7.800,00"}')->>'ok')::boolean,
  'renda do cliente validada em R$ no banco');
SELECT pg_temp.ok(NOT (public.locacao_pre_link_preparar(pg_temp.t('loc'), pg_temp.ip('1'), 'pdf')->>'ok')::boolean,
  'locatário não anexa arquivo na pré-aprovação');
SELECT pg_temp.ok((public.locacao_pre_link_salvar(pg_temp.t('loc'), pg_temp.ip('1'),
  '{"cpf":"529.982.247-25","nome":"Cliente Preencheu Fictício","nascimento":"1991-05-20","telefone":"(15) 98888-0000","email":"cli@exemplo.invalid"}')->>'ok')::boolean,
  'cliente salva rascunho');
SELECT pg_temp.ok(public.locacao_pre_link_ler(pg_temp.t('loc'), pg_temp.ip('1'))->>'status' = 'em_preenchimento', 'status: em preenchimento');
SELECT pg_temp.ok(public.locacao_pre_link_enviar(pg_temp.t('loc'), pg_temp.ip('1'))->'faltando' = '["renda do locatário"]',
  'cliente não envia incompleto (caução pede renda)');
SELECT public.locacao_pre_link_salvar(pg_temp.t('loc'), pg_temp.ip('1'), '{"renda":"6500.00"}');
SELECT pg_temp.ok((public.locacao_pre_link_enviar(pg_temp.t('loc'), pg_temp.ip('1'))->>'ok')::boolean, 'cliente envia ao corretor');
SELECT pg_temp.ok(NOT (public.locacao_pre_link_salvar(pg_temp.t('loc'), pg_temp.ip('1'), '{"nome":"Mudou"}')->>'ok')::boolean,
  'depois de enviar, o cliente não edita mais');
SELECT pg_temp.ok(public.locacao_pre_link_ler(pg_temp.t('loc'), pg_temp.ip('1'))->>'status' = 'enviado', 'cliente vê "enviado"');
RESET ROLE;
SELECT pg_temp.ok((SELECT candidato->>'nome' = 'Nome Digitado Pelo Corretor' AND candidato->>'renda' = '6500.00'
  AND candidato->>'cpf' = '529.982.247-25' FROM public.locacoes WHERE id = pg_temp.id('CLI')),
  'dados chegam ao corretor só nos campos vazios (o que ele digitou fica)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok((SELECT l->>'status' = 'enviado' AND l->'dados'->>'renda' = '6500.00' FROM jsonb_array_elements(
  public.locacao_pre_links_lista(pg_temp.id('CLI'))->'links') l WHERE l->>'parte' = 'locatario'), 'corretor confere o que o cliente enviou');
SELECT pg_temp.ok(public.locacao_enviar_pre(pg_temp.id('CLI'))->>'etapa' = 'aprovacao', 'corretor confere e envia à gestora');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(NOT (public.locacao_pre_link_ler(pg_temp.t('loc'), pg_temp.ip('1'))->>'ok')::boolean,
  'fora da pré-análise o link da pré-aprovação não abre mais');
RESET ROLE;

-- 5) Troca de garantia DEPOIS de gerar o link -----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_salvar_pre(pg_temp.id('CLI2'), pg_temp.pre('seguro_fianca', '{}'));
SELECT public.locacao_pre_links_modo(pg_temp.id('CLI2'), 'cliente');
INSERT INTO toks SELECT 'loc2', public.locacao_pre_links_emitir(pg_temp.id('CLI2'), 'locatario')->>'token';
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(NOT (public.locacao_pre_link_ler(pg_temp.t('loc2'), pg_temp.ip('2'))->>'pede_renda')::boolean, 'seguro: link não pede renda');
SELECT public.locacao_pre_link_salvar(pg_temp.t('loc2'), pg_temp.ip('2'),
  '{"cpf":"529.982.247-25","nome":"Cliente Dois Fictício","nascimento":"1985-01-30","telefone":"(15) 97777-0000","email":"dois@exemplo.invalid"}');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_salvar_pre(pg_temp.id('CLI2'), '{"garantia":"fiador"}');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok((public.locacao_pre_link_ler(pg_temp.t('loc2'), pg_temp.ip('2'))->>'pede_renda')::boolean,
  'troca para fiador com link aberto: o mesmo link passa a pedir a renda');
SELECT pg_temp.ok(public.locacao_pre_link_enviar(pg_temp.t('loc2'), pg_temp.ip('2'))->'faltando' = '["renda do locatário"]',
  'envio do cliente segue a garantia ATUAL');
SELECT public.locacao_pre_link_salvar(pg_temp.t('loc2'), pg_temp.ip('2'), '{"renda":"9000.00"}');
SELECT pg_temp.ok((public.locacao_pre_link_enviar(pg_temp.t('loc2'), pg_temp.ip('2'))->>'ok')::boolean, 'com a renda, envia');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('CLI2'))) LIKE '22023%Aguarde%',
  'fiador novo: corretor aguarda o link do fiador');
INSERT INTO toks SELECT 'fia', public.locacao_pre_links_emitir(pg_temp.id('CLI2'), 'fiador')->>'token';
INSERT INTO toks SELECT 'fia_novo', public.locacao_pre_links_emitir(pg_temp.id('CLI2'), 'fiador')->>'token';
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(NOT (public.locacao_pre_link_ler(pg_temp.t('fia'), pg_temp.ip('3'))->>'ok')::boolean, 'link novo invalida o anterior');
SELECT pg_temp.put('lf', public.locacao_pre_link_ler(pg_temp.t('fia_novo'), pg_temp.ip('3')));
SELECT pg_temp.ok(pg_temp.j('lf')->>'parte' = 'fiador' AND (pg_temp.j('lf')->>'anexo_matricula')::boolean, 'fiador vê só a parte dele e o anexo opcional');
SELECT pg_temp.ok(NOT (public.locacao_pre_link_salvar(pg_temp.t('fia_novo'), pg_temp.ip('3'), '{"email":"x@y.z"}')->>'ok')::boolean,
  'fiador não grava campos do locatário');
SELECT public.locacao_pre_link_salvar(pg_temp.t('fia_novo'), pg_temp.ip('3'),
  '{"nome":"Fiador Link Fictício","cpf":"111.444.777-35","renda":"15000.00","matricula":"98765"}');
CREATE TEMP TABLE up(path text);
GRANT ALL ON up TO service_role;
INSERT INTO up SELECT public.locacao_pre_link_preparar(pg_temp.t('fia_novo'), pg_temp.ip('3'), 'pdf')->>'path';
SELECT pg_temp.ok((SELECT path ~ ('^' || pg_temp.id('orgA') || '/' || pg_temp.id('CLI2') || '/pre-fiador/[0-9a-f-]{36}[.]pdf$') FROM up),
  'anexo do cliente só no caminho imobiliária/locação/pre-fiador');
SELECT pg_temp.ok(NOT (public.locacao_pre_link_registrar(pg_temp.t('fia_novo'), pg_temp.ip('3'), (SELECT path FROM up), 'mat.pdf')->>'ok')::boolean,
  'sem arquivo no Storage não registra');
RESET ROLE;
INSERT INTO storage.objects(bucket_id, name) SELECT 'locacao-documentos', path FROM up;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok((public.locacao_pre_link_registrar(pg_temp.t('fia_novo'), pg_temp.ip('3'), (SELECT path FROM up), 'matricula-ficticia.pdf')->>'ok')::boolean,
  'anexo opcional registrado');
SELECT pg_temp.ok((public.locacao_pre_link_enviar(pg_temp.t('fia_novo'), pg_temp.ip('3'))->>'ok')::boolean, 'fiador envia ao corretor');
RESET ROLE;
SELECT pg_temp.ok((SELECT ficha->'fiador'->>'matricula' = '98765' FROM public.locacoes WHERE id = pg_temp.id('CLI2'))
  AND EXISTS (SELECT 1 FROM public.locacao_documentos WHERE locacao_id = pg_temp.id('CLI2')
    AND item = 'Matrícula do imóvel do fiador (quitado)' AND storage_path = (SELECT path FROM up)),
  'dados do fiador e a matrícula anexada chegam ao corretor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(public.locacao_enviar_pre(pg_temp.id('CLI2'))->>'etapa' = 'aprovacao', 'todas as partes enviaram: corretor envia à gestora');
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT public.locacao_gestora_decidir(pg_temp.id('CLI2'), true, NULL);
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(NOT (public.locacao_detalhe(pg_temp.id('CLI2'))->'faltando' ? 'Matrícula do imóvel do fiador (quitado)'),
  'matrícula anexada na pré-aprovação não é pedida de novo');

-- Fiador → seguro com link do fiador aberto: o link do fiador deixa de valer; voltar a "Eu preencho" cancela tudo.
SELECT public.locacao_salvar_pre(pg_temp.id('CLIF'), pg_temp.pre('fiador'));
SELECT public.locacao_pre_links_modo(pg_temp.id('CLIF'), 'cliente');
INSERT INTO toks SELECT 'ff', public.locacao_pre_links_emitir(pg_temp.id('CLIF'), 'fiador')->>'token';
INSERT INTO toks SELECT 'fl', public.locacao_pre_links_emitir(pg_temp.id('CLIF'), 'locatario')->>'token';
SELECT public.locacao_salvar_pre(pg_temp.id('CLIF'), '{"garantia":"seguro_fianca"}');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(NOT (public.locacao_pre_link_ler(pg_temp.t('ff'), pg_temp.ip('4'))->>'ok')::boolean,
  'troca fiador → seguro: link do fiador para de abrir');
SELECT pg_temp.ok((public.locacao_pre_link_ler(pg_temp.t('fl'), pg_temp.ip('4'))->>'ok')::boolean, 'link do locatário continua');
RESET ROLE;
UPDATE public.locacao_pre_links SET expira_em = now() - interval '1 second' WHERE token_hash = encode(extensions.digest(pg_temp.t('fl'), 'sha256'), 'hex');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(NOT (public.locacao_pre_link_ler(pg_temp.t('fl'), pg_temp.ip('4'))->>'ok')::boolean, 'link vencido não abre');
SELECT pg_temp.ok(NOT (public.locacao_pre_link_ler(repeat('0', 64), pg_temp.ip('4'))->>'ok')::boolean
  AND NOT (public.locacao_pre_link_ler('abc', pg_temp.ip('4'))->>'ok')::boolean, 'token inexistente ou malformado não abre');
SELECT public.locacao_pre_link_ler(repeat('0', 64), pg_temp.ip('5')) FROM generate_series(1, 121);
RESET ROLE;
SELECT pg_temp.ok((SELECT quantidade > 120 FROM public.locacao_link_tentativas WHERE ip_hash = pg_temp.ip('5')),
  'tentativas contam no limite por IP');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_pre_links_modo(pg_temp.id('CLIF'), 'corretor');
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.locacao_pre_links WHERE locacao_id = pg_temp.id('CLIF')),
  'voltar para "Eu preencho" cancela os links');

SELECT 'TOTAL=' || count(*) || ' PASSOU=' || count(*) FILTER (WHERE ok) FROM r;
SELECT 'FALHA: ' || msg FROM r WHERE NOT ok;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM r WHERE NOT ok) THEN RAISE EXCEPTION 'Falha na suíte locacao-pre-aprovacao'; END IF; END $$;
