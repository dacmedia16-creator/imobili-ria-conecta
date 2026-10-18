-- Suíte do pacote de correções da auditoria Clicksign (migration 20261019090000, cartão t_eb3f23e0).
-- Roda DENTRO de transação revertida (run-clicksign-auditoria.sh), em homologação ou clone — nunca
-- produção. Dados fictícios; nenhuma chamada à Clicksign (só banco).
-- Perfis da homologação (Única = org A): UE Corretor (10…03, membro da Equipe UE), UE Gestor (10…02,
-- líder da Equipe UE), QA A Admin, um corretor de FORA da equipe (5745cbff…) e QA A Corretor Tres
-- (a742cfda…), promovido a team_leader e co-líder da Equipe UE só nesta transação.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid::text, true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.st(_s uuid) RETURNS text LANGUAGE sql AS
  $$ SELECT status::text FROM public.sales WHERE id = _s $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org \gset
INSERT INTO ids VALUES ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('corretor', '10000000-0000-4000-8000-000000000003'), ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('fora', '5745cbff-22b6-4a28-a515-dd6706504b8b'), ('tl', 'a742cfda-4731-4fa8-989a-374d2fdf0820'),
  ('team', '1a000000-0000-4000-8000-000000000001'),
  ('v_eq', gen_random_uuid()), ('v_fora', gen_random_uuid()), ('v_canc', gen_random_uuid()),
  ('v_rec', gen_random_uuid());

INSERT INTO public.clicksign_org_settings (organization_id, enabled, sale_enabled, test_mode, access_token_secret_id)
  VALUES (:'org', true, true, true, gen_random_uuid())
  ON CONFLICT (organization_id) DO UPDATE SET enabled = true, sale_enabled = true,
    access_token_secret_id = gen_random_uuid();
INSERT INTO storage.buckets (id, name, public) VALUES ('exclusive-captures', 'exclusive-captures', false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.organization_modules (organization_id, module, enabled)
  VALUES (:'org', 'captacao_exclusiva', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
-- Team leader só nesta transação (co-líder da Equipe UE, que tem o UE Corretor).
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('tl'), 'team_leader') ON CONFLICT DO NOTHING;
INSERT INTO public.team_co_leaders (team_id, user_id) VALUES (pg_temp.id('team'), pg_temp.id('tl'))
  ON CONFLICT DO NOTHING;

ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_pagamento_inconsistente,
  DISABLE TRIGGER trg_bloquear_avanco_com_previsao_incompleta, DISABLE TRIGGER trg_bloquear_avanco_sem_endereco,
  DISABLE TRIGGER trg_bloquear_participante_sem_cadastro, DISABLE TRIGGER trg_bloquear_valor_negociado_inconsistente,
  DISABLE TRIGGER trg_validar_distribuicao_aprovar_gestor, DISABLE TRIGGER trg_sales_sync_antes_financeiro,
  DISABLE TRIGGER trg_sales_sync_antes_financeiro_status, DISABLE TRIGGER enforce_matricula_descricao;
ALTER TABLE public.sale_documents ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.clicksign_envelopes ALTER COLUMN created_at SET DEFAULT clock_timestamp();

INSERT INTO public.sales (id, corretor_id, imovel_id, status, organization_id) VALUES
  (pg_temp.id('v_eq'), pg_temp.id('corretor'), 'CSA-EQUIPE', 'contrato_ok_corretor', :'org'),
  (pg_temp.id('v_fora'), pg_temp.id('fora'), 'CSA-FORA', 'contrato_ok_corretor', :'org'),
  (pg_temp.id('v_canc'), pg_temp.id('corretor'), 'CSA-CANC', 'contrato_ok_corretor', :'org'),
  (pg_temp.id('v_rec'), pg_temp.id('corretor'), 'CSA-REC', 'contrato_ok_corretor', :'org');
INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, status)
  SELECT v, 'contrato', 'outros', :'org' || '/' || v || '/outros/contrato/c.pdf', 'c.pdf', 'enviado'
  FROM unnest(ARRAY[pg_temp.id('v_eq'), pg_temp.id('v_fora'), pg_temp.id('v_canc'), pg_temp.id('v_rec')]) v;
-- Tamanho do contrato no Storage (para a tela avisar acima de 10 MB).
INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('sale-documents', :'org' || '/' || pg_temp.id('v_eq') || '/outros/contrato/c.pdf',
          '{"mimetype":"application/pdf","size":12582912}');

