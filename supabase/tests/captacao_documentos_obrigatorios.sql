-- Suíte da migration 20261015200000 (documentos travam o envio; semana do Plano opcional). Roda DENTRO
-- de transação revertida (run-captacao-documentos-obrigatorios.sh). Homologação: A = Única (…-0001).
-- Perfis: captador (UE Corretor) e gestor da equipe (UE Gestor). Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.doc(_cap text, _kind text, _owner int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.exclusive_documents (capture_id, kind, owner_index, storage_path, file_name, uploaded_by, organization_id)
  SELECT c.id, _kind, _owner, 'teste/' || gen_random_uuid() || '.pdf', _kind || '.pdf', pg_temp.id('captador'), c.organization_id
    FROM public.exclusive_captures c WHERE c.id = pg_temp.id(_cap) $$;
CREATE FUNCTION pg_temp.enviar(_cap text) RETURNS text LANGUAGE sql AS
  $$ SELECT pg_temp.err(format('SELECT public.exclusive_transition(%L, %L)', pg_temp.id(_cap), 'enviar')) $$;
CREATE FUNCTION pg_temp.status(_cap text) RETURNS text LANGUAGE sql AS
  $$ SELECT status FROM public.exclusive_captures WHERE id = pg_temp.id(_cap) $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a \gset
INSERT INTO ids VALUES ('captador', '10000000-0000-4000-8000-000000000003'), ('gestor', '10000000-0000-4000-8000-000000000002');
UPDATE public.organization_modules SET enabled = true
 WHERE module IN ('captacao_exclusiva', 'feedback_proprietario') AND organization_id = :'org_a';
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
INSERT INTO ids SELECT 'a_vital', id FROM public.owner_feedback_actions WHERE organization_id = :'org_a' AND list = 'marketing' AND active AND weight = 'vital' ORDER BY sort LIMIT 1;
INSERT INTO ids SELECT 'a_imp', id FROM public.owner_feedback_actions WHERE organization_id = :'org_a' AND list = 'marketing' AND active AND weight = 'importante' ORDER BY sort LIMIT 1;
SELECT pg_temp.ok((SELECT count(*) FROM ids WHERE k IN ('unit_a', 'a_vital', 'a_imp')) = 3, 'pré: unidade e ações de marketing na homologação');

-- c1..c3 = captação normal com todos os campos preenchidos; c4 = cadastro manual.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
INSERT INTO ids SELECT 'c' || g, public.exclusive_create_unit(pg_temp.id('unit_a')) FROM generate_series(1, 3) g;
RESET ROLE;
SELECT jsonb_build_object(
  'imovel', jsonb_build_object('tipo_imovel', 'Casa', 'endereco', 'Rua Fictícia, 1', 'bairro', 'Jardim Teste',
    'municipio', 'Sorocaba', 'estado', 'SP', 'classificacao_fiscal_iptu', '00.000', 'numero_matricula', '123',
    'cartorio_registro', '1º CRI', 'valor_imovel', '500000'),
  'proprietario_1', jsonb_build_object('nome_completo', 'Pessoa Teste', 'rg', '11.111.111-1', 'cpf', '529.982.247-25',
    'endereco_completo', 'Rua Fictícia, 1', 'nacionalidade', 'brasileira', 'estado_civil', 'solteira',
    'email', 'teste@example.com', 'telefone_1', '15999999999'),
  'condicoes', jsonb_build_object('prazo_dias_numero', '180', 'prazo_dias_extenso', 'cento e oitenta',
    'prazo_dias_uteis_numero', '5', 'prazo_dias_uteis_extenso', 'cinco', 'comissao_percentual_numero', '6',
    'comissao_percentual_extenso', 'seis', 'foro_comarca', 'Sorocaba', 'foro_estado', 'SP'),
  -- 2 ações marcadas; só a essencial tem semana (a importante fica sem semana).
  'dossie', jsonb_build_array(pg_temp.id('a_vital'), pg_temp.id('a_imp')),
  'plano_semanas', jsonb_build_object(pg_temp.id('a_vital')::text, '[1]'::jsonb, pg_temp.id('a_imp')::text, '[]'::jsonb)
) AS form \gset
UPDATE public.exclusive_captures SET form_data = form_data || :'form'::jsonb,
  broker_name = 'Corretor Teste', broker_cpf = '52998224725', broker_creci = '12345-F'
 WHERE id IN (pg_temp.id('c1'), pg_temp.id('c2'), pg_temp.id('c3'));

-- 0) Regra pura do Plano: semana opcional, ao menos 1 ação continua obrigatória
SELECT pg_temp.ok(public.exclusive_plano_ok(:'org_a', :'form'::jsonb), 'plano: ação marcada sem semana não trava mais');
SELECT pg_temp.ok(public.exclusive_plano_ok(:'org_a', jsonb_build_object('dossie', jsonb_build_array(pg_temp.id('a_imp')))), 'plano: 1 ação sem nenhuma semana escolhida passa');
SELECT pg_temp.ok(NOT public.exclusive_plano_ok(:'org_a', jsonb_build_object('dossie', '[]'::jsonb, 'plano_semanas', '{}'::jsonb)), 'plano: nenhuma ação marcada continua travando');
SELECT pg_temp.ok(ARRAY(SELECT public.exclusive_plan_semanas(:'form'::jsonb, pg_temp.id('a_imp'))) = '{0}'::smallint[], 'ação sem semana vira item único com prazo por peso');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
-- 1) Envio normal travado pelos documentos
SELECT pg_temp.ok(pg_temp.enviar('c1') LIKE '%RG e CPF ou CNH%', 'sem documento do proprietário: trava');
RESET ROLE; SELECT pg_temp.doc('c1', 'cnh', 1); SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.enviar('c1') LIKE '%matrícula e o IPTU%', 'com CNH mas sem matrícula e IPTU: trava');
RESET ROLE; SELECT pg_temp.doc('c1', 'matricula', 0); SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.enviar('c1') LIKE '%matrícula e o IPTU%', 'só matrícula (sem IPTU): trava');
RESET ROLE; SELECT pg_temp.doc('c1', 'iptu', 0); SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.enviar('c1') IS NULL AND pg_temp.status('c1') = 'enviada',
  'CNH + matrícula + IPTU, sem comprovante de residência e com ação sem semana: envia');
