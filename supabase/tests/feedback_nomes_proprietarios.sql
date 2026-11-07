-- Suíte: nomes dos proprietários no Feedback (migration 20261030160000, t_28136145).
-- Roda DENTRO de transação revertida (run-feedback-nomes-proprietarios.sh), em banco local descartável; nunca produção.
-- Dados 100% fictícios. Imobiliária A: admin; c1 captador (equipe do gestor g1); c2 outro corretor (equipe de g2).
-- Imobiliária B: gb (admin/gestor). Anúncios da A: L1 ligado à cap1 (3 proprietários), L2 ligado à cap2 (sem nome),
-- L3 sem captação, L4 vínculo aguardando gestor (cap3, 1 proprietário). Mesmo código L1 existe na B sem captação.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.nomes(_key text) RETURNS text LANGUAGE sql AS
  $$ SELECT array_to_string(nomes, '|') FROM public.owner_feedback_proprietarios() WHERE code_key = _key $$;
CREATE FUNCTION pg_temp.qtd() RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.owner_feedback_proprietarios() $$;

\set org_a 'a2000000-0000-4000-8000-0000000000a0'
\set org_b 'b2000000-0000-4000-8000-0000000000b0'
\set admin 'a2000000-0000-4000-8000-000000000001'
\set g1 'a2000000-0000-4000-8000-000000000002'
\set g2 'a2000000-0000-4000-8000-000000000003'
\set c1 'a2000000-0000-4000-8000-000000000004'
\set c2 'a2000000-0000-4000-8000-000000000005'
\set gb 'b2000000-0000-4000-8000-000000000001'
\set t1 'a2000000-0000-4000-8000-0000000000f1'
\set t2 'a2000000-0000-4000-8000-0000000000f2'
\set unit 'a2000000-0000-4000-8000-0000000000e1'
\set cap1 'c2000000-0000-4000-8000-000000000001'
\set cap2 'c2000000-0000-4000-8000-000000000002'
\set cap3 'c2000000-0000-4000-8000-000000000003'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-fbn-a', 'Imobiliária Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-fbn-b', 'Imobiliária Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'captacao_exclusiva', true), (:'org_b', 'captacao_exclusiva', true),
  (:'org_a', 'feedback_proprietario', true), (:'org_b', 'feedback_proprietario', true);
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'g1', :'g2', :'c1', :'c2', :'gb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org_a'),
  (:'g1', 'Gestor Um', 'g1@exemplo.test', true, :'org_a'),
  (:'g2', 'Gestor Dois', 'g2@exemplo.test', true, :'org_a'),
  (:'c1', 'Corretor Captador', 'c1@exemplo.test', true, :'org_a'),
  (:'c2', 'Outro Corretor', 'c2@exemplo.test', true, :'org_a'),
  (:'gb', 'Gestor B', 'gb@exemplo.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'g1', true), (:'org_a', :'g2', true), (:'org_a', :'c1', true),
  (:'org_a', :'c2', true), (:'org_b', :'gb', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'g1', 'gestor', :'org_a'), (:'g2', 'team_leader', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'gb', 'gestor', :'org_b'), (:'gb', 'admin', :'org_b');
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES
  (:'t1', :'g1', 'Equipe Um', :'org_a'), (:'t2', :'g2', 'Equipe Dois', :'org_a');
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES
  (:'c1', :'t1', :'org_a'), (:'c2', :'t2', :'org_a');
INSERT INTO public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)
  VALUES (:'unit', :'org_a', 'Unidade Exemplo', 'J-0001', 'Exemplo Ltda', 'Rua Exemplo, 1', 'Sorocaba', 'SP', '00000000000191', 'Exemplo');
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, signed_on, manual) VALUES
  (:'cap1', :'c1', :'c1', 'remax-padrao', :'unit', 'aprovada',
   '{"proprietario_1":{"nome_completo":" Fulano Exemplo ","cpf":"11144477735","telefone_1":"15999990000","email":"f@exemplo.test"},
     "proprietario_2":{"nome_completo":"Beltrana Exemplo","cpf":"22233344405"},
     "proprietarios_extras":[{"nome_completo":""},{"nome_completo":"Ciclano Exemplo"}]}',
   'Corretor Captador', '', '', :'org_a', current_date, false),
  (:'cap2', :'c1', :'c1', 'remax-padrao', :'unit', 'aprovada', '{"proprietario_1":{"cpf":"11144477735"}}',
   'Corretor Captador', '', '', :'org_a', current_date, false),
  (:'cap3', :'c1', :'c1', 'remax-padrao', :'unit', 'aprovada', '{"proprietario_1":{"nome_completo":"Dona Aguardando"}}',
   'Corretor Captador', '', '', :'org_a', current_date, false);
