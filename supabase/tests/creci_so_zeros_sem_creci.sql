-- Suíte: CRECI só zeros = SEM CRECI (migration 20261104140000, t_77132312).
-- Roda DENTRO de transação revertida (run-creci-so-zeros.sh), em banco local descartável; nunca em
-- produção. Dados 100% fictícios, criados aqui.
-- Imobiliária A: gestor G (líder T1, CRECI real), TL (CRECI real), GZ (gestor, CRECI "0000000000"),
--   corretores cz (T1, CRECI "0000000000"), cr (T1, CRECI real). Imobiliária B: gestor GBZ com CRECI
--   "00000-F" (único gestor/TL), corretor CBZ com "0".
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;

\set org_a 'a1000000-0000-4000-8000-0000000000a0'
\set org_b 'b1000000-0000-4000-8000-0000000000b0'
\set g   'a1000000-0000-4000-8000-000000000002'
\set tl  'a1000000-0000-4000-8000-000000000003'
\set gz  'a1000000-0000-4000-8000-000000000006'
\set cz  'a1000000-0000-4000-8000-000000000004'
\set cr  'a1000000-0000-4000-8000-000000000005'
\set gbz 'b1000000-0000-4000-8000-000000000001'
\set cbz 'b1000000-0000-4000-8000-000000000002'
\set t1  'a1000000-0000-4000-8000-0000000000f1'
\set t2  'a1000000-0000-4000-8000-0000000000f2'
\set tb  'b1000000-0000-4000-8000-0000000000f1'
\set unit  'a1000000-0000-4000-8000-0000000000e1'
\set unitb 'b1000000-0000-4000-8000-0000000000e1'
\set capr  'c1000000-0000-4000-8000-000000000001'
\set capz  'c1000000-0000-4000-8000-000000000002'
\set capz1 'c1000000-0000-4000-8000-000000000004'
\set capz2 'c1000000-0000-4000-8000-000000000005'
\set capb  'c1000000-0000-4000-8000-000000000003'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-cz-a', 'Imobiliária Zeros A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-cz-b', 'Imobiliária Zeros B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'captacao_exclusiva', true), (:'org_b', 'captacao_exclusiva', true);
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'g', :'tl', :'gz', :'cz', :'cr', :'gbz', :'cbz']::uuid[]);
INSERT INTO public.profiles (id, nome, email, cpf, creci, ativo, organization_id) VALUES
  (:'g',   'Gina Gestora',   'gina@exemplo.test', '52998224725', '12345-F',    true, :'org_a'),
  (:'tl',  'Tiago Lider',    'tiago@exemplo.test','39053344705', '67890-F',    true, :'org_a'),
  (:'gz',  'Gabi Zerada',    'gz@exemplo.test',   '12345678909', '0000000000', true, :'org_a'),
  (:'cz',  'Silvia Zerada',  'cz@exemplo.test',   '11144477735', '0000000000', true, :'org_a'),
  (:'cr',  'Caio Comcreci',  'cr@exemplo.test',   '98765432100', '55555-F',    true, :'org_a'),
  (:'gbz', 'Gestor Zerado',  'gbz@exemplo.test',  '52998224725', '00000-F',    true, :'org_b'),
  (:'cbz', 'Corretor Bee',   'cbz@exemplo.test',  '11144477735', '0000',       true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'g', true), (:'org_a', :'tl', true), (:'org_a', :'gz', true), (:'org_a', :'cz', true),
  (:'org_a', :'cr', true), (:'org_b', :'gbz', true), (:'org_b', :'cbz', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'g', 'gestor', :'org_a'), (:'tl', 'team_leader', :'org_a'), (:'gz', 'gestor', :'org_a'),
  (:'cz', 'corretor', :'org_a'), (:'cr', 'corretor', :'org_a'),
  (:'gbz', 'gestor', :'org_b'), (:'cbz', 'corretor', :'org_b');
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES
  (:'t1', :'g', 'Equipe Um', :'org_a'), (:'t2', :'gz', 'Equipe Zerada', :'org_a'),
  (:'tb', :'gbz', 'Equipe Bee', :'org_b');
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES
  (:'cz', :'t1', :'org_a'), (:'cr', :'t1', :'org_a'), (:'cbz', :'tb', :'org_b');