-- Captações: uma do UE Corretor (equipe do TL) e uma do corretor de fora.
INSERT INTO ids SELECT 'unit', id FROM public.exclusive_units WHERE organization_id = :'org' AND ativo ORDER BY nome LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('corretor'));
INSERT INTO ids SELECT 'c_eq', public.exclusive_create_unit(pg_temp.id('unit'));
SELECT pg_temp.as_user(pg_temp.id('fora'));
INSERT INTO ids SELECT 'c_fora', public.exclusive_create_unit(pg_temp.id('unit'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.id('c_eq') IS NOT NULL AND pg_temp.id('c_fora') IS NOT NULL, 'pré: captações sintéticas criadas');

-- ===================== E) R1: team leader envia, sem ampliar visibilidade =====================
SELECT pg_temp.as_user(pg_temp.id('tl'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.clicksign_sender_ok(pg_temp.id('tl')), 'team leader passa em clicksign_sender_ok');
SELECT pg_temp.ok((public.clicksign_sale_config(pg_temp.id('v_eq'))->>'can_send')::bool,
  'venda da equipe: team leader vê o botão (can_send)');
SELECT pg_temp.ok((public.clicksign_sale_authorize(pg_temp.id('v_eq'))->>'contrato') IS NOT NULL,
  'venda da equipe em contrato_ok_corretor: team leader autorizado a enviar');
SELECT pg_temp.ok((public.clicksign_sale_config(pg_temp.id('v_fora'))->>'enabled')::bool IS FALSE,
  'venda fora da equipe: config escondida para o team leader');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', pg_temp.id('v_fora')))
  = 'Venda não disponível', 'venda fora da equipe: team leader NÃO envia');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_manage_authorize(%L)', pg_temp.id('v_fora')))
  = 'Venda não disponível', 'venda fora da equipe: team leader NÃO gerencia');
SELECT pg_temp.ok(public.clicksign_sale_extra_candidates(pg_temp.id('v_fora'), '') = '[]'::jsonb,
  'venda fora da equipe: team leader não busca partes');
-- Captação
SELECT pg_temp.ok((public.clicksign_capture_config(pg_temp.id('c_eq'))->>'can_send')::bool,
  'captação da equipe: team leader pode enviar (can_send)');
-- (Homologação sem a coluna exclusive_captures.manual: a função original falha igual depois da
-- permissão; aqui confere só que a PERMISSÃO passou. Em produção a coluna existe.)
SELECT pg_temp.ok(coalesce(pg_temp.err(format('SELECT public.clicksign_capture_authorize(%L)', pg_temp.id('c_eq'))), '')
  NOT LIKE 'Apenas gestor%',
  'captação da equipe: permissão do team leader passa (segue para as regras de etapa)');
SELECT pg_temp.ok((public.clicksign_capture_config(pg_temp.id('c_fora'))->>'enabled')::bool IS FALSE,
  'captação fora da equipe: escondida para o team leader');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_authorize(%L)', pg_temp.id('c_fora')))
  LIKE 'Apenas gestor, team leader%', 'captação fora da equipe: team leader NÃO envia');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_manage_authorize(%L)', pg_temp.id('c_fora')))
  LIKE 'Apenas gestor, team leader%', 'captação fora da equipe: team leader NÃO gerencia');
RESET ROLE;
-- Etapa e jurídico continuam valendo para o team leader.
UPDATE public.sales SET contrato_libera_assinatura = false WHERE id = pg_temp.id('v_eq');
SELECT pg_temp.as_user(pg_temp.id('tl'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', pg_temp.id('v_eq')))
  = 'O jurídico bloqueou a assinatura deste contrato', 'team leader: bloqueio do jurídico vale');
RESET ROLE;
SET session_replication_role = replica;
UPDATE public.sales SET contrato_libera_assinatura = true, status = 'em_elaboracao_contrato'
  WHERE id = pg_temp.id('v_eq');
SET session_replication_role = origin;
SELECT pg_temp.as_user(pg_temp.id('tl'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', pg_temp.id('v_eq')))
  LIKE 'A venda precisa estar com o contrato conferido%', 'team leader: regra de etapa vale');
RESET ROLE;
SET session_replication_role = replica;
UPDATE public.sales SET status = 'contrato_conferencia_gestor' WHERE id = pg_temp.id('v_eq');
SET session_replication_role = origin;
SELECT pg_temp.as_user(pg_temp.id('tl'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_sale_authorize(pg_temp.id('v_eq'))->>'org') IS NOT NULL,
  'team leader: atalho do gestor (contrato_conferencia_gestor) vale para a equipe');
SELECT pg_temp.ok((public.clicksign_sale_config(pg_temp.id('v_eq'))->'contrato'->>'size')::bigint = 12582912,
  'config da venda devolve o tamanho do contrato (tela avisa acima de 10 MB)');
RESET ROLE;
-- Corretor continua só acompanhando; gestor e admin continuam enviando.
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT public.clicksign_sender_ok(pg_temp.id('corretor'))
  AND NOT (public.clicksign_capture_config(pg_temp.id('c_eq'))->>'can_send')::bool,
  'corretor continua sem enviar (só acompanha)');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_capture_config(pg_temp.id('c_fora'))->>'can_send')::bool
  AND (public.clicksign_sale_authorize(pg_temp.id('v_fora'))->>'org') IS NOT NULL,
  'admin continua enviando em qualquer venda/captação da org');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('gestor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.clicksign_capture_sender_ok(pg_temp.id('gestor'), pg_temp.id('c_fora')),
  'gestor mantém o alcance de hoje na captação (não depende da equipe)');
