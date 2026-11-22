-- Suíte: tráfego pago manual no Feedback (migration 20261224120000, t_f3f64be0).
-- Roda DENTRO de transação revertida (run-feedback-trafego-pago.sh), na homologação ou banco descartável; nunca em produção.
-- Dados 100% fictícios. Imobiliária A: admin; c1 = corretor antigo do anúncio L1 (broker_id); c2 = captador atual
-- (captação ligada a L1), equipe do TL g2; g1 = gestor de c1/c3; c3 = outro corretor. Imobiliária B: gb (admin+gestor).
-- L1 ligado à captação de c2; L2 sem captação, broker_id = c1.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.qtd(_code text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.listing_paid_traffic_entries WHERE listing_code = _code $$;
CREATE FUNCTION pg_temp.ins(_code text, _canal text, _ini text, _fim text, _v int, _c int, _inv numeric) RETURNS text
LANGUAGE sql AS $$ SELECT pg_temp.err(format(
  'INSERT INTO public.listing_paid_traffic_entries (listing_code, canal, inicio, fim, visualizacoes, contatos, investimento)
   VALUES (%L, %L, %L, %L, %s, %s, %s)', _code, _canal, _ini, _fim, _v, _c, coalesce(_inv::text, 'NULL'))) $$;

\set org_a 'a1000000-0000-4000-8000-0000000000a0'
\set org_b 'b1000000-0000-4000-8000-0000000000b0'
\set admin 'a1000000-0000-4000-8000-000000000001'
\set g1 'a1000000-0000-4000-8000-000000000002'
\set g2 'a1000000-0000-4000-8000-000000000003'
\set c1 'a1000000-0000-4000-8000-000000000004'
\set c2 'a1000000-0000-4000-8000-000000000005'
\set c3 'a1000000-0000-4000-8000-000000000006'
\set gb 'b1000000-0000-4000-8000-000000000001'
\set t1 'a1000000-0000-4000-8000-0000000000f1'
\set t2 'a1000000-0000-4000-8000-0000000000f2'
\set unit 'a1000000-0000-4000-8000-0000000000e1'
\set cap1 'c1000000-0000-4000-8000-000000000001'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-tp-a', 'Imobiliária Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-tp-b', 'Imobiliária Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'captacao_exclusiva', true), (:'org_b', 'captacao_exclusiva', true),
  (:'org_a', 'feedback_proprietario', true), (:'org_b', 'feedback_proprietario', true);
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'g1', :'g2', :'c1', :'c2', :'c3', :'gb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id, remax_id) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org_a', NULL),
  (:'g1', 'Gestor Um', 'g1@exemplo.test', true, :'org_a', NULL),
  (:'g2', 'Lider Dois', 'g2@exemplo.test', true, :'org_a', NULL),
  (:'c1', 'Carlos Antigo', 'c1@exemplo.test', true, :'org_a', '630699001'),
  (:'c2', 'Bruno Captador', 'c2@exemplo.test', true, :'org_a', '630699002'),
  (:'c3', 'Outro Corretor', 'c3@exemplo.test', true, :'org_a', NULL),
  (:'gb', 'Gestor B', 'gb@exemplo.test', true, :'org_b', NULL);
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'g1', true), (:'org_a', :'g2', true), (:'org_a', :'c1', true),
  (:'org_a', :'c2', true), (:'org_a', :'c3', true), (:'org_b', :'gb', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'g1', 'gestor', :'org_a'), (:'g2', 'team_leader', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'),
  (:'gb', 'gestor', :'org_b'), (:'gb', 'admin', :'org_b');
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES
  (:'t1', :'g1', 'Equipe Um', :'org_a'), (:'t2', :'g2', 'Equipe Dois', :'org_a');
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES
  (:'c1', :'t1', :'org_a'), (:'c2', :'t2', :'org_a'), (:'c3', :'t1', :'org_a');
INSERT INTO public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)
  VALUES (:'unit', :'org_a', 'Unidade Exemplo', 'J-0001', 'Exemplo Ltda', 'Rua Exemplo, 1', 'Sorocaba', 'SP', '00000000000191', 'Exemplo');
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, signed_on, manual) VALUES
  (:'cap1', :'c2', :'c1', 'remax-padrao', :'unit', 'aprovada', '{}', 'Carlos Antigo', '11144477735', 'CRECI 1', :'org_a', current_date, false);
INSERT INTO public.exclusive_listing_links (organization_id, capture_id, listing_code, status, linked_by) VALUES
  (:'org_a', :'cap1', '630699001-1', 'ativo', :'c1');
INSERT INTO public.portal_listing_snapshots (organization_id, portal, collected_on, listing_code, broker_id, window_kind, views, contacts) VALUES
  (:'org_a', 'zap', current_date, '630699001-1', :'c1', 'last30', 120, 3),
  (:'org_a', 'zap', current_date, '630699001-2', :'c1', 'last30', 80, 1),
  (:'org_b', 'zap', current_date, '630699001-1', :'gb', 'last30', 10, 0);