INSERT INTO public.clicksign_org_settings (organization_id, enabled, sale_enabled, test_mode, access_token_secret_id)
  VALUES (:'org_a', true, false, true, gen_random_uuid());
INSERT INTO public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)
  VALUES (:'unit', :'org_a', 'Unidade Exemplo', 'J-0001', 'Exemplo Ltda', 'Rua Exemplo, 1', 'Sorocaba', 'SP', '00000000000191', 'Exemplo'),
         (:'unitb', :'org_b', 'Unidade Bee', 'J-0002', 'Bee Ltda', 'Rua Bee, 1', 'Sorocaba', 'SP', '00000000000272', 'Bee');
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, manual) VALUES
  (:'capr',  :'cr',  :'cr',  'remax-padrao', :'unit',  'enviada', '{}', 'Caio Comcreci', '98765432100', '55555-F',    :'org_a', false),
  (:'capz',  :'cz',  :'cz',  'remax-padrao', :'unit',  'enviada', '{}', 'Silvia Zerada', '11144477735', '0000000000', :'org_a', false),
  (:'capz1', :'cz',  :'cz',  'remax-padrao', :'unit',  'enviada', '{}', 'Silvia Zerada', '11144477735', '0',          :'org_a', false),
  (:'capz2', :'cz',  :'cz',  'remax-padrao', :'unit',  'enviada', '{}', 'Silvia Zerada', '11144477735', '000-0',      :'org_a', false),
  (:'capb',  :'cbz', :'cbz', 'remax-padrao', :'unitb', 'enviada', '{}', 'Corretor Bee',  '11144477735', '0000',       :'org_b', false);
INSERT INTO public.exclusive_documents (capture_id, kind, storage_path, file_name, uploaded_by, organization_id, created_at)
  VALUES (:'capr', 'gerado', 'x/capr.pdf', 'capr.pdf', :'g', :'org_a', now() - interval '1 minute'),
         (:'capz', 'gerado', 'x/capz.pdf', 'capz.pdf', :'g', :'org_a', now() - interval '1 minute');
SET LOCAL session_replication_role = origin;

-- 0) Função única ------------------------------------------------------------------------------------
SELECT pg_temp.ok(public.creci_real(NULL) IS NULL AND public.creci_real('') IS NULL AND public.creci_real('   ') IS NULL
  AND public.creci_real('0') IS NULL AND public.creci_real('0000000000') IS NULL AND public.creci_real('000-0') IS NULL
  AND public.creci_real('00000-F') IS NULL AND public.creci_real(' 0.0/0 ') IS NULL,
  'creci_real: vazio, 0, 0000000000, 000-0, 00000-F e 0.0/0 = sem CRECI (NULL)');
SELECT pg_temp.ok(public.creci_real(' 12345-F ') = '12345-F' AND public.creci_real('100') = '100'
  AND public.creci_real('000010') = '000010' AND public.creci_real('F-1') = 'F-1',
  'creci_real: com algum dígito 1-9 = CRECI real (aparado)');

-- 1) Envio ao gestor: só zeros passa como sem CRECI -----------------------------------------------------
SELECT jsonb_build_object(
  'imovel', jsonb_build_object('tipo_imovel','Casa','endereco','Rua X, 1','bairro','B','municipio','Sorocaba',
    'estado','SP','classificacao_fiscal_iptu','1','numero_matricula','1','cartorio_registro','1','valor_imovel','1'),
  'proprietario_1', jsonb_build_object('nome_completo','Ana Exemplo','rg','1','cpf','1','endereco_completo','R',
    'nacionalidade','b','estado_civil','s','email','a@exemplo.test','telefone_1','1'),
  'condicoes', jsonb_build_object('prazo_dias_numero','90','prazo_dias_extenso','noventa','prazo_dias_uteis_numero','5',
    'prazo_dias_uteis_extenso','cinco','comissao_percentual_numero','6','comissao_percentual_extenso','seis',
    'foro_comarca','Sorocaba','foro_estado','SP')) AS f \gset
