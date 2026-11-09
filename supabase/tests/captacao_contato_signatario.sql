-- Suíte: contato do proprietário corrigido em captação já enviada (migration 20261109200000, t_867f464c).
-- Roda DENTRO de transação revertida (run-captacao-contato-signatario.sh), em banco local descartável
-- ou homologação; nunca em produção. Dados 100% fictícios, criados aqui.
-- Imobiliária A: admin, gestor (líder da equipe), corretor dono (C1), corretor de OUTRA equipe (C2).
-- Imobiliária B: gestor/admin B e corretor B.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.sha(_e text) RETURNS text LANGUAGE sql AS
  $$ SELECT encode(extensions.digest(_e, 'sha256'), 'hex') $$;

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
\set cap_r 'c0000000-0000-4000-8000-000000000002'
\set env 'd0000000-0000-4000-8000-000000000001'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-ct-a', 'Imobiliária Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-ct-b', 'Imobiliária Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
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
  (:'cap', :'c1', :'c1', 'remax-padrao', :'unit', 'em_assinatura',
   '{"proprietario_1":{"nome_completo":"Luiz Exemplo","email":"antigo@exemplo.test","telefone_1":"(15) 3333-1111"},
     "proprietario_2":{"nome_completo":"Maria Exemplo","email":"maria@exemplo.test","telefone_1":"(15) 3333-2222"},
     "proprietarios_extras":[{"nome_completo":"Pedro Exemplo","email":"pedro@exemplo.test","telefone_1":"(15) 3333-3333"}],
     "imovel":{"endereco":"Rua Teste, 10"}}',
   'Carlos Dono', '11144477735', 'CRECI 1', :'org_a', false),
  (:'cap_r', :'c1', :'c1', 'remax-padrao', :'unit', 'rascunho',
   '{"proprietario_1":{"nome_completo":"Luiz Exemplo","email":"antigo@exemplo.test"}}',
   'Carlos Dono', '11144477735', 'CRECI 1', :'org_a', false);
INSERT INTO public.clicksign_envelopes (id, organization_id, origem, capture_id, source_document_id,
    envelope_key, document_key, status, is_test, created_by, signers) VALUES
  (:'env', :'org_a', 'captacao', :'cap', gen_random_uuid(), 'env-cap', 'doc-cap', 'running', true, :'gestor',
   jsonb_build_array(
     jsonb_build_object('papel','proprietario_1','nome','Luiz Exemplo','email_sha256', pg_temp.sha('antigo@exemplo.test')),
     jsonb_build_object('papel','proprietario_2','nome','Maria Exemplo','email_sha256', pg_temp.sha('maria@exemplo.test')),
     jsonb_build_object('papel','proprietario_3','nome','Pedro Exemplo','email_sha256', pg_temp.sha('pedro@exemplo.test')),
     jsonb_build_object('papel','testemunha','nome','Tânia Testemunha','email_sha256', pg_temp.sha('tania@exemplo.test'), 'cadastro', true)));
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;

-- 1) Corretor dono, sem permissão no envelope: grava na captação e avisa o gestor -------------------
SELECT pg_temp.as_user(:'c1');
SELECT public.exclusive_contato_assinatura_salvar(:'cap', 1, '  Novo.Certo@Exemplo.test ', '(15) 99999-0000') AS a \gset
SELECT pg_temp.ok((:'a'::jsonb->>'mudou')::bool AND NOT (:'a'::jsonb->>'pode_aplicar')::bool
  AND (:'a'::jsonb->>'precisa_aplicar')::bool AND (:'a'::jsonb->>'envelope_ativo')::bool,
  'corretor: grava, não pode aplicar, precisa aplicar (envelope ainda com o e-mail antigo)');
SELECT pg_temp.ok((:'a'::jsonb->>'avisados')::int = 1, 'corretor: 1 aviso (o líder da equipe)');
RESET ROLE;
SELECT pg_temp.ok(form_data#>>'{proprietario_1,email}' = 'novo.certo@exemplo.test'
  AND form_data#>>'{proprietario_1,telefone_1}' = '(15) 99999-0000'
  AND form_data#>>'{proprietario_1,nome_completo}' = 'Luiz Exemplo'
  AND form_data#>>'{proprietario_2,email}' = 'maria@exemplo.test'
  AND form_data#>>'{imovel,endereco}' = 'Rua Teste, 10'
  AND status = 'em_assinatura',
  'captação: só e-mail/telefone do proprietário 1 mudam (normalizado), status segue em_assinatura')
  FROM public.exclusive_captures WHERE id = :'cap';