SET LOCAL session_replication_role = origin;
SELECT md5(string_agg(organization_id::text || listing_code || coalesce(broker_id::text, '') || views || contacts, ','
  ORDER BY organization_id, listing_code, portal, collected_on)) AS snap_antes FROM public.portal_listing_snapshots \gset

-- 0) Estrutura: RLS ligada, anon sem privilégio, só uma permissiva -------------------------------------
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.listing_paid_traffic_entries'::regclass), 'RLS ligada');
SELECT pg_temp.ok(NOT has_table_privilege('anon', 'public.listing_paid_traffic_entries', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.listing_paid_traffic_entries', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.listing_paid_traffic_entries', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.listing_paid_traffic_entries', 'DELETE'), 'anon: nenhum privilégio na tabela');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.listing_paid_traffic_audit()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.listing_paid_traffic_audit()', 'EXECUTE'), 'função de gatilho fechada para usuários');
SELECT pg_temp.ok((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.listing_paid_traffic_entries'::regclass AND polpermissive) = 1
  AND (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.listing_paid_traffic_entries'::regclass AND NOT polpermissive) = 3,
  '1 política permissiva + 3 restritivas (org, usuário ativo, módulo)');

SET LOCAL ROLE authenticated;

-- 1) Captador atual (corretor dono do imóvel ligado) -----------------------------------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'meta', '2026-10-01', '2026-10-31', 500, 12, 350.50) IS NULL, 'dono (captador atual): cria lançamento Meta');
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'google', '2026-11-01', '2026-11-15', 200, 4, NULL) IS NULL, 'dono: cria lançamento Google sem valor investido');
SELECT pg_temp.ok(pg_temp.qtd('630699001-1') = 2, 'dono: lê os 2 lançamentos');
SELECT pg_temp.ok((SELECT bool_and(created_by = :'c2'::uuid AND updated_by = :'c2'::uuid AND organization_id = :'org_a'::uuid
                     AND code_key = '630699001-1') FROM public.listing_paid_traffic_entries),
  'auditoria: created_by/updated_by = quem lançou; org e code_key do servidor');
-- Validações
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'meta', '2026-10-01', '2026-10-31', -1, 0, NULL) LIKE '23514%', 'visualizações negativas recusadas');
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'meta', '2026-10-01', '2026-10-31', 1, -5, NULL) LIKE '23514%', 'contatos negativos recusados');
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'meta', '2026-10-01', '2026-10-31', 1, 1, -10) LIKE '23514%', 'investimento negativo recusado');
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'meta', '2026-10-31', '2026-10-01', 1, 1, NULL) LIKE '23514%', 'fim antes do início recusado');
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'tiktok', '2026-10-01', '2026-10-31', 1, 1, NULL) LIKE '23514%', 'canal fora da lista recusado');
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'outro', '2026-10-05', '2026-10-05', 0, 0, 0) IS NULL, 'canal Outro, período de 1 dia e zeros aceitos');
-- Editar
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.listing_paid_traffic_entries SET visualizacoes = 650 WHERE listing_code = %L AND canal = %L',
  '630699001-1', 'meta')) IS NULL, 'dono: edita');
SELECT pg_temp.ok((SELECT visualizacoes FROM public.listing_paid_traffic_entries WHERE canal = 'meta') = 650, 'dono: edição gravada');
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.listing_paid_traffic_entries SET created_by = %L WHERE canal = %L', :'c1', 'meta')) LIKE '42501%',
  'edição não troca o autor');
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.listing_paid_traffic_entries SET listing_code = %L WHERE canal = %L', '630699001-2', 'meta')) LIKE '42501%',
  'edição não troca o imóvel');
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.listing_paid_traffic_entries SET fim = %L WHERE canal = %L', '2026-09-01', 'meta')) LIKE '23514%',
  'edição com fim antes do início recusada');

-- 2) Corretor antigo do anúncio (perdeu para o captador atual) -------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.qtd('630699001-1') = 0, 'corretor antigo: NÃO lê lançamentos do imóvel ligado');
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'meta', '2026-10-01', '2026-10-31', 9, 9, NULL) LIKE '42501%', 'corretor antigo: NÃO cria no ligado');
SELECT pg_temp.ok(pg_temp.ins('630699001-2', 'google', '2026-10-01', '2026-10-31', 90, 2, 100) IS NULL, 'corretor do anúncio sem captação (L2): cria');

-- 3) Outro corretor da mesma imobiliária ------------------------------------------------------------------
SELECT pg_temp.as_user(:'c3');
SELECT pg_temp.ok(pg_temp.qtd('630699001-1') + pg_temp.qtd('630699001-2') = 0, 'outro corretor: não lê nada');
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'meta', '2026-10-01', '2026-10-31', 1, 1, NULL) LIKE '42501%'
  AND pg_temp.ins('630699001-2', 'meta', '2026-10-01', '2026-10-31', 1, 1, NULL) LIKE '42501%', 'outro corretor: não cria');
