-- Suíte da Clicksign na VENDA (migration 20261018200000). Roda DENTRO de transação revertida
-- (run-clicksign-venda.sh), em homologação ou clone local — nunca produção. Dados fictícios; nenhuma
-- chamada à Clicksign (só banco). Perfis da homologação: UE Gestor (gestor), UE Corretor (corretor),
-- QA A Admin (admin). Org A = Única (00000000-…-0001).
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
  ('venda', gen_random_uuid()), ('v2', gen_random_uuid());

-- Configuração ligada (segredo fictício: só o id; nada é lido do Vault aqui).
INSERT INTO public.clicksign_org_settings (organization_id, enabled, test_mode, access_token_secret_id)
  VALUES (:'org', true, true, gen_random_uuid())
  ON CONFLICT (organization_id) DO UPDATE SET enabled = true, access_token_secret_id = gen_random_uuid();

-- A venda sintética não tem pagamento/endereço/distribuição: desliga SÓ os gatilhos de negócio que
-- validam esses dados (nesta transação revertida). Ficam ligados a trigger de transição de status
-- (trg_validate_sale_status), a de organização e as da Clicksign, que são o alvo do teste.
ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_pagamento_inconsistente,
  DISABLE TRIGGER trg_bloquear_avanco_com_previsao_incompleta, DISABLE TRIGGER trg_bloquear_avanco_sem_endereco,
  DISABLE TRIGGER trg_bloquear_participante_sem_cadastro, DISABLE TRIGGER trg_bloquear_valor_negociado_inconsistente,
  DISABLE TRIGGER trg_validar_distribuicao_aprovar_gestor, DISABLE TRIGGER trg_sales_sync_antes_financeiro,
  DISABLE TRIGGER trg_sales_sync_antes_financeiro_status, DISABLE TRIGGER enforce_matricula_descricao;

-- Tudo roda numa transação só (now() constante): os horários de documento e envelope passam a usar o
-- relógio real, como aconteceria em requisições separadas.
ALTER TABLE public.sale_documents ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.clicksign_envelopes ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- Venda sintética do corretor, já com o contrato conferido (insert direto: setup).
INSERT INTO public.sales (id, corretor_id, imovel_id, status, organization_id)
  VALUES (pg_temp.id('venda'), pg_temp.id('corretor'), 'CS-TESTE-1', 'contrato_ok_corretor', :'org'),
         (pg_temp.id('v2'), pg_temp.id('corretor'), 'CS-TESTE-2', 'em_elaboracao_contrato', :'org');
INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, status, created_at)
  VALUES (pg_temp.id('venda'), 'contrato', 'outros', :'org' || '/x/outros/contrato/v1.pdf', 'contrato-v1.pdf',
          'enviado', now() - interval '2 hours');
INSERT INTO ids SELECT 'doc1', id FROM public.sale_documents WHERE sale_id = pg_temp.id('venda') AND tipo = 'contrato';

-- ===== config e autorização =====
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_sale_config(pg_temp.id('venda'))->>'enabled')::bool
  AND NOT (public.clicksign_sale_config(pg_temp.id('venda'))->>'can_send')::bool,
  'corretor vê a configuração, mas não pode enviar');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', pg_temp.id('venda')))
  LIKE 'Apenas gestor%', 'corretor não envia (só acompanha)');
SELECT pg_temp.ok(public.clicksign_sale_extra_candidates(pg_temp.id('venda'), '') = '[]'::jsonb,
  'corretor não busca partes do sistema');
RESET ROLE;

SELECT pg_temp.as_user(pg_temp.id('gestor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_sale_config(pg_temp.id('venda'))->>'enabled')::bool IS NOT FALSE,
  'gestor lê a configuração');
RESET ROLE;

SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_sale_authorize(pg_temp.id('venda'))->>'contrato')::uuid = pg_temp.id('doc1'),
  'admin autorizado; contrato vigente = último do jurídico');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', pg_temp.id('v2')))
  LIKE 'A venda precisa estar com o contrato conferido%', 'fora de contrato_ok_corretor: bloqueado');