SELECT pg_temp.ok(signers->0->>'email_sha256' = pg_temp.sha('antigo@exemplo.test'),
  'envelope NÃO é alterado pela correção na captação') FROM public.clicksign_envelopes WHERE id = :'env';
SELECT pg_temp.ok(count(*) = 1 AND bool_and(detail LIKE 'Proprietário 1: e-mail a***@exemplo.test → n***@exemplo.test; telefone ***1111 → ***0000%gestor avisado%')
  AND bool_and(detail !~ 'antigo@|novo\.certo@|99999'),
  'histórico contato_corrigido mascarado (sem e-mail/telefone completos)')
  FROM public.exclusive_history WHERE capture_id = :'cap' AND action = 'contato_corrigido';
SELECT pg_temp.ok(count(*) = 1 AND bool_and(user_id = :'gestor') AND bool_and(mensagem !~ '@')
  AND bool_and(mensagem LIKE '%Aplicar na Clicksign%'),
  'aviso no sino só para o gestor líder, sem e-mail no texto')
  FROM public.notifications WHERE exclusive_capture_id = :'cap' AND tipo = 'captacao_contato_assinatura';
SET LOCAL ROLE authenticated;

-- 2) Mesmo contato de novo: nada muda, sem novo histórico/aviso ---------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT public.exclusive_contato_assinatura_salvar(:'cap', 1, 'novo.certo@exemplo.test', NULL) AS a2 \gset
SELECT pg_temp.ok(NOT (:'a2'::jsonb->>'mudou')::bool AND (:'a2'::jsonb->>'precisa_aplicar')::bool,
  'repetido: mudou=false, mas continua avisando que falta aplicar');
-- 3) Validações -------------------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contato_assinatura_salvar(%L, 1, %L)', :'cap', 'sem-arroba')) LIKE '%E-mail inválido%',
  'e-mail inválido recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contato_assinatura_salvar(%L, 1, %L, %L)', :'cap', 'a@exemplo.test', '123')) LIKE '%Telefone inválido%',
  'telefone inválido recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contato_assinatura_salvar(%L, 4, %L)', :'cap', 'a@exemplo.test')) LIKE '%Proprietário inválido%',
  'proprietário inexistente recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contato_assinatura_salvar(%L, 1, %L)', :'cap_r', 'a@exemplo.test')) LIKE '%Só captação em assinatura%',
  'rascunho continua no formulário (recusado aqui)');
-- 4) Proprietário 3 (extras) -------------------------------------------------------------------------
SELECT public.exclusive_contato_assinatura_salvar(:'cap', 3, 'pedro.novo@exemplo.test') AS a3 \gset
RESET ROLE;
SELECT pg_temp.ok(form_data#>>'{proprietarios_extras,0,email}' = 'pedro.novo@exemplo.test'
  AND form_data#>>'{proprietarios_extras,0,telefone_1}' = '(15) 3333-3333'
  AND jsonb_array_length(form_data->'proprietarios_extras') = 1,
  'proprietário 3 (extras): grava no lugar certo e mantém o telefone')
  FROM public.exclusive_captures WHERE id = :'cap';
SET LOCAL ROLE authenticated;

-- 5) Quem não vê a captação: nada ---------------------------------------------------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contato_assinatura_salvar(%L, 2, %L)', :'cap', 'x@exemplo.test')) LIKE '%Captação não disponível%',
  'corretor de OUTRA equipe não corrige');
SELECT pg_temp.as_user(:'cb');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contato_assinatura_salvar(%L, 2, %L)', :'cap', 'x@exemplo.test')) IS NOT NULL,
  'corretor de OUTRA imobiliária não corrige');
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contato_assinatura_salvar(%L, 2, %L)', :'cap', 'x@exemplo.test')) IS NOT NULL,
  'gestor/admin de OUTRA imobiliária não corrige');

