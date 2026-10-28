-- Suíte: Feedback ao Proprietário segue o captador ATUAL (migration 20261028160000, t_a2436e9f).
-- Roda DENTRO de transação revertida (run-feedback-captador-atual.sh), em banco local descartável; nunca em produção.
-- Dados 100% fictícios. Imobiliária A: admin; c1 = corretor antigo do anúncio (broker_id), equipe do gestor g1;
-- c2 = captador atual (recebeu a captação), equipe do gestor g2; c3 = outro corretor. Imobiliária B: admin/gestor gb.
-- Anúncios: L1 ligado (ativo) à captação de c2, broker_id = c1; L2 sem captação, broker_id = c1;
-- L3 com vínculo só "aguardando_gestor" (captação de c2), broker_id = c1 -> regra antiga.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
-- Quantas linhas de números o usuário atual enxerga de um anúncio.
CREATE FUNCTION pg_temp.snaps(_code text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.portal_listing_snapshots WHERE listing_code = _code $$;
CREATE FUNCTION pg_temp.marcas(_code text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.owner_feedback_action_done WHERE listing_code = _code $$;

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
\set cap3 'c1000000-0000-4000-8000-000000000003'
\set act 'f1000000-0000-4000-8000-000000000001'
\set act2 'f1000000-0000-4000-8000-000000000002'
\set act_b 'f1000000-0000-4000-8000-0000000000b1'
\set run 'f1000000-0000-4000-8000-0000000000aa'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-fb-a', 'Imobiliária Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-fb-b', 'Imobiliária Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'captacao_exclusiva', true), (:'org_b', 'captacao_exclusiva', true),
  (:'org_a', 'feedback_proprietario', true), (:'org_b', 'feedback_proprietario', true);
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'g1', :'g2', :'c1', :'c2', :'c3', :'gb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org_a'),
  (:'g1', 'Gestor Antigo', 'g1@exemplo.test', true, :'org_a'),
  (:'g2', 'Gestor Novo', 'g2@exemplo.test', true, :'org_a'),
  (:'c1', 'Carlos Saiu', 'c1@exemplo.test', true, :'org_a'),
  (:'c2', 'Bruno Novo', 'c2@exemplo.test', true, :'org_a'),
  (:'c3', 'Outro Corretor', 'c3@exemplo.test', true, :'org_a'),
  (:'gb', 'Gestor B', 'gb@exemplo.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'g1', true), (:'org_a', :'g2', true), (:'org_a', :'c1', true),
  (:'org_a', :'c2', true), (:'org_a', :'c3', true), (:'org_b', :'gb', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'g1', 'gestor', :'org_a'), (:'g2', 'team_leader', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'),
  (:'gb', 'gestor', :'org_b'), (:'gb', 'admin', :'org_b');
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES
  (:'t1', :'g1', 'Equipe Antiga', :'org_a'), (:'t2', :'g2', 'Equipe Nova', :'org_a');
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES
  (:'c1', :'t1', :'org_a'), (:'c2', :'t2', :'org_a'), (:'c3', :'t1', :'org_a');
INSERT INTO public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)
  VALUES (:'unit', :'org_a', 'Unidade Exemplo', 'J-0001', 'Exemplo Ltda', 'Rua Exemplo, 1', 'Sorocaba', 'SP', '00000000000191', 'Exemplo');
-- Captação aprovada, assinada por c1 (nome no contrato) e depois transferida para c2.
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, signed_on, manual) VALUES
  (:'cap1', :'c2', :'c1', 'remax-padrao', :'unit', 'aprovada', '{"imovel":{"tipo_imovel":"Casa","bairro":"Centro"}}',
   'Carlos Saiu', '11144477735', 'CRECI 11111', :'org_a', current_date, false),
  (:'cap3', :'c2', :'c2', 'remax-padrao', :'unit', 'aprovada', '{}', 'Bruno Novo', '', '', :'org_a', current_date, false);
INSERT INTO public.exclusive_listing_links (organization_id, capture_id, listing_code, status, linked_by) VALUES
  (:'org_a', :'cap1', '630699001-1', 'ativo', :'c1'),
  (:'org_a', :'cap3', '630699001-3', 'aguardando_gestor', :'c2');
INSERT INTO public.portal_listing_snapshots (organization_id, portal, collected_on, listing_code, broker_id, window_kind, views, contacts) VALUES
  (:'org_a', 'zap', current_date, '630699001-1', :'c1', 'last30', 120, 3),
  (:'org_a', 'zap', current_date, '630699001-2', :'c1', 'last30', 80, 1),
  (:'org_a', 'zap', current_date, '630699001-3', :'c1', 'last30', 40, 0),
  (:'org_b', 'zap', current_date, '630699001-1', :'gb', 'last30', 10, 0);
