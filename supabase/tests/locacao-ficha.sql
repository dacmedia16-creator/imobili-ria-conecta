-- Suíte da migration 20261113120000 (Locação — ficha de abertura + checklist por parte + trava do "Montar contrato",
-- t_28e583e2). Roda DENTRO de transação revertida (run-locacao-ficha.sh). Dados fictícios só na transação.
-- Homologação: A = Agência A (…-0001), B = outra imobiliária. c2 = corretor dono, a1 = outro corretor da A,
-- ges = gestora, con = setor de contratos, adm = administrador da A, b1/admB = pessoas da B.
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
-- Ficha completa fictícia (captador = _cap).
CREATE FUNCTION pg_temp.ficha(_cap uuid, _pessoas jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'candidato', jsonb_build_object('cpf', '000.111.222-33', 'nome', 'Locatário Exemplo (fictício)', 'nascimento', '1990-04-12',
      'telefone', '(15) 90000-0001', 'email', 'locatario.exemplo@teste.invalid'),
    'endereco', 'Rua Fictícia das Flores, 100 — Ap 11, Sorocaba/SP', 'tipo', 'residencial', 'garantia', 'fiador',
    'aluguel', 2000, 'condominio', 450, 'iptu', 80, 'taxa_adm', 10, 'parceria', false, 'captador_id', _cap,
    'ficha', jsonb_build_object('imovel_id', 'IM-9001', 'mobilia', 'semi', 'metragem', 68.5,
      'locatario_endereco', 'Rua Atual Fictícia, 5 — Sorocaba/SP',
      'proprietario', jsonb_build_object('nome', 'Proprietário Exemplo (fictício)', 'telefone', '(15) 90000-0002',
        'email', 'prop.exemplo@teste.invalid'),
      'observacoes', '1º mês com 50% de desconto (fictício)') || _pessoas) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('ges', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('con', 'b316b223-da46-4c2c-9952-25096d5ae5ff'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'),
  ('admB', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');

-- 0) Estrutura ---------------------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'locacoes'
   AND column_name IN ('ficha', 'captador_id', 'docs_completos_em')) = 3, 'locacoes ganhou ficha, captador e data da documentação completa');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.locacoes WHERE ficha <> '{}'::jsonb OR captador_id IS NOT NULL
   OR docs_completos_em IS NOT NULL), 'locações que já existiam ficam iguais (ficha vazia, sem captador, sem data)');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_docs_situacao(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_partes_json(public.locacoes)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_docs_grupo(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_checklist_l(public.locacoes)', 'EXECUTE'),
  'funções internas novas não são chamáveis pelo navegador');
SELECT pg_temp.ok(has_function_privilege('authenticated', 'public.locacao_corretores()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.locacao_corretores()', 'EXECUTE'), 'lista de captadores: só com login');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname LIKE 'locacao%' AND has_function_privilege('anon', p.oid, 'EXECUTE')), 'nenhuma função locacao_* executável por anon (sem link público)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname LIKE 'locacao%' AND p.prosecdef AND NOT coalesce('search_path=""' = ANY (p.proconfig), false)),
  'toda função SECURITY DEFINER da locação com search_path vazio');
SELECT pg_temp.ok(public.locacao_doc_opcional('Boleto do gás (opcional)') AND NOT public.locacao_doc_opcional('Opcional: RG'),
  'item opcional = nome termina em "(opcional)"');

-- 1) Preparação --------------------------------------------------------------------------------------------------
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true),
  (pg_temp.id('orgB'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.locacao_papeis (organization_id, user_id, papel) VALUES (pg_temp.id('orgA'), pg_temp.id('ges'), 'gestora'),
  (pg_temp.id('orgA'), pg_temp.id('con'), 'contratos')
ON CONFLICT DO NOTHING;
SET LOCAL ROLE authenticated;

-- 2) Ficha de abertura pelo corretor -------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok((SELECT bool_or((x->>'id')::uuid = pg_temp.id('a1')) AND NOT bool_or((x->>'id')::uuid = pg_temp.id('b1'))
   FROM jsonb_array_elements(public.locacao_corretores()) x), 'captadores: só pessoas da própria imobiliária');
SELECT pg_temp.setid('L', (public.locacao_criar()->>'id')::uuid);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('L'), '{"ficha":{"senha":"x"}}')) LIKE '22023%ficha%',
  'ficha: campo fora da lista é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('L'), '{"ficha":{"mobilia":"luxo"}}')) LIKE '22023%',
  'ficha: mobília fora das 3 opções é recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('L'), '{"ficha":{"metragem":"68"}}')) LIKE '22023%',
  'ficha: metragem tem de ser número');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('L'), '{"ficha":{"locatario_pessoa":"empresa"}}')) LIKE '22023%',
  'ficha: PF/PJ fora da lista é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('L'),
  jsonb_build_object('captador_id', pg_temp.id('b1')))) LIKE '42501%', 'captador de outra imobiliária é recusado');
