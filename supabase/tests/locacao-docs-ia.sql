-- Suíte da migration 20261112120000 (Locação — Documentação com leitura por IA, t_127811ca). Roda DENTRO de transação
-- revertida (run-locacao-docs-ia.sh). Dados fictícios só na transação; nada fica gravado; nenhuma IA é chamada (a
-- gravação da leitura é simulada como o servidor do ADM faria, com service_role).
-- Homologação: A = Agência A (…-0001). c2 = corretor dono, ges = gestora, a1 = outro corretor, b1 = outra imobiliária.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
CREATE TEMP TABLE up(lk text, item text, n int, path text);
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
CREATE FUNCTION pg_temp.doc(_lk text, _item text) RETURNS uuid LANGUAGE sql AS $$
  SELECT d.id FROM public.locacao_documentos d WHERE d.locacao_id = pg_temp.id(_lk) AND d.item = _item AND d.removido_em IS NULL
   ORDER BY d.enviado_em DESC LIMIT 1 $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('ges', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('a1', '10000000-0000-4000-8000-000000000003'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244');

-- 0) Estrutura ---------------------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FILTER (WHERE c.relrowsecurity) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('locacao_contrato_dados', 'locacao_doc_leituras')) = 2, 'as 2 tabelas novas com RLS ligada');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public'
   AND table_name IN ('locacao_contrato_dados', 'locacao_doc_leituras') AND grantee IN ('anon', 'authenticated', 'PUBLIC')),
  'nenhum grant das tabelas novas a anon/authenticated');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_leitura_gravar(uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.locacao_leitura_gravar(uuid,uuid,text,text,jsonb)', 'EXECUTE'),
  'gravar leitura da IA: só o servidor (service_role), nunca o navegador');
SELECT pg_temp.ok(has_function_privilege('authenticated', 'public.locacao_contrato_salvar(uuid,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.locacao_leitura_preparar(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.locacao_leitura_preparar(uuid)', 'EXECUTE'),
  'salvar contrato e preparar leitura: login necessário');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_contrato_faltando(public.locacoes)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_contrato_valores(public.locacoes)', 'EXECUTE'),
  'funções internas novas não são chamáveis pelo navegador');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname LIKE 'locacao%' AND p.prosecdef AND NOT coalesce('search_path=""' = ANY (p.proconfig), false)),
  'toda função SECURITY DEFINER da locação com search_path vazio');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND (p.proname LIKE 'sale%' OR p.proname LIKE 'exclusive%') AND p.prosrc LIKE '%locacao_contrato%'),
  'nenhuma função da venda ou da captação usa o código novo');

-- 1) Preparação: módulo, gestora, locação residencial com fiador aprovada --------------------------------------
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.locacao_papeis (organization_id, user_id, papel) VALUES (pg_temp.id('orgA'), pg_temp.id('ges'), 'gestora')
ON CONFLICT DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.setid('L', (public.locacao_criar()->>'id')::uuid);
SELECT public.locacao_salvar_pre(pg_temp.id('L'), jsonb_build_object(
  'candidato', jsonb_build_object('cpf', '000.111.222-33', 'nome', 'João Exemplo da Silva (fictício)', 'nascimento', '1990-04-12',
    'telefone', '(15) 90000-0001', 'email', 'joao.exemplo@teste.invalid'),
  'endereco', 'Rua Fictícia, 100 — Ap 12, Sorocaba/SP', 'tipo', 'residencial', 'garantia', 'fiador', 'aluguel', 2100));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contrato_salvar(%L, ''{"fia_nome":"x"}'')', pg_temp.id('L'))) LIKE '22023%etapa%',
  'dados do contrato só na etapa Documentação (pré-análise recusa)');
SELECT public.locacao_enviar_pre(pg_temp.id('L'));
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT public.locacao_gestora_decidir(pg_temp.id('L'), true, NULL);
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->>'etapa' = 'documentacao' AND (pg_temp.j('det')->'contrato'->>'exige')::boolean,
  'aprovada → Documentação; residencial com fiador exige os dados do contrato');
