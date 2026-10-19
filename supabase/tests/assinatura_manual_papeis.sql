-- Suíte da migration 20261019160000 (assinatura manual — cartão t_e6f778ac). Roda DENTRO de transação
-- revertida (run-assinatura-manual-papeis.sh), em homologação ou clone local — nunca produção. Dados
-- fictícios; nenhuma chamada à Clicksign (só banco).
-- Papéis (org A = Única, 00000000-…-0001):
--   gestor   = UE Gestor (10…02, líder da Equipe UE, onde está o UE Corretor)
--   corretor = UE Corretor (10…03, dono da venda sintética)
--   admin    = QA A Admin
--   tl       = QA A Corretor Tres, vira team_leader e colíder da Equipe UE SÓ nesta transação
--   juridico = QA A Corretor Dois, ganha o papel juridico SÓ nesta transação
--   fora     = QA B Admin (org B) e juridico_b = QA B Corretor Um com papel juridico na org B
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
-- Nº de contratos assinados anexados na venda (lido como superusuário).
CREATE FUNCTION pg_temp.nass(_s uuid) RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM public.sale_documents WHERE sale_id = _s AND tipo = 'contrato_assinado' AND deleted_at IS NULL $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org \gset
SELECT '2a000000-0000-4000-8000-0000000000b0' AS orgb \gset
INSERT INTO ids VALUES ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('corretor', '10000000-0000-4000-8000-000000000003'), ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('tl', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('juridico', 'ebffaded-075c-493f-89e2-1d3d62901dc4'),
  ('fora', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536'), ('juridico_b', '23e65aaf-2614-463e-baec-cf562bb94244'),
  ('venda', gen_random_uuid()), ('cap', gen_random_uuid());

-- Papéis só nesta transação revertida.
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (pg_temp.id('juridico'), 'juridico', :'org'), (pg_temp.id('tl'), 'team_leader', :'org'),
  (pg_temp.id('juridico_b'), 'juridico', :'orgb');
-- Team leader = colíder da Equipe UE (o corretor só pode estar numa equipe).
INSERT INTO public.team_co_leaders (team_id, user_id, organization_id)
  SELECT tm.team_id, pg_temp.id('tl'), :'org' FROM public.team_members tm WHERE tm.membro_id = pg_temp.id('corretor');

INSERT INTO public.clicksign_org_settings (organization_id, enabled, sale_enabled, test_mode, access_token_secret_id)
  VALUES (:'org', true, true, true, gen_random_uuid())
  ON CONFLICT (organization_id) DO UPDATE SET enabled = true, sale_enabled = true, access_token_secret_id = gen_random_uuid();

-- Mesmos gatilhos de negócio desligados da suíte clicksign_venda.sql (venda sintética sem valores).
ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_pagamento_inconsistente,
  DISABLE TRIGGER trg_bloquear_avanco_com_previsao_incompleta, DISABLE TRIGGER trg_bloquear_avanco_sem_endereco,
  DISABLE TRIGGER trg_bloquear_participante_sem_cadastro, DISABLE TRIGGER trg_bloquear_valor_negociado_inconsistente,
  DISABLE TRIGGER trg_validar_distribuicao_aprovar_gestor, DISABLE TRIGGER trg_sales_sync_antes_financeiro,
  DISABLE TRIGGER trg_sales_sync_antes_financeiro_status, DISABLE TRIGGER enforce_matricula_descricao;
ALTER TABLE public.sale_documents ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.sale_status_history ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.clicksign_envelopes ALTER COLUMN created_at SET DEFAULT clock_timestamp();
GRANT SELECT ON public.profiles TO authenticated;

INSERT INTO public.sales (id, corretor_id, imovel_id, status, organization_id)
  VALUES (pg_temp.id('venda'), pg_temp.id('corretor'), 'AM-TESTE-1', 'contrato_ok_corretor', :'org');
INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, status, organization_id, created_at)
  VALUES (pg_temp.id('venda'), 'contrato', 'outros', :'org' || '/' || pg_temp.id('venda') || '/outros/contrato/v1.pdf',
          'contrato-v1.pdf', 'enviado', :'org', now() - interval '2 hours');

-- Põe a venda numa etapa (setup; não conta como ação de usuário) e limpa os assinados de teste.
CREATE FUNCTION pg_temp.reset(_s uuid, _st text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  DELETE FROM public.sale_documents WHERE sale_id = _s AND tipo = 'contrato_assinado';
  DELETE FROM public.occurrences WHERE sale_id = _s;
  UPDATE public.sales SET status = _st::public.sale_status WHERE id = _s;
  INSERT INTO public.sale_status_history (sale_id, de, para, autor_id, motivo, organization_id)
    VALUES (_s, 'contrato_ok_corretor', _st::public.sale_status, NULL, 'setup do teste', current_setting('t.org')::uuid);
  SET LOCAL session_replication_role = origin;
END $$;

-- Ações como um usuário (authenticated). Retornam NULL se deu certo, ou a mensagem de erro.
CREATE FUNCTION pg_temp.escolher_papel(_u uuid, _s uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _e text;
BEGIN
  PERFORM pg_temp.as_user(_u); SET LOCAL ROLE authenticated;
  _e := pg_temp.err(format($q$SELECT public.change_sale_status(%L, 'aguardando_assinatura', 'Assinatura manual (papel)')$q$, _s));
  RESET ROLE; RETURN _e;
END $$;
CREATE FUNCTION pg_temp.subir(_u uuid, _s uuid, _tipo text DEFAULT 'contrato_assinado') RETURNS text LANGUAGE plpgsql AS $$
DECLARE _e text; _p text := current_setting('t.org') || '/' || _s || '/outros/' || _tipo || '/' || gen_random_uuid() || '.pdf';
BEGIN
  PERFORM pg_temp.as_user(_u); SET LOCAL ROLE authenticated;
  _e := pg_temp.err(format($q$INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name,
      uploaded_by, status, organization_id) VALUES (%L, %L, 'outros', %L, 'assinado-papel.pdf', %L, 'enviado', %L)$q$,
    _s, _tipo, _p, _u, current_setting('t.org')));
  RESET ROLE; RETURN _e;
END $$;
CREATE FUNCTION pg_temp.subir_storage(_u uuid, _s uuid, _pasta text DEFAULT 'contrato_assinado') RETURNS text LANGUAGE plpgsql AS $$
DECLARE _e text;
BEGIN
  PERFORM pg_temp.as_user(_u); SET LOCAL ROLE authenticated;
  _e := pg_temp.err(format($q$INSERT INTO storage.objects (bucket_id, name, owner, metadata)
      VALUES ('sale-documents', %L, %L, '{"mimetype":"application/pdf"}')$q$,
    current_setting('t.org') || '/' || _s || '/outros/' || _pasta || '/' || gen_random_uuid() || '.pdf', _u));
  RESET ROLE; RETURN _e;
END $$;
CREATE FUNCTION pg_temp.marcar(_u uuid, _s uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _e text;
BEGIN
  PERFORM pg_temp.as_user(_u); SET LOCAL ROLE authenticated;
  _e := pg_temp.err(format($q$SELECT public.change_sale_status(%L, 'contrato_assinado', NULL)$q$, _s));
  RESET ROLE; RETURN _e;
END $$;
SELECT set_config('t.org', :'org', false);

-- ===== 1) Escolher "Manual – papel" (contrato_ok_corretor → aguardando_assinatura) =====
SELECT pg_temp.ok(pg_temp.escolher_papel(pg_temp.id('corretor'), pg_temp.id('venda')) IS NOT NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'contrato_ok_corretor', 'corretor NÃO escolhe o papel');
SELECT pg_temp.ok(pg_temp.escolher_papel(pg_temp.id('fora'), pg_temp.id('venda')) IS NOT NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'contrato_ok_corretor', 'admin de OUTRA organização NÃO escolhe o papel');
SELECT pg_temp.ok(pg_temp.escolher_papel(pg_temp.id('juridico_b'), pg_temp.id('venda')) IS NOT NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'contrato_ok_corretor', 'jurídico de OUTRA organização NÃO escolhe o papel');
SELECT pg_temp.ok(pg_temp.escolher_papel(pg_temp.id('juridico'), pg_temp.id('venda')) IS NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura', 'jurídico escolhe o papel (vai a aguardando_assinatura)');
SELECT pg_temp.reset(pg_temp.id('venda'), 'contrato_ok_corretor');
SELECT pg_temp.ok(pg_temp.escolher_papel(pg_temp.id('gestor'), pg_temp.id('venda')) IS NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura', 'gestor escolhe o papel');
SELECT pg_temp.reset(pg_temp.id('venda'), 'contrato_ok_corretor');
SELECT pg_temp.ok(pg_temp.escolher_papel(pg_temp.id('tl'), pg_temp.id('venda')) IS NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura', 'team leader escolhe o papel');
SELECT pg_temp.reset(pg_temp.id('venda'), 'contrato_ok_corretor');
SELECT pg_temp.ok(pg_temp.escolher_papel(pg_temp.id('admin'), pg_temp.id('venda')) IS NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura', 'ADM escolhe o papel');

-- ===== 2) Subir o contrato assinado (aguardando_assinatura) =====
SELECT pg_temp.reset(pg_temp.id('venda'), 'aguardando_assinatura');
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('corretor'), pg_temp.id('venda')) IS NOT NULL
  AND pg_temp.nass(pg_temp.id('venda')) = 0, 'corretor NÃO sobe contrato assinado');
SELECT pg_temp.ok(pg_temp.subir_storage(pg_temp.id('corretor'), pg_temp.id('venda')) IS NOT NULL,
  'corretor NÃO grava o arquivo no storage');
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('fora'), pg_temp.id('venda')) IS NOT NULL
  AND pg_temp.nass(pg_temp.id('venda')) = 0, 'admin de OUTRA organização NÃO sobe');
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('juridico_b'), pg_temp.id('venda')) IS NOT NULL
  AND pg_temp.nass(pg_temp.id('venda')) = 0, 'jurídico de OUTRA organização NÃO sobe');