UPDATE public.listing_paid_traffic_entries SET visualizacoes = 1;
DELETE FROM public.listing_paid_traffic_entries;

-- 4) Gestores/líderes ----------------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'g2');
SELECT pg_temp.ok(pg_temp.qtd('630699001-1') = 3, 'TL do captador: lê os 3 lançamentos do ligado');
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.listing_paid_traffic_entries SET contatos = 15 WHERE listing_code = %L AND canal = %L',
  '630699001-1', 'meta')) IS NULL, 'TL do captador: edita');
SELECT pg_temp.ok((SELECT updated_by FROM public.listing_paid_traffic_entries WHERE canal = 'meta') = :'g2'::uuid
  AND (SELECT created_by FROM public.listing_paid_traffic_entries WHERE canal = 'meta') = :'c2'::uuid, 'auditoria: updated_by = TL, created_by mantido');
SELECT pg_temp.ok(pg_temp.qtd('630699001-2') = 0, 'TL de outra equipe: não lê L2');
SELECT pg_temp.as_user(:'g1');
SELECT pg_temp.ok(pg_temp.qtd('630699001-1') = 0 AND pg_temp.qtd('630699001-2') = 1, 'gestor do c1: lê só L2 (regra do Feedback)');
SELECT pg_temp.ok(pg_temp.ins('630699001-2', 'meta', '2026-11-01', '2026-11-20', 40, 1, 80) IS NULL, 'gestor do c1: cria em L2');
SELECT pg_temp.ok(pg_temp.err(format('DELETE FROM public.listing_paid_traffic_entries WHERE listing_code = %L AND canal = %L',
  '630699001-2', 'meta')) IS NULL AND pg_temp.qtd('630699001-2') = 1, 'gestor do c1: apaga em L2');

-- 5) Admin -------------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.qtd('630699001-1') = 3 AND pg_temp.qtd('630699001-2') = 1, 'admin: lê tudo da imobiliária');
SELECT pg_temp.ok(pg_temp.ins('630699001-2', 'outro', '2026-11-01', '2026-11-02', 3, 0, 10) IS NULL, 'admin: cria');

-- 6) Outra imobiliária -----------------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok((SELECT count(*) FROM public.listing_paid_traffic_entries) = 0, 'imobiliária B: não enxerga nenhum lançamento da A');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.listing_paid_traffic_entries (organization_id, listing_code, canal, inicio, fim)
  VALUES (%L, %L, %L, %L, %L)', :'org_a', '630699001-2', 'meta', '2026-10-01', '2026-10-02')) LIKE '42501%', 'imobiliária B: não grava na A');
UPDATE public.listing_paid_traffic_entries SET visualizacoes = 0;
DELETE FROM public.listing_paid_traffic_entries;
SELECT pg_temp.ok(pg_temp.ins('630699001-1', 'meta', '2026-10-01', '2026-10-31', 7, 1, NULL) IS NULL, 'B: lança no PRÓPRIO anúncio de mesmo código');

-- 7) Apagar pelo dono + conferências finais -------------------------------------------------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.qtd('630699001-1') = 3, 'dono da A não vê o lançamento da B no mesmo código');
DELETE FROM public.listing_paid_traffic_entries WHERE listing_code = '630699001-1' AND canal = 'outro';
SELECT pg_temp.ok(pg_temp.qtd('630699001-1') = 2, 'dono: apaga');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.listing_paid_traffic_entries WHERE organization_id = :'org_a') = 4
  AND (SELECT sum(visualizacoes) FROM public.listing_paid_traffic_entries WHERE organization_id = :'org_a') = 650 + 200 + 90 + 3,
  'UPDATE/DELETE de quem não pode não mexeu em nada (4 linhas, somas certas)');
-- 8) Módulo desligado: ninguém lê
UPDATE public.organization_modules SET enabled = false WHERE organization_id = :'org_a' AND module = 'feedback_proprietario';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok((SELECT count(*) FROM public.listing_paid_traffic_entries) = 0, 'módulo Feedback desligado: admin não lê');
RESET ROLE;
UPDATE public.organization_modules SET enabled = true WHERE organization_id = :'org_a' AND module = 'feedback_proprietario';
-- 9) Usuário inativo
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET ativo = false WHERE id = :'c2';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.qtd('630699001-1') = 0, 'usuário inativo: não lê');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET ativo = true WHERE id = :'c2';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.ok((SELECT md5(string_agg(organization_id::text || listing_code || coalesce(broker_id::text, '') || views || contacts, ','
  ORDER BY organization_id, listing_code, portal, collected_on)) FROM public.portal_listing_snapshots) = :'snap_antes',
  'portal_listing_snapshots intacta');
SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
