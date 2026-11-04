-- Suíte: captador SEM CRECI (migration 20261104120000, t_e75b58c5).
-- Roda DENTRO de transação revertida (run-captacao-corretor-sem-creci.sh), em banco local descartável
-- ou homologação; nunca em produção. Dados 100% fictícios, criados aqui.
-- Imobiliária A: gestor G (líder T1, com CRECI), TL (team leader, com CRECI), G2 (gestor sem CPF/CRECI),
--   corretores c1 (T1, sem CRECI no cadastro), c2 (T1). Imobiliária B: gestor GB sem CRECI, corretor CB.
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
\set g  'a0000000-0000-4000-8000-000000000002'
\set tl 'a0000000-0000-4000-8000-000000000003'
\set g2 'a0000000-0000-4000-8000-000000000006'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set c2 'a0000000-0000-4000-8000-000000000005'
\set gb 'b0000000-0000-4000-8000-000000000001'
\set cb 'b0000000-0000-4000-8000-000000000002'
\set t1 'a0000000-0000-4000-8000-0000000000f1'
\set t2 'a0000000-0000-4000-8000-0000000000f2'
\set tb 'b0000000-0000-4000-8000-0000000000f1'
\set unit 'a0000000-0000-4000-8000-0000000000e1'
\set unitb 'b0000000-0000-4000-8000-0000000000e1'
\set capc 'c0000000-0000-4000-8000-000000000001'
\set caps 'c0000000-0000-4000-8000-000000000002'
\set capb 'c0000000-0000-4000-8000-000000000003'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-sc-a', 'Imobiliária Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-sc-b', 'Imobiliária Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'captacao_exclusiva', true), (:'org_b', 'captacao_exclusiva', true);
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'g', :'tl', :'g2', :'c1', :'c2', :'gb', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, cpf, creci, ativo, organization_id) VALUES
  (:'g',  'Gina Gestora',    'gina@exemplo.test',  '52998224725', '12345-F', true, :'org_a'),
  (:'tl', 'Tiago Lider',     'tiago@exemplo.test', '39053344705', '67890-F', true, :'org_a'),
  (:'g2', 'Gustavo Semcpf',  'gus@exemplo.test',   NULL,          NULL,      true, :'org_a'),
  (:'c1', 'Carla Semcreci',  'c1@exemplo.test',    '11144477735', NULL,      true, :'org_a'),
  (:'c2', 'Caio Comcreci',   'c2@exemplo.test',    '12345678909', '55555-F', true, :'org_a'),
  (:'gb', 'Gestor Bee',      'gb@exemplo.test',    '52998224725', NULL,      true, :'org_b'),
  (:'cb', 'Corretor Bee',    'cb@exemplo.test',    '11144477735', NULL,      true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'g', true), (:'org_a', :'tl', true), (:'org_a', :'g2', true), (:'org_a', :'c1', true),
  (:'org_a', :'c2', true), (:'org_b', :'gb', true), (:'org_b', :'cb', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'g', 'gestor', :'org_a'), (:'tl', 'team_leader', :'org_a'), (:'g2', 'gestor', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'),
  (:'gb', 'gestor', :'org_b'), (:'cb', 'corretor', :'org_b');
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES
  (:'t1', :'g', 'Equipe Um', :'org_a'), (:'t2', :'tl', 'Equipe Dois', :'org_a'),
  (:'tb', :'gb', 'Equipe Bee', :'org_b');
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES
  (:'c1', :'t1', :'org_a'), (:'c2', :'t1', :'org_a'), (:'cb', :'tb', :'org_b');
INSERT INTO public.clicksign_org_settings (organization_id, enabled, sale_enabled, test_mode, access_token_secret_id)
  VALUES (:'org_a', true, false, true, gen_random_uuid());
INSERT INTO public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)
  VALUES (:'unit', :'org_a', 'Unidade Exemplo', 'J-0001', 'Exemplo Ltda', 'Rua Exemplo, 1', 'Sorocaba', 'SP', '00000000000191', 'Exemplo'),
         (:'unitb', :'org_b', 'Unidade Bee', 'J-0002', 'Bee Ltda', 'Rua Bee, 1', 'Sorocaba', 'SP', '00000000000272', 'Bee');
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, manual) VALUES
  (:'capc', :'c2', :'c2', 'remax-padrao', :'unit', 'enviada', '{}', 'Caio Comcreci', '12345678909', '55555-F', :'org_a', false),
  (:'caps', :'c1', :'c1', 'remax-padrao', :'unit', 'enviada', '{}', 'Carla Semcreci', '11144477735', '', :'org_a', false),
  (:'capb', :'cb', :'cb', 'remax-padrao', :'unitb', 'enviada', '{}', 'Corretor Bee', '11144477735', '', :'org_b', false);