SELECT pg_temp.ok(public.exclusive_required_fields(:'f'::jsonb, '11144477735', '0')
  AND public.exclusive_required_fields(:'f'::jsonb, '11144477735', '000-0')
  AND public.exclusive_required_fields(:'f'::jsonb, '11144477735', '0000000000')
  AND public.exclusive_required_fields(:'f'::jsonb, '11144477735', '')
  AND public.exclusive_required_fields(:'f'::jsonb, '11144477735', '12345-F')
  AND NOT public.exclusive_required_fields(:'f'::jsonb, '11144477735', '#1x')
  AND NOT public.exclusive_required_fields(:'f'::jsonb, '11144477735', '123'),
  'envio: 0 / 000-0 / 0000000000 aceitos como sem CRECI; CRECI real com formato inválido continua recusado');

-- 2) Captador com CRECI real: igual a hoje -----------------------------------------------------------
SELECT public.exclusive_testemunhas_resolver(:'capr') AS rc \gset
SELECT pg_temp.ok(:'rc'::jsonb->>'modo' = 'padrao' AND NOT (:'rc'::jsonb ? 'contrato')
  AND (:'rc'::jsonb->'corretor'->>'id') = :'cr' AND (:'rc'::jsonb->'gestor'->>'id') = :'g'
  AND (:'rc'::jsonb->>'ok')::bool
  AND (:'rc'::jsonb->>'dados') = public.exclusive_testemunhas_assinatura(:'rc'::jsonb->'corretor', :'rc'::jsonb->'gestor'),
  'CRECI real: modo padrão, testemunhas automáticas e a mesma impressão digital de antes');

-- 3) Captador "0000000000", "0" e "000-0": modo sem_creci ----------------------------------------------
SELECT public.exclusive_testemunhas_resolver(:'capz') AS rz \gset
SELECT pg_temp.ok(:'rz'::jsonb->>'modo' = 'sem_creci' AND (:'rz'::jsonb->'contrato'->>'id') = :'g'
  AND (:'rz'::jsonb->'contrato'->>'creci') = '12345-F' AND (:'rz'::jsonb->'contrato'->>'ok')::bool
  AND (:'rz'::jsonb->'corretor'->>'id') = :'cz' AND jsonb_typeof(:'rz'::jsonb->'gestor') = 'null'
  AND NOT (:'rz'::jsonb->>'ok')::bool AND :'rz' LIKE '%testemunha 2 é digitada%',
  '0000000000: contrato = gestor da equipe com CRECI; captador testemunha 1; testemunha 2 digitada exigida');
SELECT pg_temp.ok((public.exclusive_testemunhas_resolver(:'capz1')->>'modo') = 'sem_creci'
  AND (public.exclusive_testemunhas_resolver(:'capz1')->'contrato'->>'id') = :'g'
  AND (public.exclusive_testemunhas_resolver(:'capz2')->>'modo') = 'sem_creci'
  AND (public.exclusive_testemunhas_resolver(:'capz2')->'contrato'->>'id') = :'g',
  '"0" e "000-0": também modo sem_creci com o gestor/TL no bloco corretor');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'g');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_2_manual_salvar(%L, %L, %L, %L)',
  :'capz', 'Paula Exemplo', '529.982.247-25', 'p2@exemplo.test')) LIKE '%corretor do contrato%',
  'captador com zeros: testemunha 2 com o CPF do gestor do contrato é recusada');
SELECT public.exclusive_testemunha_2_manual_salvar(:'capz', 'Paula Exemplo', '390.533.447-05', 'paula@exemplo.test') AS m2 \gset
SELECT pg_temp.ok((:'m2'::jsonb->>'ok')::bool AND (:'m2'::jsonb->'gestor'->>'origem') = 'manual'
  AND (:'m2'::jsonb->'contrato'->>'id') = :'g',
  'captador com zeros: gestor digita a testemunha 2 (a trava "captador tem CRECI" não se aplica) e fica completo');
