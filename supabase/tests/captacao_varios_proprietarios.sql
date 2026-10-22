-- t_58effd65 — Captação com vários proprietários. pgTAP em transação REVERTIDA, só em banco local
-- (clone só-estrutura). Nunca produção. Dados 100% fictícios.
-- Rodar: psql -v ON_ERROR_STOP=1 -f supabase/tests/captacao_varios_proprietarios.sql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(26);

CREATE FUNCTION pg_temp.dono(_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('nome_completo', 'Pessoa Teste ' || _n, 'rg', '00.000.00' || _n, 'cpf', '529.982.247-25',
    'endereco_completo', 'Rua Fictícia, ' || _n, 'nacionalidade', 'brasileira', 'estado_civil', 'solteiro(a)',
    'email', 'teste' || _n || '@example.com', 'telefone_1', '(15) 90000-0000') $$;
-- form_data com N proprietários no formato salvo (1º, 2º, proprietarios_extras).
CREATE FUNCTION pg_temp.form(_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'imovel', jsonb_build_object('tipo_imovel','Casa','endereco','Rua Teste, 1','bairro','Centro','municipio','Sorocaba',
      'estado','SP','classificacao_fiscal_iptu','00.000','numero_matricula','123','cartorio_registro','1º CRI','valor_imovel','500000'),
    'condicoes', jsonb_build_object('prazo_dias_numero','180','prazo_dias_extenso','cento e oitenta',
      'prazo_dias_uteis_numero','5','prazo_dias_uteis_extenso','cinco','comissao_percentual_numero','6',
      'comissao_percentual_extenso','seis','foro_comarca','Sorocaba','foro_estado','SP'),
    'proprietario_1', pg_temp.dono(1))
  || CASE WHEN _n >= 2 THEN jsonb_build_object('proprietario_2', pg_temp.dono(2)) ELSE '{}' END
  || CASE WHEN _n >= 3 THEN jsonb_build_object('proprietarios_extras',
       (SELECT jsonb_agg(pg_temp.dono(i) ORDER BY i) FROM generate_series(3, _n) i)) ELSE '{}' END $$;

-- 1) Lista de proprietários
SELECT is(jsonb_array_length(public.exclusive_owner_list(pg_temp.form(1))), 1, '1 proprietário');
SELECT is(jsonb_array_length(public.exclusive_owner_list(pg_temp.form(2))), 2, '2 proprietários (formato antigo)');
SELECT is(jsonb_array_length(public.exclusive_owner_list(pg_temp.form(4))), 4, '4 proprietários');
SELECT is(jsonb_array_length(public.exclusive_owner_list(pg_temp.form(35))), 35, '35 proprietários');
SELECT is(public.exclusive_owner_list(pg_temp.form(35))->34->>'nome_completo', 'Pessoa Teste 35', 'ordem preservada (35º na posição 35)');
SELECT is(jsonb_array_length(public.exclusive_owner_list(pg_temp.form(1) || '{"proprietarios_extras":[{"nome_completo":"X"}]}')), 1,
  'extras sem o 2º são ignorados (posição = owner_index)');
SELECT is(jsonb_array_length(public.exclusive_owner_list(pg_temp.form(1) || '{"proprietario_2":{}}')), 1, '2º vazio ({}) não conta (igual a hoje)');
SELECT is(jsonb_array_length(public.exclusive_owner_list(pg_temp.form(70))), 60, 'limite de segurança: 60');
SELECT is(public.exclusive_owner_list('{}'::jsonb), '[{}]'::jsonb, 'form vazio: 1º vazio (como antes)');

-- 2) Campos obrigatórios (CPF fictício válido 529.982.247-25 / CRECI fictício)
SELECT ok(public.exclusive_required_fields(pg_temp.form(1), '529.982.247-25', 'CRECI 0000'), 'obrigatórios: 1 proprietário completo');
SELECT ok(public.exclusive_required_fields(pg_temp.form(2), '529.982.247-25', 'CRECI 0000'), 'obrigatórios: captação antiga com 2');
SELECT ok(public.exclusive_required_fields(pg_temp.form(4), '529.982.247-25', 'CRECI 0000'), 'obrigatórios: 4 completos');
SELECT ok(public.exclusive_required_fields(pg_temp.form(35), '529.982.247-25', 'CRECI 0000'), 'obrigatórios: 35 completos');
SELECT ok(NOT public.exclusive_required_fields(
  jsonb_set(pg_temp.form(4), '{proprietarios_extras,1,email}', '""'), '529.982.247-25', 'CRECI 0000'),
  'obrigatórios: 4º sem e-mail é recusado');