INSERT INTO public.exclusive_documents (capture_id, kind, storage_path, file_name, uploaded_by, organization_id, created_at)
  VALUES (:'capc', 'gerado', 'x/capc.pdf', 'capc.pdf', :'g', :'org_a', now() - interval '1 minute'),
         (:'caps', 'gerado', 'x/caps.pdf', 'caps.pdf', :'g', :'org_a', now() - interval '1 minute');
SET LOCAL session_replication_role = origin;

-- 0) Envio ao gestor: CRECI do captador vazio passa; preenchido inválido continua recusado ------------
SELECT jsonb_build_object(
  'imovel', jsonb_build_object('tipo_imovel','Casa','endereco','Rua X, 1','bairro','B','municipio','Sorocaba',
    'estado','SP','classificacao_fiscal_iptu','1','numero_matricula','1','cartorio_registro','1','valor_imovel','1'),
  'proprietario_1', jsonb_build_object('nome_completo','Ana Exemplo','rg','1','cpf','1','endereco_completo','R',
    'nacionalidade','b','estado_civil','s','email','a@exemplo.test','telefone_1','1'),
  'condicoes', jsonb_build_object('prazo_dias_numero','90','prazo_dias_extenso','noventa','prazo_dias_uteis_numero','5',
    'prazo_dias_uteis_extenso','cinco','comissao_percentual_numero','6','comissao_percentual_extenso','seis',
    'foro_comarca','Sorocaba','foro_estado','SP')) AS f \gset
SELECT pg_temp.ok(public.exclusive_required_fields(:'f'::jsonb, '11144477735', '')
  AND public.exclusive_required_fields(:'f'::jsonb, '11144477735', '12345-F')
  AND NOT public.exclusive_required_fields(:'f'::jsonb, '11144477735', '#x')
  AND NOT public.exclusive_required_fields(:'f'::jsonb, '', '12345-F'),
  'envio: CRECI vazio aceito (sem CRECI); CRECI inválido e CPF vazio continuam recusados');

-- 1) Captador COM CRECI: igual a antes -----------------------------------------------------------
SELECT public.exclusive_testemunhas_resolver(:'capc') AS rc \gset
SELECT pg_temp.ok(:'rc'::jsonb->>'modo' = 'padrao' AND NOT (:'rc'::jsonb ? 'contrato')
  AND (:'rc'::jsonb->'corretor'->>'id') = :'c2' AND (:'rc'::jsonb->'gestor'->>'id') = :'g'
  AND (:'rc'::jsonb->'gestor'->>'origem') = 'equipe' AND (:'rc'::jsonb->>'ok')::bool
  AND (:'rc'::jsonb->>'dados') = public.exclusive_testemunhas_assinatura(:'rc'::jsonb->'corretor', :'rc'::jsonb->'gestor'),
  'com CRECI: testemunha 1 = corretor, 2 = gestor da equipe, sem bloco contrato, mesma impressão digital de antes');

-- 2) Captador SEM CRECI: contrato = líder da equipe; testemunha 2 digitada obrigatória ------------
SELECT public.exclusive_testemunhas_resolver(:'caps') AS rs \gset
SELECT pg_temp.ok(:'rs'::jsonb->>'modo' = 'sem_creci'
  AND (:'rs'::jsonb->'contrato'->>'id') = :'g' AND (:'rs'::jsonb->'contrato'->>'creci') = '12345-F'
  AND (:'rs'::jsonb->'contrato'->>'cpf') = '52998224725' AND (:'rs'::jsonb->'contrato'->>'origem') = 'equipe'
  AND (:'rs'::jsonb->'contrato'->>'ok')::bool,
  'sem CRECI: corretor do contrato = gestor da equipe, com CRECI e CPF');