SELECT string_agg(id::text || ':' || ok::text || ':' || coalesce(creci, '-'), ',' ORDER BY id) AS cand
  FROM public.exclusive_contrato_candidatos(:'capz') \gset
SELECT pg_temp.ok(:'cand' LIKE '%' || :'gz' || ':false:-%' AND :'cand' LIKE '%' || :'g' || ':true:12345-F%'
  AND :'cand' LIKE '%' || :'tl' || ':true:67890-F%',
  'candidatos: gestor com CRECI zerado aparece bloqueado e sem CRECI (não conta como "com CRECI")');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contrato_corretor_escolher(%L, %L)', :'capz', :'gz'))
  LIKE '%CRECI no cadastro%', 'escolher gestor com CRECI 0000000000: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_contrato_corretor_escolher(%L, %L)', :'capr', :'tl'))
  LIKE '%tem CRECI%', 'captador com CRECI real: troca do corretor do contrato continua recusada');
SELECT public.exclusive_testemunhas(:'capz') AS ts \gset
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunhas_fixar(%L, %L, NULL, %L, %L)',
  :'capz', :'cz', 'x/capz.pdf', :'ts'::jsonb->>'dados')) IS NULL, 'fixar PDF de captador com zeros (modo sem CRECI): ok');
RESET ROLE;
SELECT pg_temp.ok((public.exclusive_testemunhas_resolver(:'capz')->>'pdf_ok')::bool
  AND (SELECT (testemunhas_pdf->>'contrato_id')::uuid = :'g' FROM public.exclusive_captures WHERE id = :'capz'),
  'depois de fixar: pdf_ok e corretor do contrato = gestor/TL registrado (envio Clicksign liberado)');

-- 4) Líder da equipe com CRECI zerado não é o corretor do contrato ---------------------------------------
UPDATE public.profiles SET creci = '0000000000' WHERE id = :'g';
SELECT public.exclusive_testemunhas_resolver(:'capz') AS rz2 \gset
SELECT pg_temp.ok(NOT (:'rz2'::jsonb->>'ok')::bool AND NOT (:'rz2'::jsonb->'contrato'->>'ok')::bool
  AND (:'rz2'::jsonb->'contrato'->>'creci') = '' AND :'rz2' LIKE '%CRECI no cadastro%escolha outro%',
  'líder com CRECI 0000000000: não vale como corretor do contrato; pede completar ou trocar (TL com CRECI existe)');
UPDATE public.profiles SET creci = '12345-F' WHERE id = :'g';

-- 5) Imobiliária cujo único gestor tem "00000-F": bloqueio (nunca contrato sem CRECI) ------------------
SELECT public.exclusive_testemunhas_resolver(:'capb') AS rb \gset
SELECT pg_temp.ok(:'rb'::jsonb->>'modo' = 'sem_creci' AND NOT (:'rb'::jsonb->>'ok')::bool
  AND :'rb' LIKE '%nenhum gestor ou team leader desta imobiliária tem CRECI%',
  'captador "0000" e gestor "00000-F": bloqueio com mensagem clara');

-- 5b) Captador que também é PROPRIETÁRIO não é testemunha (escopo aprovado 04/11) -------------------
-- Silvia (cz, CPF 11144477735) é proprietária 2; prop 1 = Ana (CPF 98765432100 = CPF do Caio, para
-- testar testemunha com CPF de proprietário). capp1 = com CRECI real; capp2 = com zeros.
\set capp1 'c1000000-0000-4000-8000-000000000011'
\set capp2 'c1000000-0000-4000-8000-000000000012'
\set capn  'c1000000-0000-4000-8000-000000000013'
SELECT jsonb_build_object('proprietario_1', jsonb_build_object('nome_completo','Ana Dona','cpf','987.654.321-00','email','ana@exemplo.test'),
  'proprietario_2', jsonb_build_object('nome_completo','Sílvia  Zerada','cpf','111.444.777-35','email','silvia.dona@exemplo.test')) AS fp \gset
SELECT jsonb_build_object('proprietario_1', jsonb_build_object('nome_completo','Ana Dona','cpf','','email','ana@exemplo.test'),
  'proprietario_2', jsonb_build_object('nome_completo','SILVIA ZERADA','cpf','','email','')) AS fn \gset