SELECT pg_temp.ok(pg_temp.subir_storage(pg_temp.id('juridico_b'), pg_temp.id('venda')) IS NOT NULL,
  'jurídico de OUTRA organização NÃO grava no storage');
-- jurídico: só o contrato assinado, só nessa pasta
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('juridico'), pg_temp.id('venda'), 'rg') IS NOT NULL,
  'jurídico NÃO sobe outro documento (rg) na assinatura');
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('juridico'), pg_temp.id('venda'), 'contrato') IS NOT NULL,
  'jurídico NÃO troca o contrato (tipo contrato) na assinatura');
SELECT pg_temp.ok(pg_temp.subir_storage(pg_temp.id('juridico'), pg_temp.id('venda'), 'contrato') IS NOT NULL,
  'jurídico NÃO grava no storage fora de outros/contrato_assinado');
SELECT pg_temp.ok(pg_temp.subir_storage(pg_temp.id('juridico'), pg_temp.id('venda')) IS NULL,
  'jurídico grava o arquivo em outros/contrato_assinado');
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('juridico'), pg_temp.id('venda')) IS NULL
  AND pg_temp.nass(pg_temp.id('venda')) = 1, 'jurídico sobe o contrato assinado');
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('juridico'), pg_temp.id('venda')) IS NULL
  AND pg_temp.nass(pg_temp.id('venda')) = 2, 'jurídico substitui (nova versão do assinado)');