SELECT public.locacao_salvar_pre(pg_temp.id('L'), (pg_temp.ficha(pg_temp.id('a1')) - 'captador_id') || '{"ficha":{}}');
SELECT pg_temp.put('e', to_jsonb(pg_temp.err(format('SELECT public.locacao_enviar_pre(%L)', pg_temp.id('L')))));
SELECT pg_temp.ok(pg_temp.j('e') #>> '{}' LIKE '22023%ID do imóvel%metragem%nome do proprietário%corretor captador%',
  'ficha incompleta não vai à gestora (lista o que falta da ficha)');
SELECT public.locacao_salvar_pre(pg_temp.id('L'), pg_temp.ficha(pg_temp.id('a1')));
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->'ficha'->>'imovel_id' = 'IM-9001' AND pg_temp.j('det')->'ficha'->>'mobilia' = 'semi'
  AND (pg_temp.j('det')->'ficha'->>'metragem')::numeric = 68.5
  AND pg_temp.j('det')->'ficha'->'proprietario'->>'nome' = 'Proprietário Exemplo (fictício)'
  AND pg_temp.j('det')->'ficha'->>'observacoes' LIKE '1º mês%', 'ficha salva: imóvel, mobília, metragem, proprietário e observações');
SELECT pg_temp.ok((pg_temp.j('det')->>'captador_id')::uuid = pg_temp.id('a1') AND pg_temp.j('det')->>'captador_nome' IS NOT NULL
  AND (pg_temp.j('det')->>'corretor_id')::uuid = pg_temp.id('c2'), 'responsável (quem abriu) e captador registrados separados');
SELECT pg_temp.ok((pg_temp.j('det')->>'aluguel')::numeric = 2000 AND (pg_temp.j('det')->>'iptu')::numeric = 80
  AND (pg_temp.j('det')->>'condominio')::numeric = 450 AND (pg_temp.j('det')->>'taxa_adm')::numeric = 10
  AND pg_temp.j('det')->>'garantia' = 'fiador' AND pg_temp.j('det')->>'tipo' = 'residencial', 'valores, garantia e modalidade salvos');
SELECT public.locacao_salvar_pre(pg_temp.id('L'), '{"ficha":{"imovel_id":"IM-9001","mobilia":"semi","metragem":68.5,"locatario_endereco":"Rua Atual Fictícia, 5 — Sorocaba/SP","proprietario":{"nome":"Proprietário Exemplo (fictício)","telefone":null,"email":"prop.exemplo@teste.invalid"},"observacoes":null}}');
SELECT pg_temp.ok(NOT (public.locacao_detalhe(pg_temp.id('L'))->'ficha' ? 'observacoes'), 'campo apagado (null) sai da ficha');
SELECT public.locacao_enviar_pre(pg_temp.id('L'));
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'aprovacao', 'ficha completa → entra na esteira (aprovação da gestora)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, %L)', pg_temp.id('L'), '{"ficha":{}}')) LIKE '22023%etapa%',
  'ficha não muda depois de enviada');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_detalhe(%L)', pg_temp.id('L'))) LIKE '42501%',
  'captador não vira dono: outro corretor não vê a locação');
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT public.locacao_gestora_decidir(pg_temp.id('L'), true, NULL);

-- 3) Checklist por parte (PF) -------------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok((SELECT array_agg(p->>'rotulo' ORDER BY n) FROM jsonb_array_elements(pg_temp.j('det')->'partes') WITH ORDINALITY t(p, n))
   = ARRAY['Locatário PF', 'Fiador PF', 'Proprietário PF'], 'checklist por parte: Locatário PF, Fiador PF, Proprietário PF');
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('det')->'checklist') = 12 AND jsonb_array_length(pg_temp.j('det')->'faltando') = 12
  AND NOT (pg_temp.j('det')->>'docs_completa')::boolean AND pg_temp.j('det')->>'docs_completos_em' IS NULL,
  'PF: mesma lista de antes (12 itens), todos faltando, sem data de completa');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_detalhe(pg_temp.id('L'))->'partes') = 3,
  'setor de contratos vê o checklist por parte');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
