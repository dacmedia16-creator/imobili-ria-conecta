-- Suíte: testemunhas automáticas da captação (migration 20261029220000, t_e8078685).
-- Roda DENTRO de transação revertida (run-clicksign-testemunhas-auto.sh), em banco local descartável
-- ou homologação; nunca em produção. Dados 100% fictícios, criados aqui.
-- Imobiliária A: gestor G (líder da equipe T1), TL (team leader, líder da equipe T2), G2 (gestor sem
--   CPF, líder da T3), corretores c1 (T1), c3 (sem equipe), c5 (T3). TL também capta (é o líder).
-- Imobiliária B: gestor GB e corretor CB.
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
\set c3 'a0000000-0000-4000-8000-000000000007'
\set c5 'a0000000-0000-4000-8000-000000000008'
\set gb 'b0000000-0000-4000-8000-000000000001'
\set cb 'b0000000-0000-4000-8000-000000000002'
\set t1 'a0000000-0000-4000-8000-0000000000f1'
\set t2 'a0000000-0000-4000-8000-0000000000f2'
\set t3 'a0000000-0000-4000-8000-0000000000f3'
\set unit 'a0000000-0000-4000-8000-0000000000e1'
\set cap1 'c0000000-0000-4000-8000-000000000001'
\set cap3 'c0000000-0000-4000-8000-000000000003'
\set cap4 'c0000000-0000-4000-8000-000000000004'
\set cap5 'c0000000-0000-4000-8000-000000000005'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-tw-a', 'Imobiliária Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-tw-b', 'Imobiliária Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'captacao_exclusiva', true), (:'org_b', 'captacao_exclusiva', true);
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'g', :'tl', :'g2', :'c1', :'c3', :'c5', :'gb', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, cpf, ativo, organization_id) VALUES
  (:'g',  'Gina Gestora',     'gina@exemplo.test',  '52998224725', true, :'org_a'),
  (:'tl', 'Tiago Lider',      'tiago@exemplo.test', '39053344705', true, :'org_a'),
  (:'g2', 'Gustavo Semcpf',   'gus@exemplo.test',   NULL,          true, :'org_a'),
  (:'c1', 'Carlos Corretor',  'c1@exemplo.test',    '11144477735', true, :'org_a'),
  (:'c3', 'Celia Semequipe',  'c3@exemplo.test',    '12345678909', true, :'org_a'),
  (:'c5', 'Caio Equipe Tres', 'c5@exemplo.test',    '11144477735', true, :'org_a'),
  (:'gb', 'Gestor Bee',       'gb@exemplo.test',    '52998224725', true, :'org_b'),
  (:'cb', 'Corretor Bee',     'cb@exemplo.test',    '11144477735', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'g', true), (:'org_a', :'tl', true), (:'org_a', :'g2', true), (:'org_a', :'c1', true),
  (:'org_a', :'c3', true), (:'org_a', :'c5', true), (:'org_b', :'gb', true), (:'org_b', :'cb', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'g', 'gestor', :'org_a'), (:'tl', 'team_leader', :'org_a'), (:'g2', 'gestor', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'), (:'c5', 'corretor', :'org_a'),
  (:'gb', 'gestor', :'org_b'), (:'cb', 'corretor', :'org_b');
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES
  (:'t1', :'g', 'Equipe Um', :'org_a'), (:'t2', :'tl', 'Equipe Dois', :'org_a'),
  (:'t3', :'g2', 'Equipe Tres', :'org_a');
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES
  (:'c1', :'t1', :'org_a'), (:'c5', :'t3', :'org_a'), (:'tl', :'t2', :'org_a');
INSERT INTO public.clicksign_org_settings (organization_id, enabled, sale_enabled, test_mode, access_token_secret_id)
  VALUES (:'org_a', true, false, true, gen_random_uuid());
INSERT INTO public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)
  VALUES (:'unit', :'org_a', 'Unidade Exemplo', 'J-0001', 'Exemplo Ltda', 'Rua Exemplo, 1', 'Sorocaba', 'SP', '00000000000191', 'Exemplo');
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, manual) VALUES
  (:'cap1', :'c1', :'c1', 'remax-padrao', :'unit', 'enviada', '{}', 'Carlos Corretor', '11144477735', 'CRECI 1', :'org_a', false),
  (:'cap3', :'c3', :'c3', 'remax-padrao', :'unit', 'enviada', '{}', 'Celia Semequipe', '12345678909', 'CRECI 3', :'org_a', false),
  (:'cap4', :'tl', :'tl', 'remax-padrao', :'unit', 'enviada', '{}', 'Tiago Lider', '39053344705', 'CRECI 4', :'org_a', false),
  (:'cap5', :'c5', :'c5', 'remax-padrao', :'unit', 'enviada', '{}', 'Caio Equipe Tres', '11144477735', 'CRECI 5', :'org_a', false);