-- fora de aguardando_assinatura o jurídico não sobe assinado
SELECT pg_temp.reset(pg_temp.id('venda'), 'contrato_ok_corretor');
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('juridico'), pg_temp.id('venda')) IS NOT NULL
  AND pg_temp.nass(pg_temp.id('venda')) = 0, 'jurídico NÃO sobe assinado antes de ir para assinatura');
SELECT pg_temp.reset(pg_temp.id('venda'), 'aguardando_assinatura');
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('gestor'), pg_temp.id('venda')) IS NULL, 'gestor sobe o contrato assinado');
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('tl'), pg_temp.id('venda')) IS NULL, 'team leader sobe o contrato assinado');
SELECT pg_temp.ok(pg_temp.subir(pg_temp.id('admin'), pg_temp.id('venda')) IS NULL, 'ADM sobe o contrato assinado');

-- ===== 3) Marcar contrato assinado =====
SELECT pg_temp.reset(pg_temp.id('venda'), 'aguardando_assinatura');
SELECT pg_temp.ok(pg_temp.marcar(pg_temp.id('juridico'), pg_temp.id('venda')) LIKE 'Anexe o contrato assinado%',
  'sem o assinado anexado ninguém marca (regra mantida)');
SELECT pg_temp.subir(pg_temp.id('admin'), pg_temp.id('venda'));
SELECT pg_temp.ok(pg_temp.marcar(pg_temp.id('corretor'), pg_temp.id('venda')) IS NOT NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura', 'corretor NÃO marca contrato assinado');
SELECT pg_temp.ok(pg_temp.marcar(pg_temp.id('fora'), pg_temp.id('venda')) IS NOT NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura', 'admin de OUTRA organização NÃO marca');
SELECT pg_temp.ok(pg_temp.marcar(pg_temp.id('juridico_b'), pg_temp.id('venda')) IS NOT NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura', 'jurídico de OUTRA organização NÃO marca');
SELECT pg_temp.ok(pg_temp.marcar(pg_temp.id('juridico'), pg_temp.id('venda')) IS NULL
  AND pg_temp.st(pg_temp.id('venda')) = 'contrato_assinado', 'jurídico marca contrato assinado');
SELECT pg_temp.ok((SELECT autor_id FROM public.sale_status_history WHERE sale_id = pg_temp.id('venda')
    AND para = 'contrato_assinado' ORDER BY created_at DESC LIMIT 1) = pg_temp.id('juridico'),
  'histórico registra o jurídico como autor (data da venda = esse momento, regra inalterada)');
SELECT pg_temp.reset(pg_temp.id('venda'), 'aguardando_assinatura');
SELECT pg_temp.subir(pg_temp.id('admin'), pg_temp.id('venda'));
SELECT pg_temp.ok(pg_temp.marcar(pg_temp.id('gestor'), pg_temp.id('venda')) IS NULL, 'gestor marca contrato assinado');
SELECT pg_temp.reset(pg_temp.id('venda'), 'aguardando_assinatura');
SELECT pg_temp.subir(pg_temp.id('admin'), pg_temp.id('venda'));
SELECT pg_temp.ok(pg_temp.marcar(pg_temp.id('tl'), pg_temp.id('venda')) IS NULL, 'team leader marca contrato assinado');
SELECT pg_temp.reset(pg_temp.id('venda'), 'aguardando_assinatura');
SELECT pg_temp.subir(pg_temp.id('admin'), pg_temp.id('venda'));
SELECT pg_temp.ok(pg_temp.marcar(pg_temp.id('admin'), pg_temp.id('venda')) IS NULL, 'ADM marca contrato assinado');

-- ===== 4) O jurídico NÃO ganhou nada além disso =====
SELECT pg_temp.reset(pg_temp.id('venda'), 'aguardando_assinatura');
SELECT pg_temp.as_user(pg_temp.id('juridico'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT public.change_sale_status(%L, 'em_elaboracao_contrato', 'x')$q$,
  pg_temp.id('venda'))) IS NOT NULL, 'jurídico NÃO devolve da assinatura (segue com gestor/ADM)');
SELECT pg_temp.ok(NOT public.can_edit_sale_stage(pg_temp.id('juridico'), pg_temp.id('venda')),
  'jurídico continua sem editar a venda na assinatura (can_edit_sale_stage = false)');
SELECT coalesce(pg_temp.err(format($q$UPDATE public.sales SET imovel_id = 'MEXEU' WHERE id = %L$q$,
  pg_temp.id('venda'))), 'nenhuma linha') AS err_upd \gset
RESET ROLE;
SELECT pg_temp.ok((SELECT imovel_id FROM public.sales WHERE id = pg_temp.id('venda')) = 'AM-TESTE-1',
  'jurídico NÃO altera os dados da venda (' || left(:'err_upd', 60) || ')');

-- ===== 5) Troca de ideia sem envio em dobro (venda) =====
-- manual → Clicksign: sem envelope e sem assinado anexado depois de ir para assinatura → autoriza.
SELECT pg_temp.reset(pg_temp.id('venda'), 'aguardando_assinatura');
SELECT pg_temp.as_user(pg_temp.id('juridico'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_sale_authorize(pg_temp.id('venda'))->>'contrato') IS NOT NULL,
  'manual → Clicksign: jurídico autorizado em aguardando_assinatura sem envelope');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', pg_temp.id('venda'))) LIKE 'Apenas gestor%',
  'manual → Clicksign: corretor continua sem enviar');