RESET ROLE;

-- Bloqueio do jurídico
UPDATE public.sales SET contrato_libera_assinatura = false WHERE id = pg_temp.id('venda');
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', pg_temp.id('venda')))
  = 'O jurídico bloqueou a assinatura deste contrato', 'bloqueio do jurídico trava a Clicksign');
SELECT pg_temp.ok(NOT (public.clicksign_sale_config(pg_temp.id('venda'))->>'libera_assinatura')::bool,
  'config mostra o bloqueio do jurídico');
RESET ROLE;
UPDATE public.sales SET contrato_libera_assinatura = true WHERE id = pg_temp.id('venda');

-- Nova versão do contrato: a vigente passa a ser a última.
INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, status)
  VALUES (pg_temp.id('venda'), 'contrato', 'outros', :'org' || '/x/outros/contrato/v2.pdf', 'contrato-v2.pdf', 'enviado');
INSERT INTO ids SELECT 'doc2', id FROM public.sale_documents WHERE sale_id = pg_temp.id('venda') AND tipo = 'contrato'
  AND file_name = 'contrato-v2.pdf';
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_sale_authorize(pg_temp.id('venda'))->>'contrato')::uuid = pg_temp.id('doc2'),
  'nova versão vira o contrato vigente');
RESET ROLE;

-- ===== envio (service_role) =====
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
INSERT INTO public.clicksign_envelopes (organization_id, origem, sale_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key)
  VALUES (:'org', 'venda', pg_temp.id('venda'), pg_temp.id('doc2'), 'sending', true,
    '[{"papel":"vendedor","nome":"Ana Teste","email_sha256":"aa","label":"Vendedor 1","role":"seller"}]',
    pg_temp.id('admin'), gen_random_uuid()::text, gen_random_uuid()::text);
INSERT INTO ids SELECT 'env1', id FROM public.clicksign_envelopes WHERE sale_id = pg_temp.id('venda');
SELECT pg_temp.ok(pg_temp.err(format($q$INSERT INTO public.clicksign_envelopes (organization_id, origem, sale_id,
  source_document_id, status, is_test, created_by) VALUES (%L,'venda',%L,gen_random_uuid(),'sending',true,%L)$q$,
  :'org', pg_temp.id('venda'), pg_temp.id('admin'))) LIKE '%clicksign_envelopes_venda_um_ativo%',
  'um único envelope ativo por venda');
SELECT pg_temp.ok(pg_temp.err(format($q$INSERT INTO public.clicksign_envelopes (organization_id, origem, sale_id,
  capture_id, source_document_id, status, is_test, created_by) VALUES (%L,'venda',%L,gen_random_uuid(),
  gen_random_uuid(),'error',true,%L)$q$, :'org', pg_temp.id('v2'), pg_temp.id('admin'))) LIKE '%alvo_check%',
  'envelope não pode ser de captação e venda ao mesmo tempo');
SELECT public.clicksign_sale_mark_sent(pg_temp.id('env1'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura',
  'envio confirmado: venda vai para aguardando_assinatura pelo servidor');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.sale_status_history WHERE sale_id = pg_temp.id('venda')
  AND para = 'aguardando_assinatura' AND motivo LIKE 'Enviado pela Clicksign%'), 'histórico registra o envio');

-- A liberação pontual não vale para usuário logado nem sem a marca.
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT set_config('clicksign.sale', %L, true);
  UPDATE public.sales SET status = 'contrato_ok_corretor' WHERE id = %L$q$, pg_temp.id('venda'), pg_temp.id('venda')))
  IS NOT NULL OR pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura', 'corretor não usa a liberação do servidor');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura', 'status intacto após tentativa do corretor');