RESET ROLE;

-- ===================== A) R6: envelope cancelado nunca anexa =====================
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
INSERT INTO public.clicksign_envelopes (organization_id, origem, sale_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key, last_event)
  VALUES (:'org', 'venda', pg_temp.id('v_canc'), public.clicksign_sale_contrato(pg_temp.id('v_canc')),
    'canceled', true, '[]', pg_temp.id('admin'), gen_random_uuid()::text, gen_random_uuid()::text, 'deadline');
RESET ROLE;
INSERT INTO ids SELECT 'env_canc', id FROM public.clicksign_envelopes WHERE sale_id = pg_temp.id('v_canc');
INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('sale-documents', :'org' || '/' || pg_temp.id('v_canc') || '/outros/contrato_assinado/44444444-4444-4444-8444-444444444444.pdf',
          '{"mimetype":"application/pdf"}');
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.clicksign_sale_attach_signed(pg_temp.id('env_canc'),
  :'org' || '/' || pg_temp.id('v_canc') || '/outros/contrato_assinado/44444444-4444-4444-8444-444444444444.pdf',
  'contrato-assinado-clicksign.pdf') = 'stale', 'venda: deadline e depois document_closed → stale');
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'canceled' AND signed_document_id IS NULL AND last_event = 'deadline'
  FROM public.clicksign_envelopes WHERE id = pg_temp.id('env_canc')), 'venda: envelope continua cancelado');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.sale_documents WHERE sale_id = pg_temp.id('v_canc')
  AND tipo = 'contrato_assinado'), 'venda: nada anexado como contrato assinado');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.notifications WHERE sale_id = pg_temp.id('v_canc')
  AND mensagem LIKE 'Todos assinaram%'), 'venda: sem aviso "Todos assinaram"');
SELECT pg_temp.ok(pg_temp.st(pg_temp.id('v_canc')) = 'contrato_ok_corretor', 'venda: etapa intacta');

-- Captação: mesmo caso.
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
INSERT INTO public.clicksign_envelopes (organization_id, origem, capture_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key, last_event)
  VALUES (:'org', 'captacao', pg_temp.id('c_eq'), gen_random_uuid(), 'canceled', true, '[]',
    pg_temp.id('admin'), gen_random_uuid()::text, gen_random_uuid()::text, 'deadline');
RESET ROLE;
INSERT INTO ids SELECT 'env_ccap', id FROM public.clicksign_envelopes WHERE capture_id = pg_temp.id('c_eq');
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.clicksign_attach_signed(pg_temp.id('env_ccap'),
  :'org' || '/' || pg_temp.id('c_eq') || '/55555555-5555-4555-8555-555555555555.pdf', 'x.pdf') = 'stale',
  'captação: deadline e depois document_closed → stale');
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'canceled' AND signed_document_id IS NULL FROM public.clicksign_envelopes
  WHERE id = pg_temp.id('env_ccap')) AND NOT EXISTS (SELECT 1 FROM public.exclusive_documents
  WHERE capture_id = pg_temp.id('c_eq') AND kind = 'assinado'), 'captação: nada anexado, envelope cancelado');

-- ===================== D) R3: error_detail =====================
SELECT pg_temp.ok(pg_temp.err(format($q$UPDATE public.clicksign_envelopes SET error_detail = 'x@example.com'
  WHERE id = %L$q$, pg_temp.id('env_canc'))) LIKE '%error_detail_check%', 'error_detail recusa e-mail');
SELECT pg_temp.ok(pg_temp.err(format($q$UPDATE public.clicksign_envelopes SET error_detail = repeat('a', 121)
  WHERE id = %L$q$, pg_temp.id('env_canc'))) LIKE '%error_detail_check%', 'error_detail recusa mais de 120 caracteres');