SELECT pg_temp.ok(pg_temp.j('det')->'contrato'->'valores'->>'loc_nome' = 'João Exemplo da Silva (fictício)'
  AND pg_temp.j('det')->'contrato'->'valores'->>'loc_cpf' = '000.111.222-33',
  'nome e CPF do locatário já vêm da pré-análise');
SELECT pg_temp.ok(pg_temp.j('det')->'contrato'->'faltando' ? 'RG do locatário' AND pg_temp.j('det')->'contrato'->'faltando' ? 'CPF do fiador'
  AND NOT pg_temp.j('det')->'contrato'->'faltando' ? 'nome do locatário', 'lista o que falta (sem o que veio da pré-análise)');

-- 2) Corretor digita -----------------------------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contrato_salvar(%L, ''{"senha":"x"}'')', pg_temp.id('L'))) LIKE '22023%Campo inválido%',
  'campo fora da lista do contrato é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contrato_salvar(%L, ''{"inicio":"2026-02-30"}'')', pg_temp.id('L'))) LIKE '22023%inicio%',
  'data inválida é recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contrato_salvar(%L, ''{"dia_vencimento":"31"}'')', pg_temp.id('L'))) LIKE '22023%',
  'vencimento fora de 1 a 28 é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contrato_salvar(%L, ''{"fia_nome":5}'')', pg_temp.id('L'))) LIKE '22023%',
  'valor que não é texto é recusado');
SELECT public.locacao_contrato_salvar(pg_temp.id('L'), '{"fia_nome":"Fiador Digitado (fictício)","prazo_meses":"30"}');
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->'contrato'->'origem'->'fia_nome'->>'o' = 'manual'
  AND pg_temp.j('det')->'contrato'->'valores'->>'prazo_meses' = '30', 'o que o corretor digita fica marcado como digitado');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contrato_salvar(%L, ''{"fia_rg":"1"}'')', pg_temp.id('L'))) LIKE '42501%',
  'outro corretor não grava dados desta locação');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contrato_salvar(%L, ''{"fia_rg":"1"}'')', pg_temp.id('L'))) LIKE '42501%',
  'pessoa de outra imobiliária não grava dados desta locação');
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contrato_salvar(%L, ''{"fia_rg":"1"}'')', pg_temp.id('L'))) LIKE '42501%',
  'gestora não preenche pelo corretor');

-- 3) Documentos (upload simulado como na suíte da Fase 1) -----------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
INSERT INTO up (lk, item, n) SELECT 'L', x, n FROM jsonb_array_elements_text(pg_temp.j('det')->'checklist') WITH ORDINALITY t(x, n);
UPDATE up SET path = public.locacao_documento_preparar(pg_temp.id('L'), item, 'pdf')->>'path' WHERE lk = 'L';
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner) SELECT 'locacao-documentos', path, pg_temp.id('c2') FROM up WHERE lk = 'L';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_documento_registrar(pg_temp.id('L'), item, path, 'doc-ficticio-' || n || '.pdf') FROM up WHERE lk = 'L';
RESET ROLE;
SELECT pg_temp.setid('dRG', pg_temp.doc('L', 'RG/CNH do fiador'));
SELECT pg_temp.setid('dMat', pg_temp.doc('L', 'Matrícula do imóvel do fiador (quitado)'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);

-- 4) Leitura: preparar (login de quem clicou) ---------------------------------------------------------------------
SELECT pg_temp.put('prep', public.locacao_leitura_preparar(pg_temp.id('dRG')));
SELECT pg_temp.ok(pg_temp.j('prep')->>'grupo' = 'fiador' AND pg_temp.j('prep')->>'item' = 'RG/CNH do fiador'
  AND pg_temp.j('prep')->>'path' LIKE pg_temp.id('orgA')::text || '/' || pg_temp.id('L')::text || '/%',
  'preparar devolve caminho da própria locação e o grupo do documento (fiador)');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'documentos' @> jsonb_build_array(jsonb_build_object(
  'id', pg_temp.id('dRG'), 'leitura', 'pendente')), 'selo "IA lendo" (pendente) no documento');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_leitura_preparar(%L)', pg_temp.id('dRG'))) LIKE '42501%',
  'outro corretor não manda ler documento desta locação');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_leitura_preparar(%L)', pg_temp.id('dRG'))) ~ '^(42501|22023 Documento não encontrado)',
  'outra imobiliária é barrada (módulo/imobiliária) e nem enxerga o documento');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_leitura_gravar(%L, %L, ''ok'', NULL, ''{"fia_rg":"forjado"}'')',
  pg_temp.id('dRG'), pg_temp.id('c2'))) LIKE '42501%', 'navegador não consegue forjar o selo "lido do documento"');