INSERT INTO up (lk, item, n) SELECT 'L', x, n FROM jsonb_array_elements_text(pg_temp.j('det')->'checklist') WITH ORDINALITY t(x, n);
UPDATE up SET path = public.locacao_documento_preparar(pg_temp.id('L'), item, 'pdf')->>'path' WHERE lk = 'L';
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner) SELECT 'locacao-documentos', path, pg_temp.id('c2') FROM up WHERE lk = 'L';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_documento_registrar(pg_temp.id('L'), item, path, 'doc-ficticio-' || n || '.pdf') FROM up WHERE lk = 'L' AND n <= 11;
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('det')->'faltando') = 1 AND pg_temp.j('det')->>'docs_completos_em' IS NULL
  AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.j('det')->'partes') p, jsonb_array_elements(p->'itens') i
        WHERE NOT (i->>'entregue')::boolean) = 1, 'faltando 1: checklist marca o item pendente e não há data');
SELECT public.locacao_documento_registrar(pg_temp.id('L'), item, path, 'doc-ficticio-' || n || '.pdf') FROM up WHERE lk = 'L' AND n = 12;
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok((pg_temp.j('det')->>'docs_completa')::boolean AND pg_temp.j('det')->>'docs_completos_em' IS NOT NULL,
  'último documento entregue: registra a data da documentação completa');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.j('det')->'eventos') e
   WHERE e->>'descricao' LIKE 'Documentação completa%' AND e->>'ator_nome' IS NOT NULL), 'histórico registra a documentação completa');
SELECT public.locacao_documento_remover((SELECT (d->>'id')::uuid FROM jsonb_array_elements(pg_temp.j('det')->'documentos') d
   WHERE d->>'item' = (SELECT item FROM up WHERE lk = 'L' AND n = 5)));
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'docs_completos_em' IS NULL
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(public.locacao_detalhe(pg_temp.id('L'))->'eventos') e
               WHERE e->>'descricao' LIKE 'Documentação voltou a ficar incompleta%'), 'removeu um obrigatório: a data sai e o histórico avisa');
UPDATE up SET path = public.locacao_documento_preparar(pg_temp.id('L'), item, 'pdf')->>'path' WHERE lk = 'L' AND n = 5;
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner) SELECT 'locacao-documentos', path, pg_temp.id('c2') FROM up WHERE lk = 'L' AND n = 5;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_documento_registrar(pg_temp.id('L'), item, path, 'doc-novo.pdf') FROM up WHERE lk = 'L' AND n = 5;
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'docs_completos_em' IS NOT NULL, 'reposto: data registrada de novo');

-- 4) Até o setor de contratos e a trava do "Montar contrato" --------------------------------------------------------
SELECT public.locacao_contrato_salvar(pg_temp.id('L'), jsonb_build_object(
  'loc_rg', '11.111.111-1', 'loc_nacionalidade', 'brasileira', 'loc_estado_civil', 'solteiro(a)', 'loc_profissao', 'analista',
  'loc_endereco', 'Rua Atual Fictícia, 5', 'prop_nome', 'Proprietária Fictícia', 'prop_cpf', '111.444.777-35',
  'prop_rg', '22.222.222-2', 'prop_nacionalidade', 'brasileira', 'prop_estado_civil', 'solteiro(a)', 'prop_profissao', 'professora',
  'prop_endereco', 'Rua da Dona Fictícia, 9', 'fia_nome', 'Fiador Fictício', 'fia_cpf', '529.982.247-25', 'fia_rg', '33.333.333-3',
  'fia_nacionalidade', 'brasileira', 'fia_estado_civil', 'solteiro(a)', 'fia_profissao', 'comerciante', 'fia_endereco', 'Rua F, 3',
  'fia_matricula', '12.345', 'fia_cartorio', '1º Oficial (fictício)', 'imv_inscricao', '11.22.33', 'imv_energia', '4000123456',
  'imv_agua', '98765', 'imv_vagas', 'não possui', 'prazo_meses', '30', 'inicio', '2026-12-01', 'dia_vencimento', '10'));