INSERT INTO public.owner_feedback_actions (id, organization_id, list, category, label, weight, sort) VALUES
  (:'act', :'org_a', 'marketing', 'Teste', 'Ação teste 1', 'vital', 1),
  (:'act2', :'org_a', 'marketing', 'Teste', 'Ação teste 2', 'vital', 2),
  (:'act_b', :'org_b', 'marketing', 'Teste', 'Ação teste B', 'vital', 1);
-- Marcação antiga feita pelo c1 antes da transferência (fica gravada).
INSERT INTO public.owner_feedback_action_done (organization_id, listing_code, action_id, done_by) VALUES
  (:'org_a', '630699001-1', :'act2', :'c1');
-- XML RE/MAX: anúncio L1 com agente sem correspondência de perfil.
INSERT INTO public.remax_xml_runs (id, organization_id, status, finished_at) VALUES (:'run', :'org_a', 'ok', now());
INSERT INTO public.remax_xml_listings (organization_id, code, agent_id, negocio, first_seen, last_seen, last_run)
  VALUES (:'org_a', '630699001-1', '999999999', 'venda', current_date, current_date, :'run');
SET LOCAL session_replication_role = origin;
-- Métricas antes (para provar que nada muda).
SELECT md5(string_agg(broker_id::text || views || contacts, ',' ORDER BY listing_code, organization_id)) AS metr_antes
  FROM public.portal_listing_snapshots WHERE organization_id IN (:'org_a', :'org_b') \gset

SET LOCAL ROLE authenticated;

-- 1) Novo captador (c2) no anúncio ligado L1 -----------------------------------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(public.owner_feedback_can_edit('630699001-1'), 'L1 ligado: captador atual pode editar');
SELECT pg_temp.ok(pg_temp.snaps('630699001-1') = 1, 'L1 ligado: captador atual vê os números');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.owner_feedback_action_done (listing_code, action_id) VALUES (%L, %L)',
  '630699001-1', :'act')) IS NULL, 'L1 ligado: captador atual MARCA ação');
SELECT pg_temp.ok(pg_temp.marcas('630699001-1') = 2, 'L1 ligado: captador atual LÊ as marcações (inclusive a antiga do c1)');
SELECT pg_temp.ok((SELECT count(*) FROM public.feedback_xml_base() WHERE code = '630699001-1') = 1,
  'L1 ligado: aparece na lista base (XML) do captador atual');
SELECT pg_temp.ok((SELECT broker_id FROM public.feedback_xml_base() WHERE code = '630699001-1') = :'c2'::uuid,
  'XML: responsável exibido = captador atual');
SELECT pg_temp.ok((public.owner_feedback_captacao('630699001-1')->>'corretor') = 'Bruno Novo',
  'Texto "captador X" mostra o captador atual');
SELECT pg_temp.ok(NOT public.owner_feedback_can_edit('630699001-2'), 'L2 sem captação: c2 continua sem acesso');
SELECT pg_temp.ok(pg_temp.snaps('630699001-2') = 0, 'L2 sem captação: c2 não vê os números');

-- 2) Corretor antigo (c1, broker_id do anúncio) PERDE no ligado -------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(NOT public.owner_feedback_can_edit('630699001-1'), 'L1 ligado: corretor antigo NÃO pode editar');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.owner_feedback_action_done (listing_code, action_id) VALUES (%L, %L)',
  '630699001-1', :'act2')) LIKE '42501%', 'L1 ligado: corretor antigo NÃO insere');
SELECT pg_temp.ok(pg_temp.marcas('630699001-1') = 0, 'L1 ligado: corretor antigo NÃO lê as marcações');
DELETE FROM public.owner_feedback_action_done WHERE listing_code = '630699001-1';
SELECT pg_temp.ok(pg_temp.snaps('630699001-1') = 0, 'L1 ligado: corretor antigo não vê os números');
SELECT pg_temp.ok((SELECT count(*) FROM public.feedback_xml_base() WHERE code = '630699001-1') = 0,
  'L1 ligado: some da lista base (XML) do antigo');
-- 3) Anúncio SEM captação: regra antiga --------------------------------------------------------------
SELECT pg_temp.ok(public.owner_feedback_can_edit('630699001-2'), 'L2 sem captação: dono do anúncio (broker_id) pode');
SELECT pg_temp.ok(pg_temp.snaps('630699001-2') = 1, 'L2 sem captação: dono do anúncio vê os números');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.owner_feedback_action_done (listing_code, action_id) VALUES (%L, %L)',
  '630699001-2', :'act')) IS NULL, 'L2 sem captação: dono do anúncio marca');