-- 6) Gestor: pode aplicar, ninguém é avisado ---------------------------------------------------------
SELECT pg_temp.as_user(:'gestor');
SELECT public.exclusive_contato_assinatura_salvar(:'cap', 2, 'maria.nova@exemplo.test') AS g \gset
SELECT pg_temp.ok((:'g'::jsonb->>'pode_aplicar')::bool AND (:'g'::jsonb->>'precisa_aplicar')::bool
  AND (:'g'::jsonb->>'avisados')::int = 0, 'gestor: pode aplicar e não gera aviso');

-- 7) clicksign_capture_signer_sync (Clicksign → captação) -------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_signer_sync(%L, 0, %L, %L)', :'env', 'x@exemplo.test', :'gestor')) IS NOT NULL,
  'sync: authenticated não executa');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_signer_sync(%L, 0, %L, %L)', :'env', 'qualquer@exemplo.test', :'gestor')) LIKE '%E-mail diferente do envelope%',
  'sync: recusa e-mail que não é o do envelope');
SELECT pg_temp.ok(public.clicksign_capture_signer_sync(:'env', 3, 'tania@exemplo.test', :'gestor') = 'nao_proprietario',
  'sync: testemunha não mexe na captação');
RESET ROLE;
-- Simula o que a edge grava (clicksign_manage_done) depois da troca na Clicksign: e-mail digitado no "Editar".
UPDATE public.clicksign_envelopes SET signers = jsonb_set(signers, '{0,email_sha256}', to_jsonb(pg_temp.sha('digitado@exemplo.test')))
  WHERE id = :'env';
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.clicksign_capture_signer_sync(:'env', 0, ' Digitado@Exemplo.test', :'gestor') = 'ok',
  'sync: e-mail igual ao do envelope é copiado para a captação');
SELECT pg_temp.ok(public.clicksign_capture_signer_sync(:'env', 0, 'digitado@exemplo.test', :'gestor') = 'igual',
  'sync: repetido não grava de novo');
RESET ROLE;
SELECT pg_temp.ok(form_data#>>'{proprietario_1,email}' = 'digitado@exemplo.test'
  AND form_data#>>'{proprietario_1,telefone_1}' = '(15) 99999-0000',
  'captação agora igual ao envelope (telefone preservado)')
  FROM public.exclusive_captures WHERE id = :'cap';
SELECT pg_temp.ok(count(*) = 1, 'sync registra 1 histórico "captação atualizada pela troca na Clicksign"')
  FROM public.exclusive_history WHERE capture_id = :'cap' AND action = 'contato_corrigido'
   AND detail LIKE '%atualizada pela troca na Clicksign%';

-- 8) Envelope já igual ao novo: precisa_aplicar=false -------------------------------------------------
SELECT count(*) AS avisos_antes FROM public.notifications
  WHERE exclusive_capture_id = :'cap' AND tipo = 'captacao_contato_assinatura' \gset
SELECT pg_temp.ok(:'avisos_antes'::int = 2, 'passos 1 e 4 (corretor, falta aplicar) geraram 1 aviso cada');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT public.exclusive_contato_assinatura_salvar(:'cap', 1, 'digitado@exemplo.test', '(15) 98888-0000') AS a8 \gset
SELECT pg_temp.ok((:'a8'::jsonb->>'mudou')::bool AND NOT (:'a8'::jsonb->>'precisa_aplicar')::bool,
  'só telefone mudou com e-mail igual ao envelope: não precisa aplicar');
RESET ROLE;
SELECT pg_temp.ok(count(*) = :'avisos_antes'::int, 'sem aviso extra ao gestor quando não precisa aplicar')
  FROM public.notifications WHERE exclusive_capture_id = :'cap' AND tipo = 'captacao_contato_assinatura';

-- 9) Permissões ----------------------------------------------------------------------------------------
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.exclusive_contato_assinatura_salvar(uuid,integer,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.clicksign_capture_signer_sync(uuid,integer,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.clicksign_capture_signer_sync(uuid,integer,text,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.exclusive_contato_assinatura_salvar(uuid,integer,text,text)', 'EXECUTE'),
  'grants: anon nada; sync só service_role');
SELECT pg_temp.ok(count(*) = 2 AND bool_and(prosecdef) AND bool_and(proconfig @> ARRAY['search_path=""']),
  'SECURITY DEFINER com search_path vazio')
  FROM pg_proc WHERE proname IN ('exclusive_contato_assinatura_salvar','clicksign_capture_signer_sync');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