SELECT public.locacao_enviar_documentacao(pg_temp.id('L'));
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT public.locacao_gestora_decidir(pg_temp.id('L'), true, NULL);
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'minuta', 'documentação completa e conferida → setor de contratos');
-- A imobiliária ajusta a lista sem mexer em código: um documento novo obrigatório e um opcional para fiador.
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT public.locacao_config_salvar(jsonb_build_object('documentos', (public.locacao_contexto()->'config'->'documentos')
  || jsonb_build_object('fiador', (public.locacao_contexto()->'config'->'documentos'->'fiador')
       || '["Certidão negativa do fiador (fictícia)", "Referência pessoal do fiador (opcional)"]'::jsonb)));
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->>'docs_completos_em' IS NULL AND NOT (pg_temp.j('det')->>'docs_completa')::boolean,
  'lista mudou depois: a data da documentação completa some na hora (sem anexar nada)');
SELECT pg_temp.ok(pg_temp.j('det')->'faltando' = '["Certidão negativa do fiador (fictícia)"]'::jsonb
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.j('det')->'partes') p, jsonb_array_elements(p->'itens') i
               WHERE i->>'item' = 'Referência pessoal do fiador (opcional)' AND NOT (i->>'obrigatorio')::boolean),
  'lista ajustada por Regras: novo obrigatório falta; opcional aparece mas não conta');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''enviar_minuta'')', pg_temp.id('L')))
  LIKE '22023%Montar contrato travado%Certidão negativa do fiador%', 'TRAVA: com documento obrigatório pendente, não monta/enviar a minuta');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'minuta_externa', '{"externa":true}');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''preparar_assinatura'')', pg_temp.id('L')))
  LIKE '22023%Montar contrato travado%', 'TRAVA: nem a minuta pronta de outra RE/MAX passa sem o documento');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'minuta_externa', '{"externa":false}');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''cobrar_pendencia'', ''{"texto":"Falta a certidão do fiador"}'')', pg_temp.id('L'))) IS NULL,
  'contratos ainda cobra a pendência do corretor (só montar fica travado)');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
INSERT INTO up (lk, item, n) VALUES ('L', 'Certidão negativa do fiador (fictícia)', 99);
UPDATE up SET path = public.locacao_documento_preparar(pg_temp.id('L'), item, 'pdf')->>'path' WHERE lk = 'L' AND n = 99;
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner) SELECT 'locacao-documentos', path, pg_temp.id('c2') FROM up WHERE lk = 'L' AND n = 99;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_documento_registrar(pg_temp.id('L'), item, path, 'certidao.pdf') FROM up WHERE lk = 'L' AND n = 99;
SELECT public.locacao_corretor_minuta(pg_temp.id('L'), 'resolver_pendencia', 'Certidão anexada (fictício)');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''enviar_minuta'')', pg_temp.id('L'))) IS NULL,
  'LIBERADA: com todos os obrigatórios (opcional ainda faltando) a minuta é montada e enviada');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_corretor_minuta(pg_temp.id('L'), 'de_acordo');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'preparar_assinatura');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'assinatura', 'LIBERADA: preparar assinatura segue normal');

-- 5) PJ: proprietário PJ, locatário PJ e fiador PJ -------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.setid('P', (public.locacao_criar()->>'id')::uuid);
SELECT public.locacao_salvar_pre(pg_temp.id('P'), pg_temp.ficha(pg_temp.id('c2'),
  '{"locatario_pessoa":"pj","proprietario_pessoa":"pj","fiador_pessoa":"pj"}'::jsonb));
SELECT public.locacao_enviar_pre(pg_temp.id('P'));
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT public.locacao_gestora_decidir(pg_temp.id('P'), true, NULL);
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('detP', public.locacao_detalhe(pg_temp.id('P')));
SELECT pg_temp.ok((SELECT array_agg(p->>'rotulo' ORDER BY n) FROM jsonb_array_elements(pg_temp.j('detP')->'partes') WITH ORDINALITY t(p, n))
   = ARRAY['Locatário PJ', 'Fiador PJ', 'Proprietário PJ'], 'PJ: as três partes mudam para PJ');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM jsonb_array_elements_text(pg_temp.j('detP')->'checklist') x WHERE x = 'Cartão CNPJ da empresa locatária')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(pg_temp.j('detP')->'checklist') x WHERE x = 'Contrato social da empresa proprietária (última alteração)')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(pg_temp.j('detP')->'checklist') x WHERE x = 'CPF do locatário'),
  'PJ: listas dos formulários PJ (sem os itens de pessoa física)');