SELECT pg_temp.ok((:'rs'::jsonb->'corretor'->>'id') = :'c1' AND jsonb_typeof(:'rs'::jsonb->'gestor') = 'null'
  AND NOT (:'rs'::jsonb->>'ok')::bool AND :'rs' LIKE '%testemunha 2 é digitada%',
  'sem CRECI: captador = testemunha 1; sem testemunha 2 digitada bloqueia com aviso');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'g');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_2_manual_salvar(%L, %L, %L, %L)',
  :'caps', 'Gina Gestora', '52998224725', 'outra@exemplo.test')) LIKE '%corretor do contrato%',
  'testemunha 2 com o CPF do corretor do contrato: recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_2_manual_salvar(%L, %L, %L, %L)',
  :'caps', 'Outro Nome', '39053344705', 'gina@exemplo.test')) LIKE '%corretor do contrato%',
  'testemunha 2 com o e-mail do corretor do contrato: recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_2_manual_salvar(%L, %L, %L, %L)',
  :'caps', 'Carla Semcreci', '111.444.777-35', 'x@exemplo.test')) LIKE '%testemunha 1%',
  'testemunha 2 = captador (CPF com máscara): recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_2_manual_salvar(%L, %L, %L, %L)',
  :'caps', 'Joao', '12345678900', 'sem-arroba')) ~ 'nome com sobrenome.*CPF válido.*e-mail válido',
  'testemunha 2 sem sobrenome, CPF inválido e e-mail inválido: recusada dizendo o que falta');
SELECT public.exclusive_testemunha_2_manual_salvar(:'caps', '  Paula   Exemplo ', '987.654.321-00', 'Paula@Exemplo.test') AS m1 \gset
SELECT pg_temp.ok((:'m1'::jsonb->>'ok')::bool AND (:'m1'::jsonb->'gestor'->>'origem') = 'manual'
  AND (:'m1'::jsonb->'gestor'->>'nome') = 'Paula Exemplo' AND (:'m1'::jsonb->'gestor'->>'cpf') = '98765432100'
  AND NOT (:'m1'::jsonb->'gestor' ? 'email') AND (:'m1'::jsonb->'manual'->>'email') = 'paula@exemplo.test',
  'testemunha 2 digitada válida: normalizada, completa; quem gere vê o que digitou');
RESET ROLE;
SELECT public.exclusive_testemunhas_resolver(:'caps') AS rs2 \gset
SELECT pg_temp.ok((:'rs2'::jsonb->'gestor'->>'email') = 'paula@exemplo.test' AND (:'rs2'::jsonb->>'ok')::bool,
  'servidor (edge) recebe o e-mail da testemunha 2 digitada para a Clicksign');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_history WHERE capture_id = :'caps'
  AND action = 'testemunha_digitada' AND detail = 'Testemunha 2 digitada: Paula Exemplo') = 1
  AND NOT EXISTS (SELECT 1 FROM public.exclusive_history WHERE capture_id = :'caps' AND detail ~ '98765432100|paula@'),
  'histórico registra só o nome da testemunha digitada (sem CPF nem e-mail)');