SELECT ok(NOT public.exclusive_required_fields(
  jsonb_set(pg_temp.form(35), '{proprietarios_extras,32,cpf}', '" "'), '529.982.247-25', 'CRECI 0000'),
  'obrigatórios: 35º sem CPF é recusado');
SELECT ok(NOT public.exclusive_required_fields(
  jsonb_set(pg_temp.form(2), '{proprietario_2,nome_completo}', '""'), '529.982.247-25', 'CRECI 0000'),
  'obrigatórios: 2º incompleto continua recusado (igual a hoje)');

-- 3) CHECK de exclusive_documents (aceita 1..60; recusa 61; imóvel continua 0)
SELECT ok(pg_get_constraintdef(oid) LIKE '%BETWEEN 1 AND 60%' OR pg_get_constraintdef(oid) LIKE '%>= 1)%<= 60)%',
  'CHECK rg/cpf/cnh aceita 1..60') FROM pg_constraint WHERE conname = 'exclusive_documents_check';
SET LOCAL session_replication_role = replica; -- sem FK/gatilhos: só o CHECK conta (banco só-estrutura)
INSERT INTO public.exclusive_documents(capture_id, kind, owner_index, storage_path, file_name, uploaded_by, organization_id)
  VALUES (gen_random_uuid(), 'rg', 35, 't58/a.pdf', 'rg35.pdf', gen_random_uuid(), gen_random_uuid());
SELECT pass('documento RG do 35º proprietário gravado');
SELECT lives_ok($$INSERT INTO public.exclusive_documents(capture_id, kind, owner_index, storage_path, file_name, uploaded_by, organization_id)
  VALUES (gen_random_uuid(), 'residencia', 60, 't58/b.pdf', 'r.pdf', gen_random_uuid(), gen_random_uuid())$$, 'residência do 60º aceita');
SELECT throws_ok($$INSERT INTO public.exclusive_documents(capture_id, kind, owner_index, storage_path, file_name, uploaded_by, organization_id)
  VALUES (gen_random_uuid(), 'cpf', 61, 't58/c.pdf', 'c.pdf', gen_random_uuid(), gen_random_uuid())$$, '23514', NULL, '61º recusado');
SELECT throws_ok($$INSERT INTO public.exclusive_documents(capture_id, kind, owner_index, storage_path, file_name, uploaded_by, organization_id)
  VALUES (gen_random_uuid(), 'iptu', 3, 't58/d.pdf', 'i.pdf', gen_random_uuid(), gen_random_uuid())$$, '23514', NULL, 'IPTU continua só no imóvel (0)');
SET LOCAL session_replication_role = origin;

-- 4) Funções de servidor usam a lista inteira (definição instalada)
SELECT ok(pg_get_functiondef('public.exclusive_transition(uuid,text,text)'::regprocedure) LIKE '%1..jsonb_array_length(public.exclusive_owner_list(_c.form_data))%',
  'envio ao gestor confere documentos de TODOS os proprietários');
SELECT ok(pg_get_functiondef('public.exclusive_register_document(uuid,text,integer,text,text)'::regprocedure) LIKE '%_owner BETWEEN 1 AND 60%',
  'registro de documento aceita proprietário 1..60');
SELECT ok(pg_get_functiondef('public.minhas_pendencias()'::regprocedure) LIKE '%exclusive_owner_list(caps.form_data)%',
  'Minha Carreira lista pendência de todos os proprietários');
SELECT ok(pg_get_functiondef('public.exclusive_virar_venda(uuid)'::regprocedure) LIKE '%exclusive_owner_list(_c.form_data)) WITH ORDINALITY%',
  'Virou venda leva todos como vendedor_N');

-- 5) Rótulo dos avisos da Clicksign
SELECT is(public.clicksign_papel_por_sha(
  ROW(e.*)::public.clicksign_envelopes, 'h35'), 'Proprietário 35', 'rótulo "Proprietário 35"')
  FROM (SELECT (jsonb_populate_record(NULL::public.clicksign_envelopes,
    jsonb_build_object('signers', jsonb_build_array(jsonb_build_object('papel','proprietario_35','email_sha256','h35'))))).*) e;

SELECT * FROM finish();
ROLLBACK;