-- c2: RG + CPF também vale; c3: só IPTU continua travado
RESET ROLE; SELECT pg_temp.doc('c2', 'rg', 1), pg_temp.doc('c2', 'cpf', 1), pg_temp.doc('c2', 'matricula', 0), pg_temp.doc('c2', 'iptu', 0);
SELECT pg_temp.doc('c3', 'rg', 1), pg_temp.doc('c3', 'cpf', 1), pg_temp.doc('c3', 'iptu', 0), pg_temp.doc('c3', 'residencia', 0);
SET LOCAL ROLE authenticated; SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.enviar('c2') IS NULL AND pg_temp.status('c2') = 'enviada', 'RG + CPF + matrícula + IPTU: envia');
SELECT pg_temp.ok(pg_temp.enviar('c3') LIKE '%matrícula e o IPTU%' AND pg_temp.status('c3') = 'rascunho',
  'sem matrícula (mesmo com comprovante de residência): trava e fica em rascunho');

-- 2) Cadastro manual não muda: contrato assinado + Plano, sem matrícula/IPTU
INSERT INTO ids SELECT 'c4', public.exclusive_create_manual(pg_temp.id('unit_a'));
RESET ROLE;
UPDATE public.exclusive_captures SET form_data = form_data || jsonb_build_object('dossie', jsonb_build_array(pg_temp.id('a_imp'))),
  broker_name = 'Corretor Teste' WHERE id = pg_temp.id('c4');
SELECT pg_temp.doc('c4', 'assinado', 0);
SET LOCAL ROLE authenticated; SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.enviar('c4') IS NULL AND pg_temp.status('c4') = 'enviada', 'manual: envia sem matrícula/IPTU e com ação sem semana');

-- 3) Gestor aprova o fluxo normal com ação sem semana (antes travava)
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L)', pg_temp.id('c4'), 'aprovar')) IS NULL
  AND pg_temp.status('c4') = 'aprovada', 'gestor aprova o manual com ação sem semana');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