-- 3) Troca do corretor do contrato pelo staff -------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'g');
SELECT string_agg(id::text || ':' || ok::text, ',' ORDER BY id) AS cand FROM public.exclusive_contrato_candidatos(:'caps') \gset
SELECT pg_temp.ok(:'cand' LIKE '%' || :'g' || ':true%' AND :'cand' LIKE '%' || :'tl' || ':true%'
  AND :'cand' LIKE '%' || :'g2' || ':false%' AND :'cand' NOT LIKE '%' || :'c1' || '%'
  AND :'cand' NOT LIKE '%' || :'gb' || '%' AND :'cand' NOT LIKE '%' || :'c2' || '%',
  'candidatos: só gestor/TL da mesma imobiliária; sem CRECI aparece bloqueado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contrato_corretor_escolher(%L, %L)', :'caps', :'g2'))
  LIKE '%CRECI no cadastro%', 'escolher gestor sem CRECI: recusado com o que falta');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contrato_corretor_escolher(%L, %L)', :'caps', :'gb'))
  LIKE '%desta imobiliária%', 'escolher gestor de outra imobiliária: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contrato_corretor_escolher(%L, %L)', :'caps', :'c2'))
  LIKE '%desta imobiliária%', 'escolher corretor comum (com CRECI, sem papel de gestor/TL): recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contrato_corretor_escolher(%L, %L)', :'caps', :'c1'))
  LIKE '%captador não tem CRECI%', 'escolher o próprio captador: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contrato_corretor_escolher(%L, %L)', :'capc', :'tl'))
  LIKE '%tem CRECI%', 'captador com CRECI: não há troca de corretor do contrato');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_2_manual_salvar(%L, %L, %L, %L)', :'capc', 'Paula Exemplo', '98765432100', 'p@exemplo.test'))
  LIKE '%tem CRECI%', 'captador com CRECI: testemunha digitada não se aplica');

-- 4) PDF fixado e troca depois ---------------------------------------------------------------------
SELECT public.exclusive_testemunhas(:'caps') AS ts \gset
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunhas_fixar(%L, %L, NULL, %L, %L)',
  :'caps', :'c1', 'x/caps.pdf', :'ts'::jsonb->>'dados')) IS NULL, 'fixar PDF do modo sem CRECI: ok');
RESET ROLE;
SELECT pg_temp.ok((public.exclusive_testemunhas_resolver(:'caps')->>'pdf_ok')::bool
  AND (SELECT (testemunhas_pdf->>'contrato_id')::uuid = :'g' FROM public.exclusive_captures WHERE id = :'caps'),
  'depois de fixar: pdf_ok=true e o corretor do contrato registrado');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'g');
SELECT public.exclusive_contrato_corretor_escolher(:'caps', :'tl') AS e1 \gset
SELECT pg_temp.ok((:'e1'::jsonb->'contrato'->>'id') = :'tl' AND (:'e1'::jsonb->'contrato'->>'origem') = 'escolhido'
  AND (:'e1'::jsonb->>'contrato_escolhido')::bool AND (:'e1'::jsonb->>'ok')::bool AND NOT (:'e1'::jsonb->>'pdf_ok')::bool,
  'staff troca o corretor do contrato por TL com CRECI: completo, mas o PDF antigo deixa de valer');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunhas_fixar(%L, %L, NULL, %L, %L)',
  :'caps', :'c1', 'x/caps.pdf', :'ts'::jsonb->>'dados')) LIKE '%mudaram%',
  'fixar com a impressão digital antiga (outro corretor do contrato): recusado');
SELECT public.exclusive_contrato_corretor_escolher(:'caps', NULL) AS e2 \gset
SELECT pg_temp.ok((:'e2'::jsonb->'contrato'->>'id') = :'g' AND NOT (:'e2'::jsonb->>'contrato_escolhido')::bool,
  'voltar ao gestor da equipe');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_history WHERE capture_id = :'caps'
  AND action = 'contrato_corretor_escolhido') = 2, 'troca do corretor do contrato registrada no histórico');
-- CRECI do líder some do cadastro depois do PDF: bloqueia e oferece trocar
UPDATE public.profiles SET creci = NULL WHERE id = :'g';
SELECT public.exclusive_testemunhas_resolver(:'caps') AS rs3 \gset
SELECT pg_temp.ok(NOT (:'rs3'::jsonb->>'ok')::bool AND :'rs3' LIKE '%CRECI no cadastro%escolha outro%',
  'líder sem CRECI e TL com CRECI disponível: bloqueia pedindo completar ou trocar');