-- Gestor/corretor leem o envelope da venda (RLS por can_view_sale).
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.clicksign_envelopes WHERE sale_id = pg_temp.id('venda')) = 1,
  'corretor acompanha o envelope da própria venda');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_manage_authorize(%L)', pg_temp.id('venda')))
  LIKE 'Apenas gestor%', 'corretor não cancela nem gerencia');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_sale_manage_authorize(pg_temp.id('venda'))->>'envelope')::uuid = pg_temp.id('env1'),
  'admin gerencia o envelope em assinatura');
RESET ROLE;

-- Gestão grava histórico na venda (não na captação).
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT public.clicksign_manage_done(pg_temp.id('env1'), pg_temp.id('admin'), 'clicksign_aviso', 'Aviso reenviado', NULL, true);
RESET ROLE;
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.activity_logs WHERE sale_id = pg_temp.id('venda') AND acao = 'clicksign_aviso'),
  'reenviar aviso registra no histórico da venda');

-- ===== nova versão com envelope aberto → pedido de cancelamento + aviso ao gestor =====
INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, status)
  VALUES (pg_temp.id('venda'), 'contrato', 'outros', :'org' || '/x/outros/contrato/v3.pdf', 'contrato-v3.pdf', 'enviado');
SELECT pg_temp.ok((SELECT cancel_reason = 'nova_versao' AND cancel_requested_at IS NOT NULL
  FROM public.clicksign_envelopes WHERE id = pg_temp.id('env1')), 'nova versão marca o envelope para cancelar');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.notifications WHERE sale_id = pg_temp.id('venda')
  AND user_id = pg_temp.id('admin') AND tipo = 'clicksign'), 'quem enviou é avisado');
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT (public.clicksign_sale_config(pg_temp.id('venda'))->'envelope'->>'contrato_atual')::bool,
  'config mostra que o envelope é de versão antiga');
RESET ROLE;

-- Webhook de documento fechado com contrato trocado: não anexa (stale) e não marca.
INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('sale-documents', :'org' || '/' || pg_temp.id('venda') || '/outros/contrato_assinado/11111111-1111-4111-8111-111111111111.pdf',
          '{"mimetype":"application/pdf"}');
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.clicksign_sale_attach_signed(pg_temp.id('env1'),
  :'org' || '/' || pg_temp.id('venda') || '/outros/contrato_assinado/11111111-1111-4111-8111-111111111111.pdf',
  'contrato-assinado-clicksign.pdf') = 'stale', 'assinado de versão antiga não é anexado');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura', 'versão antiga não marca a venda');

-- Cancelamento (o que a edge faz após cancelar na Clicksign) volta a venda para o gestor reenviar.
UPDATE public.clicksign_envelopes SET status = 'running', last_event = NULL WHERE id = pg_temp.id('env1');
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.clicksign_sale_canceled(pg_temp.id('env1'), 'nova_versao', NULL) = 'canceled',
  'cancelamento por nova versão');
SELECT pg_temp.ok(public.clicksign_sale_canceled(pg_temp.id('env1'), 'cancel', NULL) = 'already',
  'cancelamento repetido (webhook) é idempotente');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.st(pg_temp.id('venda')) = 'contrato_ok_corretor', 'venda volta a contrato_ok_corretor');

-- ===== segundo envio, todos assinam: anexa e marca sozinho, idempotente =====
INSERT INTO ids SELECT 'doc3', public.clicksign_sale_contrato(pg_temp.id('venda'));
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
INSERT INTO public.clicksign_envelopes (organization_id, origem, sale_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key)
  VALUES (:'org', 'venda', pg_temp.id('venda'), pg_temp.id('doc3'), 'sending', true, '[]', pg_temp.id('admin'),
    gen_random_uuid()::text, gen_random_uuid()::text);