SET LOCAL session_replication_role = replica;
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, manual) VALUES
  (:'capp1', :'cz', :'cz', 'remax-padrao', :'unit', 'enviada', :'fp', 'Silvia Zerada', '11144477735', '77777-F', :'org_a', false),
  (:'capp2', :'cz', :'cz', 'remax-padrao', :'unit', 'enviada', :'fp', 'Silvia Zerada', '11144477735', '0000000000', :'org_a', false),
  (:'capn',  :'cz', :'cz', 'remax-padrao', :'unit', 'enviada', :'fn', 'Silvia Zerada', '', '77777-F', :'org_a', false);
INSERT INTO public.exclusive_documents (capture_id, kind, storage_path, file_name, uploaded_by, organization_id, created_at)
  VALUES (:'capp1', 'gerado', 'x/capp1.pdf', 'capp1.pdf', :'g', :'org_a', now() - interval '1 minute');
SET LOCAL session_replication_role = origin;
SELECT public.exclusive_testemunhas_resolver(:'capp1') AS rp1 \gset
SELECT pg_temp.ok((:'rp1'::jsonb->>'captador_proprietario')::bool AND :'rp1'::jsonb->>'modo' = 'padrao'
  AND NOT (:'rp1'::jsonb->>'ok')::bool AND (:'rp1'::jsonb->'corretor'->>'id') IS NULL
  AND jsonb_typeof(:'rp1'::jsonb->'gestor') = 'null'
  AND :'rp1' LIKE '%Testemunha 1: o captador também é proprietário%' AND :'rp1' LIKE '%Digite a testemunha 2%',
  'captador = proprietário 2, COM CRECI: não é testemunha automática; as duas testemunhas digitadas são exigidas');
SELECT public.exclusive_testemunhas_resolver(:'capp2') AS rp2 \gset
SELECT pg_temp.ok((:'rp2'::jsonb->>'captador_proprietario')::bool AND :'rp2'::jsonb->>'modo' = 'sem_creci'
  AND (:'rp2'::jsonb->'contrato'->>'id') = :'g' AND NOT (:'rp2'::jsonb->>'ok')::bool
  AND :'rp2' LIKE '%Testemunha 1: o captador também é proprietário%',
  'captador = proprietário 2, SEM CRECI (zeros): contrato com o gestor/TL e as duas testemunhas digitadas exigidas');
SELECT pg_temp.ok((public.exclusive_testemunhas_resolver(:'capn')->>'captador_proprietario')::bool,
  'sem CPF no proprietário: reforço pelo nome normalizado (acento/maiúscula/espaço) reconhece o captador');
SELECT pg_temp.ok(NOT (public.exclusive_testemunhas_resolver(:'capr')->>'captador_proprietario')::bool
  AND NOT (public.exclusive_testemunhas_resolver(:'capz')->>'captador_proprietario')::bool,
  'captador que não é proprietário: flag falsa (caminho normal inalterado)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'g');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_manual_salvar(%L, 1, %L, %L, %L)',
  :'capp1', 'Ana Dona', '987.654.321-00', 'outra@exemplo.test')) LIKE '%proprietário do imóvel%',
  'testemunha digitada com CPF de proprietário: recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_manual_salvar(%L, 1, %L, %L, %L)',
  :'capp1', 'Silvia Zerada', '111.444.777-35', 's@exemplo.test')) LIKE '%proprietário%',
  'testemunha digitada = o próprio captador-proprietário: recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_manual_salvar(%L, 2, %L, %L, %L)',
  :'capp2', 'Gina Gestora', '529.982.247-25', 'g2@exemplo.test')) LIKE '%corretor do contrato%',
  'proprietário sem CRECI: testemunha com CPF do corretor do contrato é recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_manual_salvar(%L, 1, %L, %L, %L)',
  :'capz', 'Xis Ypsilon', '390.533.447-05', 'x@exemplo.test')) LIKE '%só é digitada quando%',
  'testemunha 1 digitada só existe quando o captador é proprietário');