SELECT pg_temp.ok(public.owner_feedback_can_edit('630699001-3'), 'L3 vínculo só aguardando gestor: regra antiga (broker_id pode)');

-- Apagar: o DELETE do antigo (acima) não pode ter apagado nada; o atual apaga.
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.owner_feedback_action_done WHERE listing_code = '630699001-1') = 2,
  'L1 ligado: corretor antigo NÃO apaga (2 marcações intactas)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c2');
DELETE FROM public.owner_feedback_action_done WHERE listing_code = '630699001-1' AND action_id = :'act';
SELECT pg_temp.ok(pg_temp.marcas('630699001-1') = 1, 'L1 ligado: captador atual apaga a própria marcação');
SELECT pg_temp.ok(NOT public.owner_feedback_can_edit('630699001-3'), 'L3 aguardando gestor: c2 ainda não tem acesso');

-- 4) Gestores/líderes ---------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'g2');
SELECT pg_temp.ok(public.owner_feedback_can_edit('630699001-1'), 'L1 ligado: líder do captador atual pode');
SELECT pg_temp.ok(pg_temp.snaps('630699001-1') = 1, 'L1 ligado: líder do captador atual vê os números');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.owner_feedback_action_done (listing_code, action_id) VALUES (%L, %L)',
  '630699001-1', :'act')) IS NULL, 'L1 ligado: líder do captador atual marca');
SELECT pg_temp.ok(NOT public.owner_feedback_can_edit('630699001-2'), 'L2 sem captação: líder de outra equipe não pode');
SELECT pg_temp.as_user(:'g1');
SELECT pg_temp.ok(NOT public.owner_feedback_can_edit('630699001-1'), 'L1 ligado: gestor do corretor antigo não pode');
SELECT pg_temp.ok(public.owner_feedback_can_edit('630699001-2'), 'L2 sem captação: gestor do dono do anúncio pode (regra antiga)');
SELECT pg_temp.as_user(:'c3');
SELECT pg_temp.ok(NOT public.owner_feedback_can_edit('630699001-1') AND NOT public.owner_feedback_can_edit('630699001-2'),
  'outro corretor da mesma imobiliária não pode');
SELECT pg_temp.ok(pg_temp.snaps('630699001-1') + pg_temp.snaps('630699001-2') = 0, 'outro corretor não vê números');

-- 5) Admin ----------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(public.owner_feedback_can_edit('630699001-1') AND public.owner_feedback_can_edit('630699001-2'),
  'admin da imobiliária continua podendo');
SELECT pg_temp.ok(pg_temp.snaps('630699001-1') = 1 AND pg_temp.snaps('630699001-2') = 1, 'admin vê só os números da própria imobiliária');
SELECT pg_temp.ok(pg_temp.marcas('630699001-1') = 2, 'admin lê as marcações do ligado');

-- 6) Outra imobiliária ------------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.marcas('630699001-1') = 0, 'admin/gestor da B não lê marcações da A');
SELECT pg_temp.ok(pg_temp.snaps('630699001-2') = 0, 'admin/gestor da B não vê números da A');
SELECT pg_temp.ok(pg_temp.snaps('630699001-1') = 1, 'B vê só o próprio anúncio de mesmo código');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.owner_feedback_action_done (organization_id, listing_code, action_id) VALUES (%L, %L, %L)',
  :'org_a', '630699001-1', :'act')) LIKE '42501%', 'B não marca no anúncio da A');
SELECT pg_temp.ok(public.owner_feedback_captador(:'org_b', '630699001-1') IS NULL, 'captação da A não vale para o código da B');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.owner_feedback_action_done (listing_code, action_id) VALUES (%L, %L)',
  '630699001-1', :'act_b')) IS NULL, 'B (admin) marca no próprio anúncio');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.marcas('630699001-1') = 2, 'captador da A não enxerga a marcação da B no mesmo código');

-- 7) Nada de dados/métricas mudou ---------------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.ok((SELECT md5(string_agg(broker_id::text || views || contacts, ',' ORDER BY listing_code, organization_id))
  FROM public.portal_listing_snapshots WHERE organization_id IN (:'org_a', :'org_b')) = :'metr_antes',
  'broker_id, views e contatos dos anúncios intactos');
SELECT pg_temp.ok((SELECT captor_id FROM public.exclusive_captures WHERE id = :'cap1') = :'c2'::uuid
  AND (SELECT broker_name FROM public.exclusive_captures WHERE id = :'cap1') = 'Carlos Saiu', 'captação e contrato intactos');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