INSERT INTO ids SELECT 'env2', id FROM public.clicksign_envelopes WHERE sale_id = pg_temp.id('venda') AND status = 'sending';
SELECT public.clicksign_sale_mark_sent(pg_temp.id('env2'));
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('sale-documents', :'org' || '/' || pg_temp.id('venda') || '/outros/contrato_assinado/22222222-2222-4222-8222-222222222222.pdf',
          '{"mimetype":"application/pdf"}');
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_attach_signed(%L, %L, %L)', pg_temp.id('env2'),
  'outra-org/caminho.pdf', 'x.pdf')) = 'Documento inválido', 'caminho fora da venda é recusado');
SELECT public.clicksign_sale_attach_signed(pg_temp.id('env2'),
  :'org' || '/' || pg_temp.id('venda') || '/outros/contrato_assinado/22222222-2222-4222-8222-222222222222.pdf',
  'contrato-assinado-clicksign.pdf') AS res1 \gset
SELECT pg_temp.ok(public.clicksign_sale_attach_signed(pg_temp.id('env2'),
  :'org' || '/' || pg_temp.id('venda') || '/outros/contrato_assinado/22222222-2222-4222-8222-222222222222.pdf',
  'contrato-assinado-clicksign.pdf') = 'already', 'webhook repetido: already (idempotente)');
RESET ROLE;
SELECT pg_temp.ok(:'res1' IN ('attached', 'attached_only'), 'fechou: anexou (' || :'res1' || ')');
SELECT pg_temp.ok(:'res1' = 'attached_only' AND (SELECT error_code LIKE 'mark_failed:%'
  FROM public.clicksign_envelopes WHERE id = pg_temp.id('env2')),
  'venda sintética sem valores: marcação falha, PDF fica anexado (caminho de reserva)');
SELECT pg_temp.ok((SELECT count(*) FROM public.sale_documents WHERE sale_id = pg_temp.id('venda')
  AND tipo = 'contrato_assinado') = 1, 'um único contrato_assinado anexado');
SELECT pg_temp.ok((SELECT count(*) FROM public.occurrences WHERE sale_id = pg_temp.id('venda')) <= 1,
  'no máximo uma ocorrência (sem duplicar)');
SELECT pg_temp.ok(CASE :'res1' WHEN 'attached' THEN pg_temp.st(pg_temp.id('venda')) = 'ocorrencia_pendente'
    AND (SELECT count(*) FROM public.occurrences WHERE sale_id = pg_temp.id('venda')) = 1
  ELSE pg_temp.st(pg_temp.id('venda')) = 'aguardando_assinatura'
    AND (SELECT error_code LIKE 'mark_failed:%' FROM public.clicksign_envelopes WHERE id = pg_temp.id('env2'))
    AND EXISTS (SELECT 1 FROM public.notifications WHERE sale_id = pg_temp.id('venda')
      AND titulo = 'Clicksign: marque o contrato como assinado') END,
  'marcação automática coerente (attached = ocorrência criada; attached_only = gestor avisado, PDF mantido)');
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_sale_signed(pg_temp.id('venda'))->>'document_id') IS NOT NULL,
  'área Documento assinado: corretor vê quem assinou');
RESET ROLE;

-- ===== venda saindo de aguardando_assinatura com envelope aberto (ex.: gestor devolve) =====
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
UPDATE public.clicksign_envelopes SET status = 'running', signed_document_id = NULL WHERE id = pg_temp.id('env2')
  AND :'res1' = 'attached_only';
RESET ROLE;
SET session_replication_role = replica;
UPDATE public.sales SET status = 'aguardando_assinatura' WHERE id = pg_temp.id('v2');
SET session_replication_role = origin;
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, status)
  VALUES (pg_temp.id('v2'), 'contrato', 'outros', :'org' || '/y/outros/contrato/a.pdf', 'a.pdf', 'enviado');