-- 5) Leitura: gravar (servidor) — só campo vazio ---------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.put('g', public.locacao_leitura_gravar(pg_temp.id('dRG'), pg_temp.id('c2'), 'ok', NULL, jsonb_build_object(
  'fia_nome', 'Nome Lido Pela IA', 'fia_rg', '12.345.678-9', 'fia_cpf', '529.982.247-25', 'loc_nome', 'Outro Nome Lido',
  'fia_nascimento', '1970-13-40', 'senha', 'x', 'fia_profissao', 7)));
SELECT pg_temp.ok((pg_temp.j('g')->>'preenchidos')::int = 2, 'IA preencheu só os 2 campos vazios e válidos (RG e CPF do fiador)');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->'contrato'->'valores'->>'fia_nome' = 'Fiador Digitado (fictício)',
  'NUNCA sobrescreve o que o corretor digitou');
SELECT pg_temp.ok(pg_temp.j('det')->'contrato'->'valores'->>'loc_nome' = 'João Exemplo da Silva (fictício)',
  'não sobrescreve o que veio da pré-análise');
SELECT pg_temp.ok(pg_temp.j('det')->'contrato'->'origem'->'fia_rg' = '{"o":"ia","item":"RG/CNH do fiador"}'::jsonb,
  'origem do campo: lido pela IA, de qual documento');
SELECT pg_temp.ok(NOT (pg_temp.j('det')->'contrato'->'valores' ? 'fia_nascimento') AND NOT (pg_temp.j('det')->'contrato'->'valores' ? 'senha')
  AND NOT (pg_temp.j('det')->'contrato'->'valores' ? 'fia_profissao'), 'data inválida, chave estranha e não-texto da IA são descartados');
SELECT pg_temp.ok(pg_temp.j('det')->'documentos' @> jsonb_build_array(jsonb_build_object('id', pg_temp.id('dRG'), 'leitura', 'ok',
  'preenchidos', 2)), 'selo "IA ok" com a quantidade de campos preenchidos');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.j('det')->'eventos') e
   WHERE e->>'descricao' = 'IA leu "RG/CNH do fiador": 2 campo(s) preenchido(s)' AND e->>'ator_nome' IS NOT NULL),
  'histórico registra a leitura em nome de quem clicou');
-- Ler de novo não troca o que já está preenchido.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.put('g', public.locacao_leitura_gravar(pg_temp.id('dRG'), pg_temp.id('c2'), 'ok', NULL,
  '{"fia_rg":"99.999.999-9","fia_nacionalidade":"brasileira"}'));
SELECT pg_temp.ok((pg_temp.j('g')->>'preenchidos')::int = 1
  AND (SELECT valores->>'fia_rg' FROM public.locacao_contrato_dados WHERE locacao_id = pg_temp.id('L')) = '12.345.678-9',
  'nova leitura só completa o que ainda falta (RG lido antes fica)');
-- Falha da IA: selo "IA falhou", nada muda, só o código do erro fica gravado.
SELECT public.locacao_leitura_gravar(pg_temp.id('dMat'), pg_temp.id('c2'), 'falhou', 'IA_SEM_CREDITO', NULL);
SELECT pg_temp.ok((SELECT status = 'falhou' AND erro = 'IA_SEM_CREDITO' AND sugestoes = '{}'::jsonb FROM public.locacao_doc_leituras
   WHERE documento_id = pg_temp.id('dMat')), 'IA fora do ar: selo "IA falhou" com só o código do erro');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_leitura_gravar(%L, %L, ''falhou'', ''texto livre do google'', NULL)',
  pg_temp.id('dMat'), pg_temp.id('c2'))) LIKE '22023%', 'erro gravado só da lista de códigos (nunca texto livre)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_leitura_gravar(%L, %L, ''pendente'', NULL, NULL)',
  pg_temp.id('dMat'), pg_temp.id('c2'))) LIKE '22023%', 'situação inválida é recusada');