UPDATE public.clicksign_envelopes SET status = 'error', error_code = 'signer:400',
  error_detail = '/data/attributes/name <nome> inválido' WHERE id = pg_temp.id('env_canc');
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT error_detail FROM public.clicksign_envelopes WHERE id = pg_temp.id('env_canc'))
  = '/data/attributes/name <nome> inválido', 'quem acompanha a venda lê error_detail (grant da coluna)');
SELECT pg_temp.ok(public.clicksign_sale_config(pg_temp.id('v_canc'))->'envelope'->>'error_detail'
  = '/data/attributes/name <nome> inválido', 'config da venda devolve error_detail');
RESET ROLE;

-- ===================== F) R5: conferir envio sem confirmação =====================
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
INSERT INTO public.clicksign_envelopes (organization_id, origem, sale_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key, error_code)
  VALUES (:'org', 'venda', pg_temp.id('v_rec'), public.clicksign_sale_contrato(pg_temp.id('v_rec')),
    'sending', true, '[]', pg_temp.id('admin'), gen_random_uuid()::text, gen_random_uuid()::text, 'activate_unknown');
RESET ROLE;
INSERT INTO ids SELECT 'env_rec', id FROM public.clicksign_envelopes WHERE sale_id = pg_temp.id('v_rec');
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_reconcile_authorize(%L, %L)', 'venda', pg_temp.id('v_rec')))
  LIKE 'Apenas gestor, team leader%', 'conferir: corretor não pode');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('tl'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_reconcile_authorize('venda', pg_temp.id('v_rec'))->>'envelope')::uuid
  = pg_temp.id('env_rec'), 'conferir: team leader da equipe pode (activate_unknown)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_reconcile_authorize(%L, %L)', 'venda', pg_temp.id('v_fora')))
  = 'Venda não disponível', 'conferir: team leader não alcança venda fora da equipe');
RESET ROLE;
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.clicksign_reconcile_apply(pg_temp.id('env_rec'), 'running', pg_temp.id('admin')) = 'sent',
  'conferir: Clicksign running → sent');
SELECT pg_temp.ok(public.clicksign_reconcile_apply(pg_temp.id('env_rec'), 'running', pg_temp.id('admin')) = 'already',
  'conferir repetido: already (idempotente)');
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'running' AND error_code IS NULL FROM public.clicksign_envelopes
  WHERE id = pg_temp.id('env_rec')) AND pg_temp.st(pg_temp.id('v_rec')) = 'aguardando_assinatura',
  'conferir running: envelope em assinatura e venda em aguardando_assinatura');
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_reconcile_authorize(%L, %L)', 'venda', pg_temp.id('v_rec')))
  = 'Não há envio sem confirmação para conferir', 'conferir: envelope já em assinatura não aparece de novo');
RESET ROLE;
-- draft → libera novo envio (sem disparar nada)
UPDATE public.clicksign_envelopes SET status = 'sending', error_code = 'activate_unknown' WHERE id = pg_temp.id('env_rec');
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.clicksign_reconcile_apply(pg_temp.id('env_rec'), 'draft', NULL) = 'released',
  'conferir: rascunho → released');
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'error' AND error_code = 'reconcile:draft' FROM public.clicksign_envelopes
  WHERE id = pg_temp.id('env_rec')), 'conferir draft: envelope liberado (status error) para novo envio');
-- sending recente sem activate_unknown: não aparece (ainda pode estar enviando)
UPDATE public.clicksign_envelopes SET status = 'sending', error_code = NULL, updated_at = now() WHERE id = pg_temp.id('env_rec');
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_reconcile_authorize(%L, %L)', 'venda', pg_temp.id('v_rec')))
  = 'Não há envio sem confirmação para conferir', 'conferir: envio em andamento (< 5 min) não é tocado');
RESET ROLE;
UPDATE public.clicksign_envelopes SET updated_at = now() - interval '6 minutes' WHERE id = pg_temp.id('env_rec');
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_reconcile_authorize('venda', pg_temp.id('v_rec'))->>'envelope') IS NOT NULL,
  'conferir: sending parado há mais de 5 min aparece');
RESET ROLE;
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.clicksign_reconcile_apply(pg_temp.id('env_rec'), 'closed', NULL) = 'manual',
  'conferir: closed na Clicksign → manual');
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'sending' AND error_code = 'reconcile_manual:closed'
  FROM public.clicksign_envelopes WHERE id = pg_temp.id('env_rec')), 'conferir closed: não libera reenvio');

-- Grants: funções só de service_role não ficam abertas ao usuário logado.
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.clicksign_reconcile_apply(uuid,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.clicksign_reconcile_authorize(text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.clicksign_capture_sender_ok(uuid,uuid)', 'EXECUTE'),
  'grants: apply só service_role; nada aberto a anon');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