INSERT INTO public.exclusive_documents (capture_id, kind, storage_path, file_name, uploaded_by, organization_id, created_at)
  VALUES (:'cap1', 'gerado', 'x/cap1.pdf', 'cap1.pdf', :'g', :'org_a', now() - interval '1 minute');
SET LOCAL session_replication_role = origin;

-- 1) Resolvedor (servidor): padrão e casos de borda ----------------------------------------------
SELECT public.exclusive_testemunhas_resolver(:'cap1') AS r1 \gset
SELECT pg_temp.ok((:'r1'::jsonb->'corretor'->>'id') = :'c1' AND (:'r1'::jsonb->'gestor'->>'id') = :'g'
  AND (:'r1'::jsonb->'gestor'->>'origem') = 'equipe' AND (:'r1'::jsonb->>'ok')::bool
  AND (:'r1'::jsonb->>'aplica')::bool,
  'padrão: testemunha 1 = corretor, testemunha 2 = líder da equipe dele, completo');
SELECT pg_temp.ok((:'r1'::jsonb->'corretor'->>'email') = 'c1@exemplo.test'
  AND (:'r1'::jsonb->'corretor'->>'cpf') = '11144477735',
  'resolvedor (só service_role) traz e-mail e CPF do cadastro');
SELECT pg_temp.ok((:'r1'::jsonb->>'pdf_gerado')::bool AND NOT (:'r1'::jsonb->>'pdf_ok')::bool,
  'PDF gerado sem testemunhas fixadas: pdf_ok=false (envio recusado)');

SELECT public.exclusive_testemunhas_resolver(:'cap3') AS r3 \gset
SELECT pg_temp.ok(:'r3'::jsonb->>'motivo' = 'sem_equipe' AND jsonb_typeof(:'r3'::jsonb->'gestor') = 'null'
  AND NOT (:'r3'::jsonb->>'ok')::bool AND :'r3' LIKE '%não está em nenhuma equipe%',
  'sem equipe: sem padrão, bloqueia com aviso');

SELECT public.exclusive_testemunhas_resolver(:'cap4') AS r4 \gset
SELECT pg_temp.ok(:'r4'::jsonb->>'motivo' = 'corretor_e_lider' AND jsonb_typeof(:'r4'::jsonb->'gestor') = 'null'
  AND NOT (:'r4'::jsonb->>'ok')::bool AND :'r4' LIKE '%próprio líder%',
  'corretor é o próprio líder: não vira as 2 testemunhas, bloqueia com aviso');

SELECT public.exclusive_testemunhas_resolver(:'cap5') AS r5 \gset
SELECT pg_temp.ok((:'r5'::jsonb->'gestor'->>'id') = :'g2' AND NOT (:'r5'::jsonb->>'ok')::bool
  AND :'r5' LIKE '%CPF válido%',
  'gestor da equipe sem CPF: bloqueia dizendo o que falta');

-- 2) Permissões das funções ----------------------------------------------------------------------
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.exclusive_testemunhas_resolver(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.exclusive_testemunhas_resolver(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.exclusive_testemunha_pessoa(uuid,uuid,text)', 'EXECUTE'),
  'resolvedor e pessoa (com e-mail) só para service_role');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.exclusive_testemunhas(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.exclusive_testemunha_gestor_escolher(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.exclusive_testemunhas_candidatos(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.exclusive_testemunhas_fixar(uuid,uuid,uuid,text,text)', 'EXECUTE'),
  'anon sem EXECUTE nas funções da tela');

SET LOCAL ROLE authenticated;

-- 3) Tela (gestor da imobiliária A) ---------------------------------------------------------------
SELECT pg_temp.as_user(:'g');
SELECT public.exclusive_testemunhas(:'cap1') AS t1 \gset
SELECT pg_temp.ok(:'t1' !~ '@' AND (:'t1'::jsonb->'gestor'->>'cpf') = '52998224725'
  AND (:'t1'::jsonb->>'pode_gerir')::bool,
  'tela do gestor: sem e-mail, com CPF (para imprimir no PDF)');

SELECT string_agg(id::text, ',' ORDER BY id) AS cand FROM public.exclusive_testemunhas_candidatos(:'cap3') \gset
SELECT pg_temp.ok(:'cand' LIKE '%' || :'g' || '%' AND :'cand' LIKE '%' || :'tl' || '%'
  AND :'cand' LIKE '%' || :'g2' || '%' AND :'cand' NOT LIKE '%' || :'gb' || '%'
  AND :'cand' NOT LIKE '%' || :'c3' || '%' AND :'cand' NOT LIKE '%' || :'c1' || '%',
  'candidatos: só gestor/TL da MESMA imobiliária, sem o corretor e sem corretores');
SELECT pg_temp.ok((SELECT NOT ok AND falta LIKE '%CPF%' FROM public.exclusive_testemunhas_candidatos(:'cap3') WHERE id = :'g2'),
  'candidato sem CPF aparece marcado com o que falta');

SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_gestor_escolher(%L, %L)', :'cap3', :'gb'))
  LIKE '%desta imobiliária%', 'escolher gestor de OUTRA imobiliária: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_gestor_escolher(%L, %L)', :'cap3', :'c1'))
  LIKE '%desta imobiliária%', 'escolher corretor (sem papel de gestor/TL): recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_gestor_escolher(%L, %L)', :'cap3', :'g2'))
  LIKE '%Cadastro incompleto%CPF%', 'escolher gestor sem CPF: recusado com o que falta');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_gestor_escolher(%L, %L)', :'cap4', :'tl'))
  LIKE '%já é a testemunha 1%', 'escolher o próprio corretor: recusado');