-- Testemunha digitada não pode ficar igual ao novo corretor do contrato
UPDATE public.exclusive_captures SET testemunha_2_manual = '{"nome":"Tiago Lider","cpf":"39053344705","email":"t2@exemplo.test"}' WHERE id = :'caps';
UPDATE public.exclusive_captures SET contrato_corretor_id = :'tl' WHERE id = :'caps';
SELECT public.exclusive_testemunhas_resolver(:'caps') AS rs4 \gset
SELECT pg_temp.ok(NOT (:'rs4'::jsonb->>'ok')::bool AND :'rs4' LIKE '%não pode ser o corretor do contrato%',
  'testemunha 2 que vira o corretor do contrato depois: resolvedor bloqueia (servidor, não só a tela)');
UPDATE public.profiles SET creci = '12345-F' WHERE id = :'g';

-- 5) Nenhum gestor/TL com CRECI: bloqueia (nunca contrato sem CRECI) ---------------------------------
SELECT public.exclusive_testemunhas_resolver(:'capb') AS rb \gset
SELECT pg_temp.ok(NOT (:'rb'::jsonb->>'ok')::bool AND :'rb' LIKE '%nenhum gestor ou team leader desta imobiliária tem CRECI%'
  AND (:'rb'::jsonb->'contrato'->>'id') = :'gb' AND NOT (:'rb'::jsonb->'contrato'->>'ok')::bool,
  'nenhum gestor/TL com CRECI: bloqueio com mensagem clara');

-- 6) Permissões e isolamento ------------------------------------------------------------------------
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.exclusive_contrato_corretor_pessoa(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.exclusive_contrato_editavel(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.exclusive_contrato_candidatos(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.exclusive_contrato_corretor_escolher(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.exclusive_testemunha_2_manual_salvar(uuid,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.exclusive_testemunhas_resolver(uuid)', 'EXECUTE'),
  'funções internas só para service_role; anon sem EXECUTE nas da tela');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contrato_corretor_escolher(%L, %L)', :'caps', :'gb')) LIKE '%Apenas%'
  AND pg_temp.err(format('SELECT public.exclusive_testemunha_2_manual_salvar(%L, %L, %L, %L)', :'caps', 'Xis Ypsilon', '98765432100', 'x@exemplo.test')) LIKE '%Apenas%'
  AND pg_temp.err(format('SELECT * FROM public.exclusive_contrato_candidatos(%L)', :'caps')) LIKE '%Apenas%',
  'gestor de outra imobiliária não escolhe, não digita, não lista');
SELECT pg_temp.as_user(:'c1');
SELECT public.exclusive_testemunhas(:'caps') AS tc \gset
SELECT pg_temp.ok(:'tc' !~ '@' AND NOT (:'tc'::jsonb ? 'manual') AND NOT (:'tc'::jsonb->'contrato' ? 'cpf')
  AND NOT (:'tc'::jsonb->'gestor' ? 'cpf') AND NOT (:'tc'::jsonb->>'pode_gerir')::bool,
  'captador vê o resumo sem e-mail, sem CPF e sem os dados digitados');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_2_manual_salvar(%L, %L, %L, %L)', :'caps', 'Xis Ypsilon', '98765432100', 'x@exemplo.test')) LIKE '%Apenas%'
  AND pg_temp.err(format('SELECT public.exclusive_contrato_corretor_escolher(%L, %L)', :'caps', :'tl')) LIKE '%Apenas%',
  'captador não digita testemunha nem escolhe o corretor do contrato');
RESET ROLE;

-- 7) Dono no sistema continua o captador; transferência zera as escolhas -----------------------------
SELECT pg_temp.ok((SELECT captor_id = :'c1' AND broker_name = 'Carla Semcreci' FROM public.exclusive_captures WHERE id = :'caps'),
  'captação continua do captador (dono e nome no sistema inalterados)');
UPDATE public.exclusive_captures SET captor_id = :'c2' WHERE id = :'caps';
SELECT pg_temp.ok((SELECT contrato_corretor_id IS NULL AND testemunha_2_manual IS NULL AND testemunhas_pdf IS NULL
  FROM public.exclusive_captures WHERE id = :'caps'), 'transferência: corretor do contrato e testemunha digitada zerados');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