INSERT INTO public.clicksign_envelopes (organization_id, origem, sale_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key)
  VALUES (:'org', 'venda', pg_temp.id('v2'), public.clicksign_sale_contrato(pg_temp.id('v2')), 'running', true, '[]',
    pg_temp.id('admin'), gen_random_uuid()::text, gen_random_uuid()::text);
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
UPDATE public.sales SET status = 'em_elaboracao_contrato' WHERE id = pg_temp.id('v2');
RESET ROLE;
SELECT pg_temp.ok((SELECT cancel_reason = 'status_mudou' FROM public.clicksign_envelopes WHERE sale_id = pg_temp.id('v2')),
  'venda saiu de aguardando_assinatura: envelope marcado para cancelar');

-- ===== caminho feliz: venda de homologação com distribuição válida (0f0a68a2…) =====
INSERT INTO ids VALUES ('feliz', '0f0a68a2-ec3d-42a0-8725-87636d8baeb4');
SET session_replication_role = replica;
UPDATE public.sales SET status = 'aguardando_assinatura' WHERE id = pg_temp.id('feliz');
DELETE FROM public.sale_documents WHERE sale_id = pg_temp.id('feliz') AND tipo IN ('contrato', 'contrato_assinado');
DELETE FROM public.occurrences WHERE sale_id = pg_temp.id('feliz');
SET session_replication_role = origin;
INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, status)
  VALUES (pg_temp.id('feliz'), 'contrato', 'outros', :'org' || '/z/outros/contrato/f.pdf', 'f.pdf', 'enviado');
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
INSERT INTO public.clicksign_envelopes (organization_id, origem, sale_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key)
  VALUES (:'org', 'venda', pg_temp.id('feliz'), public.clicksign_sale_contrato(pg_temp.id('feliz')), 'running', true,
    '[]', pg_temp.id('admin'), gen_random_uuid()::text, gen_random_uuid()::text);
RESET ROLE;
INSERT INTO ids SELECT 'env3', id FROM public.clicksign_envelopes WHERE sale_id = pg_temp.id('feliz');
INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('sale-documents', :'org' || '/' || pg_temp.id('feliz') || '/outros/contrato_assinado/33333333-3333-4333-8333-333333333333.pdf',
          '{"mimetype":"application/pdf"}');
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT public.clicksign_sale_attach_signed(pg_temp.id('env3'),
  :'org' || '/' || pg_temp.id('feliz') || '/outros/contrato_assinado/33333333-3333-4333-8333-333333333333.pdf',
  'contrato-assinado-clicksign.pdf') AS res3 \gset
SELECT public.clicksign_sale_attach_signed(pg_temp.id('env3'),
  :'org' || '/' || pg_temp.id('feliz') || '/outros/contrato_assinado/33333333-3333-4333-8333-333333333333.pdf',
  'contrato-assinado-clicksign.pdf') AS res4 \gset
RESET ROLE;
SELECT pg_temp.ok(:'res3' = 'attached', 'todos assinaram: anexou e marcou sozinho (' || :'res3' || ')');
SELECT pg_temp.ok(pg_temp.st(pg_temp.id('feliz')) = 'ocorrencia_pendente', 'venda foi a ocorrencia_pendente');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.sale_status_history WHERE sale_id = pg_temp.id('feliz')
  AND para = 'contrato_assinado' AND motivo LIKE 'Automático: todos assinaram na Clicksign%'),
  'histórico: contrato_assinado automático');
SELECT pg_temp.ok(:'res4' = 'already' AND (SELECT count(*) FROM public.occurrences WHERE sale_id = pg_temp.id('feliz')) = 1,
  'webhook repetido: 1 ocorrência só (idempotente)');
SELECT pg_temp.as_user(pg_temp.id('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((public.clicksign_sale_signed(pg_temp.id('feliz'))->>'auto_marked')::bool,
  'Documento assinado informa marcação automática');
RESET ROLE;

-- e-mail do parceiro (aditivo)
SELECT pg_temp.ok(to_regclass('public.occurrence_partners') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_name = 'occurrence_partners' AND column_name = 'email'), 'occurrence_partners.email criado');
SELECT pg_temp.ok(public.clicksign_mask_email('Fulano.Teste@exemplo.com') = 'fu***@exemplo.com', 'e-mail mascarado');