SELECT public.exclusive_testemunha_gestor_escolher(:'cap3', :'tl') AS e3 \gset
SELECT pg_temp.ok((:'e3'::jsonb->'gestor'->>'id') = :'tl' AND (:'e3'::jsonb->'gestor'->>'origem') = 'escolhido'
  AND (:'e3'::jsonb->>'ok')::bool AND (:'e3'::jsonb->>'escolhido')::bool,
  'sem equipe: staff escolhe TL da mesma imobiliária e fica completo');
SELECT public.exclusive_testemunha_gestor_escolher(:'cap4', :'g') AS e4 \gset
SELECT pg_temp.ok((:'e4'::jsonb->'gestor'->>'id') = :'g' AND (:'e4'::jsonb->>'ok')::bool,
  'corretor líder: staff escolhe outro gestor e fica completo');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_history WHERE capture_id IN (:'cap3', :'cap4')
  AND action = 'testemunha_escolhida' AND actor_id = :'g') = 2, 'troca de testemunha registrada no histórico');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'g');

-- 4) PDF: fixar e detectar troca depois do PDF ----------------------------------------------------
SELECT public.exclusive_testemunhas(:'cap1')->>'dados' AS dados1 \gset
SELECT pg_temp.ok(length(:'dados1') = 32, 'tela de quem gere recebe a impressão digital de nome+CPF');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunhas_fixar(%L, %L, %L, %L, %L)', :'cap1', :'c1', :'tl', 'x/cap1.pdf', :'dados1'))
  LIKE '%mudaram%', 'fixar com testemunha diferente da atual: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunhas_fixar(%L, %L, %L, %L, %L)', :'cap1', :'c1', :'g', 'x/OUTRO.pdf', :'dados1'))
  LIKE '%Outro PDF%', 'corrida: fixar com caminho de outro PDF (gerado por outra pessoa no meio): recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunhas_fixar(%L, %L, %L, %L, %L)', :'cap1', :'c1', :'g', 'x/cap1.pdf', 'nome-cpf-antigo'))
  LIKE '%mudaram%', 'fixar com nome/CPF diferentes do cadastro atual: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunhas_fixar(%L, %L, %L, %L, %L)', :'cap1', :'c1', :'g', 'x/cap1.pdf', :'dados1')) IS NULL,
  'fixar as testemunhas impressas no PDF: ok');
RESET ROLE;
SELECT pg_temp.ok((public.exclusive_testemunhas_resolver(:'cap1')->>'pdf_ok')::bool, 'depois de fixar: pdf_ok=true');
-- CPF do gestor muda no cadastro depois do PDF: o impresso ficou velho
UPDATE public.profiles SET cpf = '39053344705' WHERE id = :'g';
SELECT pg_temp.ok(NOT (public.exclusive_testemunhas_resolver(:'cap1')->>'pdf_ok')::bool,
  'CPF do gestor mudou depois do PDF: pdf_ok=false');
UPDATE public.profiles SET cpf = '52998224725' WHERE id = :'g';
SELECT pg_temp.ok((public.exclusive_testemunhas_resolver(:'cap1')->>'pdf_ok')::bool, 'CPF voltou: pdf_ok=true');
-- Outro PDF gerado (caminho novo) sem fixar: pdf_ok=false
UPDATE public.exclusive_documents SET storage_path = 'x/cap1-v2.pdf' WHERE capture_id = :'cap1' AND kind = 'gerado';
SELECT pg_temp.ok(NOT (public.exclusive_testemunhas_resolver(:'cap1')->>'pdf_ok')::bool,
  'PDF trocado por outro arquivo sem registrar testemunhas: pdf_ok=false');