-- Tentar de novo depois da falha.
SELECT public.locacao_leitura_gravar(pg_temp.id('dMat'), pg_temp.id('c2'), 'ok', NULL,
  '{"fia_matricula":"12.345","fia_cartorio":"1º Oficial de Registro de Imóveis de Sorocaba/SP (fictício)"}');
SELECT pg_temp.ok((SELECT status FROM public.locacao_doc_leituras WHERE documento_id = pg_temp.id('dMat')) = 'ok',
  'nova tentativa depois da falha → "IA ok"');
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.locacao_eventos e WHERE e.locacao_id = pg_temp.id('L')
   AND (e.descricao LIKE '%12.345.678-9%' OR e.descricao LIKE '%529.982%' OR e.descricao LIKE '%Nome Lido%')),
  'histórico não guarda dado lido do documento (só item e quantidade)');

-- 6) Trava de envio --------------------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)', pg_temp.id('L'))) LIKE '22023%Complete os dados do contrato%RG do locatário%',
  'TRAVA: documentos completos mas dados do contrato faltando → não envia (lista o que falta)');
SELECT public.locacao_contrato_salvar(pg_temp.id('L'), jsonb_build_object(
  'loc_rg', '11.111.111-1', 'loc_nacionalidade', 'brasileira', 'loc_estado_civil', 'solteiro(a)', 'loc_profissao', 'analista',
  'loc_endereco', 'Rua Atual Fictícia, 5 — Sorocaba/SP',
  'prop_nome', 'Proprietária Fictícia', 'prop_cpf', '111.444.777-35', 'prop_rg', '22.222.222-2', 'prop_nacionalidade', 'brasileira',
  'prop_estado_civil', 'casado(a)', 'prop_profissao', 'professora', 'prop_endereco', 'Rua da Dona Fictícia, 9',
  'fia_nacionalidade', 'brasileira', 'fia_estado_civil', 'solteiro(a)', 'fia_profissao', 'comerciante',
  'fia_endereco', 'Rua do Fiador Fictício, 3', 'imv_inscricao', '11.22.33', 'imv_energia', '4000123456', 'imv_agua', '98765',
  'imv_gas', 'não possui', 'inicio', '2026-12-01', 'dia_vencimento', '10'));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)', pg_temp.id('L')))
  LIKE '22023%nome do cônjuge do proprietário, CPF do cônjuge do proprietário, vagas de garagem (ou "não possui")',
  'proprietário casado: pede o cônjuge; vagas é obrigatório; gás "não possui" não falta');
SELECT public.locacao_contrato_salvar(pg_temp.id('L'), '{"prop_conj_nome":"Cônjuge Fictício","prop_conj_cpf":"390.533.447-05","imv_vagas":"não possui"}');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'contrato'->'valores'->>'imv_vagas' = 'não possui',
  'vagas "não possui" fica gravado como valor preenchido');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.locacao_leitura_gravar(pg_temp.id('dRG'), pg_temp.id('c2'), 'ok', NULL, '{"imv_gas":"777111","imv_vagas":"2"}');