RESET ROLE;
-- assinado no papel já anexado: não envia de novo
SELECT pg_temp.subir(pg_temp.id('juridico'), pg_temp.id('venda'));
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', pg_temp.id('venda')))
  LIKE 'O contrato assinado no papel já foi anexado%', 'assinado no papel anexado: Clicksign recusa (sem envio em dobro)');
RESET ROLE;
-- envelope ativo: recusa (cancele antes)
SELECT pg_temp.reset(pg_temp.id('venda'), 'aguardando_assinatura');
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
INSERT INTO public.clicksign_envelopes (organization_id, origem, sale_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key)
  VALUES (:'org', 'venda', pg_temp.id('venda'), public.clicksign_sale_contrato(pg_temp.id('venda')), 'running', true,
    '[]', pg_temp.id('admin'), gen_random_uuid()::text, gen_random_uuid()::text);
RESET ROLE;
INSERT INTO ids SELECT 'env', id FROM public.clicksign_envelopes WHERE sale_id = pg_temp.id('venda') AND status = 'running';
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', pg_temp.id('venda')))
  = 'Este contrato já está em envio ou em assinatura na Clicksign', 'envelope ativo: segundo envio recusado');
RESET ROLE;
-- Clicksign → manual: cancela com motivo papel; venda fica em aguardando_assinatura, sem aviso "envie de novo".
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.clicksign_sale_canceled(pg_temp.id('env'), 'papel', pg_temp.id('juridico')) = 'canceled',
  'Clicksign → manual: envelope cancelado (motivo papel)');