-- RPCs da ocorrência copiam parceria_email (venda 'feliz', já em ocorrencia_pendente com ocorrência).
-- O sincronizar ignora lançamento de propósito: aqui a venda vira 'padrao' só dentro da transação.
SET session_replication_role = replica;
UPDATE public.sales SET modalidade = 'padrao', status = 'ocorrencia_pendente' WHERE id = pg_temp.id('feliz');
UPDATE public.sales SET parceria_tipo = 'imobiliaria_externa', parceria_nome = 'Parceira Teste',
  parceria_email = ' parceira@example.com ' WHERE id = pg_temp.id('feliz');
DELETE FROM public.occurrence_partners WHERE occurrence_id IN
  (SELECT id FROM public.occurrences WHERE sale_id = pg_temp.id('feliz'));
UPDATE public.occurrences SET status = 'pendente' WHERE sale_id = pg_temp.id('feliz');
SET session_replication_role = origin;
SELECT public.sincronizar_ocorrencia_antes_financeiro(pg_temp.id('feliz'));
SELECT pg_temp.ok((SELECT email FROM public.occurrence_partners op JOIN public.occurrences o ON o.id = op.occurrence_id
  WHERE o.sale_id = pg_temp.id('feliz') AND op.from_sale) = 'parceira@example.com',
  'sincronizar_ocorrencia_antes_financeiro insere o parceiro com o e-mail da venda');
SET session_replication_role = replica;
UPDATE public.sales SET parceria_email = 'nova@example.com' WHERE id = pg_temp.id('feliz');
SET session_replication_role = origin;
SELECT public.sincronizar_ocorrencia_antes_financeiro(pg_temp.id('feliz'));
SELECT pg_temp.ok((SELECT email FROM public.occurrence_partners op JOIN public.occurrences o ON o.id = op.occurrence_id
  WHERE o.sale_id = pg_temp.id('feliz') AND op.from_sale) = 'nova@example.com',
  'sincronizar atualiza o e-mail do parceiro');
SET session_replication_role = replica;
UPDATE public.sales SET parceria_email = NULL WHERE id = pg_temp.id('feliz');
SET session_replication_role = origin;
SELECT public.sincronizar_ocorrencia_antes_financeiro(pg_temp.id('feliz'));
SELECT pg_temp.ok((SELECT email FROM public.occurrence_partners op JOIN public.occurrences o ON o.id = op.occurrence_id
  WHERE o.sale_id = pg_temp.id('feliz') AND op.from_sale) = 'nova@example.com',
  'venda sem e-mail (legado) não apaga o e-mail já gravado na ocorrência');
SET session_replication_role = replica;
-- criar não olha a modalidade; volta a original (distribuição válida desta venda de homologação).
UPDATE public.sales SET parceria_email = 'cria@example.com', modalidade = 'lancamento' WHERE id = pg_temp.id('feliz');
DELETE FROM public.occurrence_partners WHERE occurrence_id IN
  (SELECT id FROM public.occurrences WHERE sale_id = pg_temp.id('feliz'));
DELETE FROM public.occurrences WHERE sale_id = pg_temp.id('feliz');
SET session_replication_role = origin;
SELECT coalesce(pg_temp.err(format('SELECT public.criar_ocorrencia_completa(%L)', pg_temp.id('feliz'))), '') AS err_criar \gset
SELECT pg_temp.ok(:'err_criar' = '' AND (SELECT email FROM public.occurrence_partners op JOIN public.occurrences o
  ON o.id = op.occurrence_id WHERE o.sale_id = pg_temp.id('feliz') AND op.from_sale) = 'cria@example.com',
  'criar_ocorrencia_completa grava o e-mail do parceiro' || coalesce(' (erro: ' || nullif(:'err_criar', '') || ')', ''));

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