SELECT public.exclusive_testemunha_manual_salvar(:'capp1', 1, 'Tiago Lider', '390.533.447-05', 't1@exemplo.test') AS s1 \gset
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_manual_salvar(%L, 2, %L, %L, %L)',
  :'capp1', 'Tiago Outro', '390.533.447-05', 'x2@exemplo.test')) LIKE '%testemunha 1%',
  'testemunha 2 igual à testemunha 1: recusada');
SELECT public.exclusive_testemunha_manual_salvar(:'capp1', 2, 'Gina Gestora', '529.982.247-25', 'gina@exemplo.test') AS s2 \gset
SELECT pg_temp.ok((:'s2'::jsonb->>'ok')::bool AND (:'s2'::jsonb->'corretor'->>'nome') = 'Tiago Lider'
  AND (:'s2'::jsonb->'gestor'->>'nome') = 'Gina Gestora' AND (:'s2'::jsonb->'manual_1'->>'email') = 't1@exemplo.test'
  AND NOT (:'s2'::jsonb->'corretor' ? 'email'),
  'proprietário com CRECI: duas testemunhas digitadas válidas = completo (tela sem e-mail; quem gere vê o digitado)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunhas_fixar(%L, NULL, NULL, %L, %L)',
  :'capp1', 'x/capp1.pdf', :'s2'::jsonb->>'dados')) IS NULL, 'fixar PDF com as duas testemunhas digitadas: ok');
RESET ROLE;
SELECT public.exclusive_testemunhas_resolver(:'capp1') AS rp3 \gset
SELECT pg_temp.ok((:'rp3'::jsonb->>'pdf_ok')::bool AND (:'rp3'::jsonb->'corretor'->>'email') = 't1@exemplo.test'
  AND (:'rp3'::jsonb->'gestor'->>'email') = 'gina@exemplo.test',
  'edge (resolvedor) recebe as duas testemunhas digitadas com e-mail; envio liberado');
-- Proprietário muda depois: a testemunha 1 passa a ter CPF de proprietário -> bloqueia de novo (servidor)
UPDATE public.exclusive_captures SET form_data = jsonb_set(form_data, '{proprietario_1,cpf}', '"39053344705"') WHERE id = :'capp1';
SELECT public.exclusive_testemunhas_resolver(:'capp1') AS rp4 \gset
SELECT pg_temp.ok(NOT (:'rp4'::jsonb->>'ok')::bool AND :'rp4' LIKE '%proprietário do imóvel%',
  'testemunha que vira proprietária depois: resolvedor bloqueia (envio 422)');
-- Testemunha automática (gestor da equipe) com o CPF de um proprietário -> bloqueia
UPDATE public.exclusive_captures SET form_data = '{"proprietario_1":{"nome_completo":"Outra Dona","cpf":"529.982.247-25","email":"od@exemplo.test"}}' WHERE id = :'capr';
SELECT public.exclusive_testemunhas_resolver(:'capr') AS rg \gset
SELECT pg_temp.ok(NOT (:'rg'::jsonb->>'ok')::bool AND :'rg' LIKE '%Testemunha 2 (gestor da equipe Gina Gestora)%proprietário do imóvel%',
  'testemunha automática (gestor) que é proprietária: bloqueia com aviso');
UPDATE public.exclusive_captures SET form_data = '{}' WHERE id = :'capr';
SELECT pg_temp.ok((public.exclusive_testemunhas_resolver(:'capr')->>'ok')::bool, 'caso normal volta a ficar completo');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_history WHERE capture_id = :'capp1' AND action = 'testemunha_digitada'
  AND detail IN ('Testemunha 1 digitada: Tiago Lider', 'Testemunha 2 digitada: Gina Gestora')) = 2
  AND NOT EXISTS (SELECT 1 FROM public.exclusive_history WHERE capture_id = :'capp1' AND detail ~ '[0-9]{11}|@'),
  'histórico das digitadas só com o nome');