SELECT pg_temp.ok(public.clicksign_sale_canceled(pg_temp.id('env'), 'cancel', NULL) = 'already',
  'webhook de cancelamento depois do papel é idempotente');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura',
  'Clicksign → manual: venda continua em aguardando_assinatura (assinatura manual)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.notifications WHERE sale_id = pg_temp.id('venda')
  AND titulo = 'Clicksign: envie o contrato de novo'), 'Clicksign → manual: sem aviso "envie de novo"');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.activity_logs WHERE sale_id = pg_temp.id('venda')
  AND acao = 'clicksign_cancelado' AND payload->>'motivo' = 'papel'), 'histórico registra a troca para o papel');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.clicksign_sale_canceled(gen_random_uuid(), 'qualquer', NULL)$q$)
  = 'Motivo inválido', 'motivo desconhecido recusado');
-- Depois de cancelar dá para voltar à Clicksign (envelope cancelado não bloqueia).
SELECT pg_temp.as_user(pg_temp.id('gestor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_sale_authorize(pg_temp.id('venda'))->>'contrato') IS NOT NULL,
  'depois de cancelar, gestor pode voltar para a Clicksign');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('juridico'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.clicksign_sale_canceled(gen_random_uuid(), 'papel', NULL)$q$) IS NOT NULL,
  'usuário logado não chama clicksign_sale_canceled direto (só o servidor)');
RESET ROLE;