INSERT INTO public.exclusive_listing_links (organization_id, capture_id, listing_code, status, linked_by) VALUES
  (:'org_a', :'cap1', '630699101-1', 'ativo', :'c1'),
  (:'org_a', :'cap2', '630699101-2', 'ativo', :'c1'),
  (:'org_a', :'cap3', '630699101-4', 'aguardando_gestor', :'c1');
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
-- 1) Captador: todos os nomes, na ordem do contrato, sem vazio, sem CPF/telefone/e-mail ---------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.nomes('630699101-1') = 'Fulano Exemplo|Beltrana Exemplo|Ciclano Exemplo',
  'captador: 3 proprietários na ordem do contrato (nome vazio ignorado, espaços aparados)');
SELECT pg_temp.ok((SELECT string_agg(array_to_string(nomes, ' '), ' ') FROM public.owner_feedback_proprietarios())
  !~ '11144477735|22233344405|15999990000|@', 'nenhum CPF, telefone ou e-mail sai da função');
SELECT pg_temp.ok(pg_temp.nomes('630699101-2') IS NULL, 'captação sem nome de proprietário: nomes vazio (tela: "não informado")');
SELECT pg_temp.ok(pg_temp.nomes('630699101-4') = 'Dona Aguardando', 'vínculo aguardando gestor: mesmo critério do quadro da tela');
SELECT pg_temp.ok(pg_temp.nomes('630699101-3') IS NULL, 'anúncio sem captação: nada');
SELECT pg_temp.ok(pg_temp.qtd() = 3, 'captador: uma chamada traz todos os códigos ligados (em lote)');
SELECT pg_temp.ok((public.owner_feedback_captacao('630699101-1')->>'proprietario') = 'Fulano Exemplo',
  'quadro da tela (owner_feedback_captacao) segue igual');

-- 2) Gestor do captador e admin: veem; outro corretor e líder de outra equipe: não -------------------
SELECT pg_temp.as_user(:'g1');
SELECT pg_temp.ok(pg_temp.nomes('630699101-1') = 'Fulano Exemplo|Beltrana Exemplo|Ciclano Exemplo', 'gestor do captador vê');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.qtd() = 3, 'admin da imobiliária vê');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.qtd() = 0, 'outro corretor da mesma imobiliária não vê');
SELECT pg_temp.as_user(:'g2');
SELECT pg_temp.ok(pg_temp.qtd() = 0, 'líder de outra equipe não vê');

-- 3) Outra imobiliária: nada da A, mesmo com o mesmo código ---------------------------------------------
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.qtd() = 0, 'admin/gestor da B não recebe nomes da A');

-- 4) Módulo Feedback desligado: nada --------------------------------------------------------------------
RESET ROLE;
UPDATE public.organization_modules SET enabled = false WHERE organization_id = :'org_a' AND module = 'feedback_proprietario';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.qtd() = 0, 'módulo Feedback desligado: nada');
RESET ROLE;
UPDATE public.organization_modules SET enabled = true WHERE organization_id = :'org_a' AND module = 'feedback_proprietario';

-- 5) Captação descartada e anon -------------------------------------------------------------------------
UPDATE public.exclusive_captures SET discarded_at = now() WHERE id = :'cap3';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.nomes('630699101-4') IS NULL, 'captação descartada: nada');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.owner_feedback_proprietarios()') LIKE '42501%', 'anon não executa');
RESET ROLE;

-- 6) Somente leitura: dados intactos ---------------------------------------------------------------------
SELECT pg_temp.ok((SELECT form_data->'proprietario_1'->>'cpf' FROM public.exclusive_captures WHERE id = :'cap1') = '11144477735',
  'captação intacta');
SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