UPDATE public.exclusive_documents SET storage_path = 'x/cap1.pdf' WHERE capture_id = :'cap1' AND kind = 'gerado';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'g');
SELECT public.exclusive_testemunha_gestor_escolher(:'cap1', :'tl') AS e1 \gset
RESET ROLE;
SELECT pg_temp.ok(NOT (public.exclusive_testemunhas_resolver(:'cap1')->>'pdf_ok')::bool,
  'testemunha trocada depois do PDF: pdf_ok=false (envio recusado até gerar de novo)');
SELECT public.exclusive_testemunhas_resolver(:'cap1') AS r1b \gset
SELECT pg_temp.ok((:'r1b'::jsonb->'gestor_equipe'->>'id') = :'g' AND (:'r1b'::jsonb->'gestor'->>'id') = :'tl',
  'escolha manual vale mesmo havendo gestor da equipe (padrão continua informado)');

-- 5) Envelope em andamento: não troca --------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.clicksign_envelopes (organization_id, origem, capture_id, source_document_id,
    envelope_key, document_key, status, is_test, created_by, signers)
  VALUES (:'org_a', 'captacao', :'cap5', gen_random_uuid(), 'env-5', 'doc-5', 'running', true, :'g', '[]');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'g');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_gestor_escolher(%L, %L)', :'cap5', :'tl'))
  LIKE '%em assinatura%', 'envelope já em assinatura: testemunha não é trocada');

-- 6) Isolamento: imobiliária B não vê nem escolhe -------------------------------------------------
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunhas(%L)', :'cap1')) LIKE '%não disponível%',
  'gestor de outra imobiliária não vê as testemunhas');
SELECT pg_temp.ok(pg_temp.err(format('SELECT * FROM public.exclusive_testemunhas_candidatos(%L)', :'cap1')) LIKE '%Apenas%',
  'gestor de outra imobiliária não lista candidatos');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_gestor_escolher(%L, %L)', :'cap1', :'gb')) LIKE '%Apenas%',
  'gestor de outra imobiliária não escolhe testemunha');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunhas_fixar(%L, %L, %L, %L, %L)', :'cap1', :'c1', :'g', 'x/cap1.pdf', :'dados1')) LIKE '%Apenas%',
  'gestor de outra imobiliária não fixa PDF');

-- 7) Corretor dono: vê (sem CPF nem e-mail), não escolhe ------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT coalesce(pg_temp.err(format('SELECT public.exclusive_testemunhas(%L)', :'cap1')), 'sem erro') AS ce \gset
SELECT CASE WHEN :'ce' = 'sem erro' THEN public.exclusive_testemunhas(:'cap1')::text ELSE '{}' END AS tc \gset
SELECT pg_temp.ok(:'ce' = 'sem erro' AND :'tc' !~ '@' AND NOT (:'tc'::jsonb->'corretor' ? 'cpf')
  AND NOT (:'tc'::jsonb->>'pode_gerir')::bool,
  'corretor dono vê as testemunhas sem e-mail e sem CPF');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_testemunha_gestor_escolher(%L, %L)', :'cap1', :'g')) LIKE '%Apenas%',
  'corretor não escolhe testemunha');
RESET ROLE;

-- 8) Transferência do corretor: escolha manual e registro do PDF são zerados -------------------------
-- cap3 tinha a escolha manual (tl). Transferida para c1 (equipe T1, líder g) => volta ao automático.
UPDATE public.exclusive_captures SET testemunhas_pdf = '{"path":"x"}' WHERE id = :'cap3';
UPDATE public.exclusive_captures SET captor_id = :'c1' WHERE id = :'cap3';
SELECT public.exclusive_testemunhas_resolver(:'cap3') AS rt \gset
SELECT pg_temp.ok((SELECT testemunha_gestor_id IS NULL AND testemunhas_pdf IS NULL FROM public.exclusive_captures WHERE id = :'cap3')
  AND (:'rt'::jsonb->'gestor'->>'id') = :'g' AND (:'rt'::jsonb->'gestor'->>'origem') = 'equipe',
  'transferência: escolha manual e PDF zerados; vale o líder da equipe do novo corretor');
-- CPF do corretor = o do CADASTRO (mesmo com outro CPF digitado na captação)
UPDATE public.exclusive_captures SET broker_cpf = '12345678909' WHERE id = :'cap1';
SELECT pg_temp.ok((public.exclusive_testemunhas_resolver(:'cap1')->'corretor'->>'cpf') = '11144477735',
  'CPF do corretor vem do cadastro (mesma origem do nome)');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
