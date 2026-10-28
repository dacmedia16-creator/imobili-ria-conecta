-- Suíte: corretor acompanha a assinatura Clicksign (migration 20261028180000, t_82e51349).
-- Roda DENTRO de transação revertida (run-clicksign-acompanhar-corretor.sh), em banco local
-- descartável ou homologação; nunca em produção. Dados 100% fictícios, criados aqui.
-- Imobiliária A: admin, gestor (líder da equipe), corretor dono (C1), corretor de OUTRA equipe (C2).
-- Imobiliária B: gestor/admin B e corretor B.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;

\set org_a 'a0000000-0000-4000-8000-0000000000a0'
\set org_b 'b0000000-0000-4000-8000-0000000000b0'
\set admin 'a0000000-0000-4000-8000-000000000001'
\set gestor 'a0000000-0000-4000-8000-000000000002'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set c2 'a0000000-0000-4000-8000-000000000005'
\set gb 'b0000000-0000-4000-8000-000000000001'
\set cb 'b0000000-0000-4000-8000-000000000002'
\set team 'a0000000-0000-4000-8000-0000000000f1'
\set team2 'a0000000-0000-4000-8000-0000000000f2'
\set unit 'a0000000-0000-4000-8000-0000000000e1'
\set cap 'c0000000-0000-4000-8000-000000000001'
\set cap_off 'c0000000-0000-4000-8000-000000000002'
\set sale 'e0000000-0000-4000-8000-000000000001'
\set sale_off 'e0000000-0000-4000-8000-000000000002'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-cs-a', 'Imobiliária Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-cs-b', 'Imobiliária Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'captacao_exclusiva', true), (:'org_b', 'captacao_exclusiva', true);
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'c1', :'c2', :'gb', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org_a'),
  (:'gestor', 'Gestor Exemplo', 'gestor@exemplo.test', true, :'org_a'),
  (:'c1', 'Carlos Dono', 'c1@exemplo.test', true, :'org_a'),
  (:'c2', 'Bruno Outra Equipe', 'c2@exemplo.test', true, :'org_a'),
  (:'gb', 'Gestor B', 'gb@exemplo.test', true, :'org_b'),
  (:'cb', 'Corretor B', 'cb@exemplo.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'gestor', true), (:'org_a', :'c1', true), (:'org_a', :'c2', true),
  (:'org_b', :'gb', true), (:'org_b', :'cb', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'gestor', 'gestor', :'org_a'), (:'c1', 'corretor', :'org_a'),
  (:'c2', 'corretor', :'org_a'), (:'gb', 'gestor', :'org_b'), (:'gb', 'admin', :'org_b'), (:'cb', 'corretor', :'org_b');
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES
  (:'team', :'gestor', 'Equipe Exemplo', :'org_a'), (:'team2', :'admin', 'Outra Equipe', :'org_a');
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES
  (:'c1', :'team', :'org_a'), (:'c2', :'team2', :'org_a');
INSERT INTO public.clicksign_org_settings (organization_id, enabled, sale_enabled, test_mode, access_token_secret_id)
  VALUES (:'org_a', true, true, true, gen_random_uuid()), (:'org_b', true, true, true, gen_random_uuid());
INSERT INTO public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)
  VALUES (:'unit', :'org_a', 'Unidade Exemplo', 'J-0001', 'Exemplo Ltda', 'Rua Exemplo, 1', 'Sorocaba', 'SP', '00000000000191', 'Exemplo');
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, manual) VALUES
  (:'cap', :'c1', :'c1', 'remax-padrao', :'unit', 'em_assinatura', '{}', 'Carlos Dono', '11144477735', 'CRECI 1', :'org_a', false),
  (:'cap_off', :'c1', :'c1', 'remax-padrao', :'unit', 'em_assinatura', '{}', 'Carlos Dono', '11144477735', 'CRECI 1', :'org_a', false);
INSERT INTO public.sales (id, corretor_id, organization_id, status) VALUES
  (:'sale', :'c1', :'org_a', 'aguardando_assinatura'), (:'sale_off', :'c1', :'org_a', 'aguardando_assinatura');