-- ===== 6) Captação: troca sem duplicar =====
-- A homologação adm-hom-ensaio está sem a coluna manual (migration 20261008160000, já em produção);
-- cria só nesta transação revertida, se faltar.
ALTER TABLE public.exclusive_captures ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;
INSERT INTO storage.buckets (id, name, public) VALUES ('exclusive-captures', 'exclusive-captures', false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.organization_modules (organization_id, module, enabled)
  VALUES (:'org', 'captacao_exclusiva', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO ids SELECT 'unit', id FROM public.exclusive_units WHERE organization_id = :'org' AND ativo ORDER BY nome LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('corretor'));
INSERT INTO ids SELECT 'c1', public.exclusive_create_unit(pg_temp.id('unit'));
RESET ROLE;
SET session_replication_role = replica;
UPDATE public.exclusive_captures SET status = 'em_assinatura' WHERE id = pg_temp.id('c1');
SET session_replication_role = origin;
INSERT INTO public.exclusive_documents (capture_id, kind, storage_path, file_name, uploaded_by, organization_id, created_at)
  VALUES (pg_temp.id('c1'), 'gerado', :'org' || '/' || pg_temp.id('c1') || '/gerado.pdf', 'g.pdf', pg_temp.id('corretor'),
    :'org', clock_timestamp() - interval '1 hour');
SELECT pg_temp.as_user(pg_temp.id('juridico'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(public.clicksign_capture_authorize(pg_temp.id('c1')) = :'org'::uuid,
  'captação manual → Clicksign: autorizado em em_assinatura sem envelope');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_authorize(%L)', pg_temp.id('c1'))) IS NOT NULL,
  'captação: corretor sem ser líder não envia pela Clicksign');
RESET ROLE;
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
INSERT INTO public.clicksign_envelopes (organization_id, origem, capture_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key)
  SELECT :'org', 'captacao', pg_temp.id('c1'), d.id, 'running', true, '[]', pg_temp.id('admin'),
    gen_random_uuid()::text, gen_random_uuid()::text
  FROM public.exclusive_documents d WHERE d.capture_id = pg_temp.id('c1') AND d.kind = 'gerado';
RESET ROLE;
INSERT INTO ids SELECT 'envc', id FROM public.clicksign_envelopes WHERE capture_id = pg_temp.id('c1') AND status = 'running';
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_authorize(%L)', pg_temp.id('c1')))
  = 'Este contrato já está em envio ou em assinatura na Clicksign', 'captação: envelope ativo bloqueia segundo envio');
RESET ROLE;
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.clicksign_capture_canceled_papel(pg_temp.id('envc'), pg_temp.id('admin')) = 'canceled',
  'captação Clicksign → manual: envelope cancelado');
SELECT pg_temp.ok(public.clicksign_capture_canceled_papel(pg_temp.id('envc'), pg_temp.id('admin')) = 'already',
  'captação: cancelar para o papel é idempotente');
RESET ROLE;
SELECT pg_temp.ok((SELECT status::text FROM public.exclusive_captures WHERE id = pg_temp.id('c1')) = 'em_assinatura',
  'captação continua em em_assinatura (segue o fluxo manual)');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.exclusive_history WHERE capture_id = pg_temp.id('c1')
  AND action = 'clicksign_cancelado' AND detail LIKE '%assinatura manual (papel)%'), 'captação: histórico da troca');
INSERT INTO public.exclusive_documents (capture_id, kind, storage_path, file_name, uploaded_by, organization_id, created_at)
  VALUES (pg_temp.id('c1'), 'assinado', :'org' || '/' || pg_temp.id('c1') || '/assinado.pdf', 'a.pdf', pg_temp.id('admin'),
    :'org', clock_timestamp());
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_authorize(%L)', pg_temp.id('c1')))
  LIKE 'O contrato assinado já foi anexado%', 'captação: assinado no papel anexado bloqueia a Clicksign');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('juridico'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_capture_canceled_papel(%L, NULL)', pg_temp.id('envc'))) IS NOT NULL,
  'captação: usuário logado não chama o cancelamento direto (só o servidor)');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