SELECT pg_temp.ok((SELECT jsonb_array_length(p->'itens') FROM jsonb_array_elements(pg_temp.j('detP')->'partes') p WHERE p->>'rotulo' = 'Fiador PJ')
   = jsonb_array_length(public.locacao_contexto()->'config'->'documentos'->'fiador'),
  'fiador PJ sem lista própria (a confirmar): usa a lista do fiador');
SELECT pg_temp.ok(pg_temp.j('detP')->'checklist' ? 'Boleto do gás (opcional)' AND pg_temp.j('detP')->'checklist' ? 'CND do condomínio (opcional)'
  AND NOT pg_temp.j('detP')->'faltando' ? 'Boleto do gás (opcional)'
  AND jsonb_array_length(pg_temp.j('detP')->'faltando') = (SELECT count(*) FROM jsonb_array_elements_text(pg_temp.j('detP')->'checklist') x
        WHERE x !~* '[(]opcional[)]\s*$'), 'PJ: boleto/CND do condomínio e boleto do gás aparecem como opcionais (não travam)');
INSERT INTO up (lk, item, n) SELECT 'P', x, n FROM jsonb_array_elements_text(pg_temp.j('detP')->'faltando') WITH ORDINALITY t(x, n);
UPDATE up SET path = public.locacao_documento_preparar(pg_temp.id('P'), item, 'pdf')->>'path' WHERE lk = 'P';
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner) SELECT 'locacao-documentos', path, pg_temp.id('c2') FROM up WHERE lk = 'P';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_documento_registrar(pg_temp.id('P'), item, path, 'pj-' || n || '.pdf') FROM up WHERE lk = 'P';
SELECT pg_temp.ok((public.locacao_detalhe(pg_temp.id('P'))->>'docs_completa')::boolean
  AND public.locacao_detalhe(pg_temp.id('P'))->>'docs_completos_em' IS NOT NULL, 'PJ: só os obrigatórios entregues → documentação completa com data');
RESET ROLE;
SELECT pg_temp.ok(public.locacao_grupo_do_item((SELECT l FROM public.locacoes l WHERE l.id = pg_temp.id('P')),
  'Cartão CNPJ da empresa locatária') = 'locatario', 'IA: documento PJ do locatário continua no grupo locatário');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);

-- 6) Isolamento entre locações e entre imobiliárias -----------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_registrar(%L, %L, %L, ''x.pdf'')', pg_temp.id('P'),
  'Cartão CNPJ da empresa locatária', (SELECT path FROM up WHERE lk = 'L' AND n = 1))) LIKE '22023%',
  'arquivo de uma locação não é registrado em outra');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_documento_preparar(%L, ''Cartão CNPJ da empresa locatária'', ''pdf'')', pg_temp.id('L'))) LIKE '22023%',
  'item de outra parte (PJ) é recusado numa locação PF');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_detalhe(%L)', pg_temp.id('P'))) LIKE '42501%',
  'pessoa de outra imobiliária não vê a ficha nem o checklist');
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_lista()) = 0, 'admin da B (módulo ligado) não vê locações da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, ''{}'')', pg_temp.id('P'))) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''enviar_minuta'')', pg_temp.id('L'))) LIKE '42501%',
  'admin da B não grava ficha nem monta contrato da A');
SELECT pg_temp.ok(NOT (public.locacao_contexto()->'config'->'documentos'->'fiador') ? 'Certidão negativa do fiador (fictícia)',
  'lista de documentos é por imobiliária: a mudança da A não aparece na B');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.locacao_corretores()) x WHERE (x->>'id')::uuid = pg_temp.id('c2')),
  'captadores da B não incluem corretor da A');

-- 7) Regras: listas PJ editáveis ------------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_config_salvar(''{"documentos":{"fiador_pj":["Contrato social do fiador"]}}'')') LIKE '42501%',
  'corretor não altera a lista de documentos');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT public.locacao_config_salvar('{"documentos":{"fiador_pj":["Contrato social do fiador (fictício)"]}}');
SELECT pg_temp.ok(public.locacao_contexto()->'config'->'documentos'->'fiador_pj' = '["Contrato social do fiador (fictício)"]'::jsonb,
  'administração define a lista do fiador PJ sem mexer em código');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_config_salvar(''{"documentos":{"inquilino_pj":["x x"]}}'')') LIKE '22023%',
  'grupo desconhecido continua recusado');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