INSERT INTO public.clicksign_envelopes (organization_id, origem, capture_id, sale_id, source_document_id,
    envelope_key, document_key, status, is_test, created_by, signers) VALUES
  (:'org_a', 'captacao', :'cap', NULL, gen_random_uuid(), 'env-cap', 'doc-cap', 'running', true, :'gestor',
   '[{"papel":"proprietario_1","nome":"Ana Teste","email_sha256":"x"}]'),
  (:'org_a', 'captacao', :'cap_off', NULL, gen_random_uuid(), 'env-off', 'doc-off', 'closed', true, :'gestor', '[]'),
  (:'org_a', 'venda', NULL, :'sale', gen_random_uuid(), 'env-sale', 'doc-sale', 'running', true, :'gestor', '[]'),
  (:'org_a', 'venda', NULL, :'sale_off', gen_random_uuid(), 'env-soff', 'doc-soff', 'canceled', true, :'gestor', '[]');
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;

-- 1) Corretor dono: lê (captação e venda), sem gerenciar; escrita continua negada -----------------
SELECT pg_temp.as_user(:'c1');
SELECT public.clicksign_capture_view_authorize(:'cap') AS v \gset
SELECT pg_temp.ok((:'v'::jsonb->>'org') = :'org_a' AND (:'v'::jsonb->>'can_manage')::bool = false
  AND (:'v'::jsonb ? 'envelope'), 'captação: corretor dono acompanha (can_manage=false)');
SELECT pg_temp.ok(NOT (:'v'::jsonb ? 'envelope_key') AND NOT (:'v'::jsonb ? 'signers') AND :'v' !~ '@',
  'captação: leitura não devolve chave, signatários nem e-mail (só org/envelope/can_manage)');
SELECT public.clicksign_sale_view_authorize(:'sale') AS sv \gset
SELECT pg_temp.ok((:'sv'::jsonb->>'can_manage')::bool = false AND (:'sv'::jsonb->>'org') = :'org_a',
  'venda: corretor dono acompanha (can_manage=false)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_manage_authorize(%L)', :'cap')) LIKE '%Apenas gestor%',
  'captação: corretor continua SEM gerenciar (reenviar/editar/cancelar)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_manage_authorize(%L)', :'sale')) LIKE '%Apenas gestor%',
  'venda: corretor continua SEM gerenciar');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_reconcile_authorize(%L, %L)', 'captacao', :'cap')) IS NOT NULL,
  'corretor continua SEM "Conferir na Clicksign"');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_view_authorize(%L)', :'cap_off')) LIKE '%Não há contrato em assinatura%',
  'captação: envelope fechado não é lido');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_view_authorize(%L)', :'sale_off')) LIKE '%Não há contrato em assinatura%',
  'venda: envelope cancelado não é lido');

-- 2) Corretor de outra equipe da mesma imobiliária: nada ------------------------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_view_authorize(%L)', :'cap')) LIKE '%Sem acesso%',
  'captação: corretor de OUTRA equipe não vê');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_view_authorize(%L)', :'sale')) LIKE '%Venda não disponível%',
  'venda: corretor de OUTRA equipe não vê');

-- 3) Outra imobiliária (corretor e até gestor/admin B): nada ---------------------------------------
SELECT pg_temp.as_user(:'cb');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_view_authorize(%L)', :'cap')) IS NOT NULL,
  'captação: corretor de OUTRA imobiliária não vê');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_view_authorize(%L)', :'sale')) IS NOT NULL,
  'venda: corretor de OUTRA imobiliária não vê');
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_view_authorize(%L)', :'cap')) IS NOT NULL,
  'captação: gestor/admin de OUTRA imobiliária não vê');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_view_authorize(%L)', :'sale')) IS NOT NULL,
  'venda: gestor/admin de OUTRA imobiliária não vê');

-- 4) Gestor da equipe e admin: leem com can_manage=true e continuam gerenciando -------------------
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok((public.clicksign_capture_view_authorize(:'cap')->>'can_manage')::bool,
  'captação: gestor lê com can_manage=true');
SELECT pg_temp.ok((public.clicksign_sale_view_authorize(:'sale')->>'can_manage')::bool,
  'venda: gestor lê com can_manage=true');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_manage_authorize(%L)', :'cap')) IS NULL,
  'captação: gestor continua gerenciando');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_manage_authorize(%L)', :'sale')) IS NULL,
  'venda: gestor continua gerenciando');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok((public.clicksign_capture_view_authorize(:'cap')->>'can_manage')::bool,
  'captação: admin lê com can_manage=true');

-- 5) anon não executa ------------------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.clicksign_capture_view_authorize(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.clicksign_sale_view_authorize(uuid)', 'EXECUTE'),
  'anon sem EXECUTE nas leituras novas');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