RESET ROLE;
SELECT pg_temp.ok((SELECT valores->>'imv_gas' = 'não possui' AND valores->>'imv_vagas' = 'não possui'
   FROM public.locacao_contrato_dados WHERE locacao_id = pg_temp.id('L')), 'IA não sobrescreve "não possui" (gás e vagas)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_detalhe(pg_temp.id('L'))->'contrato'->'faltando') = 0, 'nada mais falta');
SELECT public.locacao_enviar_documentacao(pg_temp.id('L'));
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'conferencia', 'completo → vai para a Conferência da gestora');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contrato_salvar(%L, ''{"fia_rg":"1"}'')', pg_temp.id('L'))) LIKE '22023%etapa%',
  'depois de enviar o corretor não altera mais');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_leitura_preparar(%L)', pg_temp.id('dRG'))) LIKE '22023%etapa%',
  'depois de enviar não manda ler de novo');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.locacao_leitura_gravar(pg_temp.id('dRG'), pg_temp.id('c2'), 'ok', NULL, '{"loc_gas":"1"}')->>'ok' = 'false',
  'leitura que termina depois do envio não mexe em nada');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->'contrato'->'valores'->>'fia_matricula' = '12.345'
  AND pg_temp.j('det')->'contrato'->'origem'->'fia_matricula'->>'o' = 'ia', 'gestora vê os dados e a origem na Conferência');
SELECT public.locacao_gestora_decidir(pg_temp.id('L'), false, 'Conferir RG do fiador (fictício)');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->>'etapa' = 'documentacao' AND pg_temp.j('det')->'contrato'->'valores'->>'fia_rg' = '12.345.678-9',
  'devolvida: volta à Documentação com os dados preservados');
SELECT public.locacao_contrato_salvar(pg_temp.id('L'), '{"fia_rg":"12.345.678-0"}');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'contrato'->'origem'->'fia_rg'->>'o' = 'manual',
  'corrigir um campo lido pela IA passa a origem para "digitado"');
SELECT public.locacao_contrato_salvar(pg_temp.id('L'), '{"fia_rg":null}');
SELECT pg_temp.ok(NOT (public.locacao_detalhe(pg_temp.id('L'))->'contrato'->'valores' ? 'fia_rg'), 'apagar um campo (null) remove o valor');

-- 7) Caução e seguro-fiança seguem como estão -------------------------------------------------------------------------
SELECT pg_temp.setid('C', (public.locacao_criar()->>'id')::uuid);
SELECT public.locacao_salvar_pre(pg_temp.id('C'), jsonb_build_object(
  'candidato', jsonb_build_object('cpf', '000.111.222-44', 'nome', 'Maria Caução (fictícia)', 'nascimento', '1985-01-20',
    'telefone', '(15) 90000-0002', 'email', 'maria.caucao@teste.invalid'),
  'endereco', 'Rua Caução Fictícia, 50 — Sorocaba/SP', 'tipo', 'residencial', 'garantia', 'caucao', 'aluguel', 1500));
SELECT public.locacao_enviar_pre(pg_temp.id('C'));
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT public.locacao_gestora_decidir(pg_temp.id('C'), true, NULL);
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('detC', public.locacao_detalhe(pg_temp.id('C')));
SELECT pg_temp.ok(NOT (pg_temp.j('detC')->'contrato'->>'exige')::boolean AND jsonb_array_length(pg_temp.j('detC')->'contrato'->'faltando') = 0,
  'caução: dados do contrato não são exigidos');
INSERT INTO up (lk, item, n) SELECT 'C', x, n FROM jsonb_array_elements_text(pg_temp.j('detC')->'checklist') WITH ORDINALITY t(x, n);
UPDATE up SET path = public.locacao_documento_preparar(pg_temp.id('C'), item, 'pdf')->>'path' WHERE lk = 'C';
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner) SELECT 'locacao-documentos', path, pg_temp.id('c2') FROM up WHERE lk = 'C';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_documento_registrar(pg_temp.id('C'), item, path, 'doc-' || n || '.pdf') FROM up WHERE lk = 'C';
SELECT public.locacao_enviar_documentacao(pg_temp.id('C'));
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('C'))->>'etapa' = 'conferencia',
  'caução: com os documentos completos envia como antes, sem dados do contrato');
RESET ROLE;
SELECT pg_temp.ok(public.locacao_grupo_do_item((SELECT l FROM public.locacoes l WHERE l.id = pg_temp.id('C')),
  'Comprovante do depósito da caução') = 'caucao', 'documento da caução é reconhecido no grupo da garantia');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