UPDATE public.exclusive_captures SET captor_id = :'cr' WHERE id = :'capp1';
SELECT pg_temp.ok((SELECT testemunha_1_manual IS NULL AND testemunha_2_manual IS NULL FROM public.exclusive_captures WHERE id = :'capp1'),
  'transferência zera as duas testemunhas digitadas');

-- 6) Permissões da função nova -----------------------------------------------------------------------
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.creci_real(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.creci_real(text)', 'EXECUTE')
  AND (SELECT provolatile = 'i' AND NOT prosecdef FROM pg_proc WHERE proname = 'creci_real'),
  'creci_real: IMMUTABLE, sem SECURITY DEFINER, sem EXECUTE para anon');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.exclusive_testemunha_manual_salvar(uuid,integer,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.exclusive_testemunhas_editavel(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.exclusive_testemunha_digitada(jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.exclusive_proprietarios_evitar(jsonb)', 'EXECUTE'),
  'funções novas internas sem EXECUTE para authenticated; salvar sem EXECUTE para anon');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'cz');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_manual_salvar(%L, 1, %L, %L, %L)',
  :'capp2', 'Xis Ypsilon', '390.533.447-05', 'x@exemplo.test')) LIKE '%Apenas%',
  'captador não digita testemunha (só quem gere)');
RESET ROLE;

-- 7) signed_on só depois da assinatura de verdade (escopo 2) ------------------------------------------
-- capr: enviada, com PDF gerado e SEM assinado. Corretor (cr) e gestor (g) não gravam a data.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'cr');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_confirmar_data_assinatura(%L, current_date, NULL)', :'capr'))
  LIKE '%depois que o contrato estiver assinado%', 'Salvar data sem contrato assinado: recusado (corretor)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, current_date)', :'capr'))
  LIKE '%depois que o contrato estiver assinado%', 'exclusive_set_signed_on sem contrato assinado: recusado (corretor)');
SELECT pg_temp.as_user(:'g');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_confirmar_data_assinatura(%L, current_date, NULL)', :'capr'))
  LIKE '%depois que o contrato estiver assinado%', 'Salvar data sem contrato assinado: recusado (gestor)');
RESET ROLE;
SELECT pg_temp.ok((SELECT signed_on IS NULL FROM public.exclusive_captures WHERE id = :'capr'), 'signed_on continua vazio');
-- assinado anexado ANTES do gerado (antigo) não vale
SET LOCAL session_replication_role = replica;
INSERT INTO public.exclusive_documents (capture_id, kind, storage_path, file_name, uploaded_by, organization_id, created_at)
  VALUES (:'capr', 'assinado', 'x/capr-ass-antigo.pdf', 'a.pdf', :'g', :'org_a', now() - interval '2 minutes');
SET LOCAL session_replication_role = origin;
SELECT pg_temp.ok(NOT public.exclusive_tem_assinado_valido(:'capr'), 'assinado anterior ao PDF gerado não conta');
UPDATE public.exclusive_documents SET created_at = now() WHERE capture_id = :'capr' AND kind = 'assinado';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'cr');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_confirmar_data_assinatura(%L, current_date, NULL)', :'capr')) IS NULL,
  'com o assinado anexado depois do gerado: corretor salva a data (igual hoje)');
RESET ROLE;
SELECT pg_temp.ok((SELECT signed_on = current_date FROM public.exclusive_captures WHERE id = :'capr'), 'signed_on gravado após a assinatura');
-- aprovada: "Corrigir data" do gestor continua igual (sem exigir nada novo)
UPDATE public.exclusive_captures SET status = 'aprovada' WHERE id = :'capr';
DELETE FROM public.exclusive_documents WHERE capture_id = :'capr' AND kind = 'assinado';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'g');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, current_date - 1)', :'capr')) IS NULL,
  'aprovada: Corrigir data do gestor continua funcionando');
SELECT pg_temp.as_user(:'cr');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_set_signed_on(%L, current_date)', :'capr')) LIKE '%só o gestor%',
  'aprovada: corretor continua sem poder corrigir');
RESET ROLE;
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.exclusive_tem_assinado_valido(uuid)', 'EXECUTE'),
  'exclusive_tem_assinado_valido sem EXECUTE para authenticated');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
