-- Suíte da migration 20261019100000 (cartão t_f8dc8b99): assinado visível ao captador quando o
-- envelope fecha + avisos de status (sino e fila de WhatsApp). Roda DENTRO de transação revertida
-- (run-clicksign-avisos.sh), em homologação ou clone — nunca produção. Dados fictícios; nenhuma
-- chamada à Clicksign nem envio de WhatsApp (a fila só é lida).
-- Perfis da homologação (Única = org A): UE Corretor (10…03, membro da Equipe UE), UE Gestor (10…02,
-- líder da Equipe UE), QA A Admin (envia pela Clicksign) e um corretor de FORA da equipe (5745cbff…).
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
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
-- Sino do envelope: quantas notificações clicksign_status para um usuário, filtrando pelo título.
CREATE FUNCTION pg_temp.sino(_u uuid, _like text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.notifications WHERE user_id = _u AND tipo = 'clicksign_status' AND titulo LIKE _like $$;
CREATE FUNCTION pg_temp.fila(_env uuid, _ev text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.clicksign_whatsapp_fila WHERE envelope_id = _env AND evento = _ev $$;
CREATE FUNCTION pg_temp.sha(_t text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to(_t, 'UTF8')), 'hex') $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org \gset
INSERT INTO ids VALUES ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('corretor', '10000000-0000-4000-8000-000000000003'), ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('fora', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('d_ger', gen_random_uuid()), ('d_ass', gen_random_uuid()), ('v1', gen_random_uuid());

INSERT INTO public.clicksign_org_settings (organization_id, enabled, sale_enabled, test_mode, access_token_secret_id, deadline_days)
  VALUES (:'org', true, true, true, gen_random_uuid(), 10)
  ON CONFLICT (organization_id) DO UPDATE SET enabled = true, sale_enabled = true, deadline_days = 10,
    access_token_secret_id = gen_random_uuid();
INSERT INTO storage.buckets (id, name, public) VALUES ('exclusive-captures', 'exclusive-captures', false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.organization_modules (organization_id, module, enabled)
  VALUES (:'org', 'captacao_exclusiva', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
ALTER TABLE public.clicksign_envelopes ALTER COLUMN created_at SET DEFAULT clock_timestamp();
-- Só para conseguir ler storage.objects como authenticated nesta transação: a policy avatars_select
-- (de outro bucket) consulta profiles, que o papel não lê direto. Não muda a regra do bucket testado.
GRANT SELECT ON public.profiles TO authenticated;

-- Captações: uma do UE Corretor e uma do corretor de fora.
INSERT INTO ids SELECT 'unit', id FROM public.exclusive_units WHERE organization_id = :'org' AND ativo ORDER BY nome LIMIT 1;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('corretor'));
INSERT INTO ids SELECT 'c1', public.exclusive_create_unit(pg_temp.id('unit'));
SELECT pg_temp.as_user(pg_temp.id('fora'));
INSERT INTO ids SELECT 'c_fora', public.exclusive_create_unit(pg_temp.id('unit'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.id('c1') IS NOT NULL, 'pré: captação sintética criada');
SET session_replication_role = replica;
UPDATE public.exclusive_captures SET status = 'em_assinatura' WHERE id IN (pg_temp.id('c1'), pg_temp.id('c_fora'));
SET session_replication_role = origin;
INSERT INTO public.exclusive_documents (id, capture_id, kind, storage_path, file_name, uploaded_by, organization_id) VALUES
  (pg_temp.id('d_ger'), pg_temp.id('c1'), 'gerado', :'org' || '/' || pg_temp.id('c1') || '/gerado.pdf', 'g.pdf', pg_temp.id('corretor'), :'org'),
  (pg_temp.id('d_ass'), pg_temp.id('c1'), 'assinado', :'org' || '/' || pg_temp.id('c1') || '/assinado.pdf', 'a.pdf', pg_temp.id('admin'), :'org');
INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
  ('exclusive-captures', :'org' || '/' || pg_temp.id('c1') || '/gerado.pdf', '{"mimetype":"application/pdf"}'),
  ('exclusive-captures', :'org' || '/' || pg_temp.id('c1') || '/assinado.pdf', '{"mimetype":"application/pdf"}');

-- Envelope da captação: nasce em "sending" e passa a "running" (o gatilho grava o prazo e avisa).
INSERT INTO public.clicksign_envelopes (organization_id, origem, capture_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key)
  VALUES (:'org', 'captacao', pg_temp.id('c1'), pg_temp.id('d_ger'), 'sending', true,
    jsonb_build_array(
      jsonb_build_object('papel', 'proprietario_1', 'nome', 'Fulano', 'email_sha256', pg_temp.sha('p1@example.com')),
      jsonb_build_object('papel', 'testemunha', 'nome', 'T1', 'email_sha256', pg_temp.sha('t1@example.com')),
      jsonb_build_object('papel', 'testemunha', 'nome', 'T2', 'email_sha256', pg_temp.sha('t2@example.com'))),
    pg_temp.id('admin'), gen_random_uuid()::text, gen_random_uuid()::text);
INSERT INTO ids SELECT 'env1', id FROM public.clicksign_envelopes WHERE capture_id = pg_temp.id('c1');

-- ===================== A) antes de fechar: assinado oculto ao corretor =====================
UPDATE public.clicksign_envelopes SET status = 'running', last_event = 'activated' WHERE id = pg_temp.id('env1');
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE id = pg_temp.id('d_ass')),
  'A: envelope em assinatura → corretor NÃO vê o assinado');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE id = pg_temp.id('d_ger')),
  'A: gerado continua oculto ao corretor');
RESET ROLE;

-- ===================== B) enviado =====================
SELECT pg_temp.ok((SELECT deadline_at::date = (created_at + interval '10 days')::date FROM public.clicksign_envelopes
  WHERE id = pg_temp.id('env1')), 'B: prazo gravado ao entrar em assinatura (criação + prazo da org)');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('corretor'), '%contrato enviado para assinatura') = 1
  AND pg_temp.sino(pg_temp.id('gestor'), '%contrato enviado para assinatura') = 1,
  'B enviado: sino para o corretor e o gestor (líder da equipe)');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('admin'), '%contrato enviado%') = 0,
  'B enviado: quem enviou não recebe aviso do próprio envio');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('fora'), '%') = 0, 'B: corretor de fora não recebe nada');
SELECT pg_temp.ok(pg_temp.fila(pg_temp.id('env1'), 'enviado') = 2
  AND EXISTS (SELECT 1 FROM public.clicksign_whatsapp_fila WHERE envelope_id = pg_temp.id('env1') AND user_id = pg_temp.id('corretor'))
  AND EXISTS (SELECT 1 FROM public.clicksign_whatsapp_fila WHERE envelope_id = pg_temp.id('env1') AND user_id = pg_temp.id('gestor')),
  'B enviado: WhatsApp na fila para corretor e gestor');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.notifications WHERE tipo = 'clicksign_status'
  AND (mensagem ~ '@' OR titulo ~ '@' OR mensagem ~ '[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}')),
  'B: sino sem e-mail nem CPF');
-- Reentrega do mesmo status (webhook repetido) não reavisa.
UPDATE public.clicksign_envelopes SET status = 'running', updated_at = now() WHERE id = pg_temp.id('env1');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('corretor'), '%contrato enviado%') = 1, 'B: status repetido não duplica');

-- ===================== B) cada assinatura (só sino) =====================
SELECT pg_temp.ok(public.clicksign_aviso_assinou(pg_temp.id('env1'), pg_temp.sha('p1@example.com'), 101) = 3,
  'B assinou: aviso para os 3 (corretor, gestor, quem enviou)');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('corretor'), '%: Proprietário 1 assinou') = 1,
  'B assinou: papel pelo sha ("Proprietário 1 assinou"), sem nome nem e-mail');
SELECT pg_temp.ok(public.clicksign_aviso_assinou(pg_temp.id('env1'), pg_temp.sha('p1@example.com'), 102) = 0,
  'B assinou: reentrega do mesmo signatário não duplica');
SELECT pg_temp.ok(public.clicksign_aviso_assinou(pg_temp.id('env1'), pg_temp.sha('t2@example.com'), 103) = 3
  AND pg_temp.sino(pg_temp.id('gestor'), '%: Testemunha 2 assinou') = 1,
  'B assinou: segunda testemunha vira "Testemunha 2"');
SELECT pg_temp.ok((SELECT mensagem FROM public.notifications WHERE user_id = pg_temp.id('gestor')
  AND titulo LIKE '%Testemunha 2 assinou') LIKE '%(2 de 3)%', 'B assinou: contagem "2 de 3"');
SELECT pg_temp.ok(public.clicksign_aviso_assinou(pg_temp.id('env1'), NULL, 104) = 3
  AND public.clicksign_aviso_assinou(pg_temp.id('env1'), NULL, 104) = 0,
  'B assinou: sem e-mail no payload, idempotente pelo id do evento');
SELECT pg_temp.ok(pg_temp.fila(pg_temp.id('env1'), 'assinou') = 0, 'B assinou: NÃO vai para o WhatsApp');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_aviso_assinou(%L, %L, 1)', pg_temp.id('env1'), 'x@example.com'))
  = 'Assinatura inválida', 'B assinou: recusa e-mail em claro no lugar do sha');
SELECT pg_temp.ok(public.clicksign_aviso_assinou(gen_random_uuid(), NULL, 1) = 0,
  'B assinou: envelope de outro sistema (desconhecido) é ignorado');

-- ===================== B) lembrete de prazo =====================
UPDATE public.clicksign_envelopes SET deadline_at = now() + interval '2 days' WHERE id = pg_temp.id('env1');
SELECT pg_temp.ok(public.clicksign_lembrete_prazo(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
  AT TIME ZONE 'America/Sao_Paulo' + interval '22 hours') = 0, 'B prazo: 22h de Brasília não avisa');
SELECT pg_temp.ok(public.clicksign_lembrete_prazo(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
  AT TIME ZONE 'America/Sao_Paulo' + interval '6 hours') = 0, 'B prazo: 6h de Brasília não avisa');
SELECT pg_temp.ok(public.clicksign_lembrete_prazo(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
  AT TIME ZONE 'America/Sao_Paulo' + interval '9 hours 5 minutes') = 1, 'B prazo: 9h05, faltando 2 dias → avisa');
SELECT pg_temp.ok(public.clicksign_lembrete_prazo(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
  AT TIME ZONE 'America/Sao_Paulo' + interval '10 hours') = 0, 'B prazo: 1 vez por envelope');
SELECT pg_temp.ok(pg_temp.fila(pg_temp.id('env1'), 'prazo_perto') = 3
  AND pg_temp.sino(pg_temp.id('corretor'), '%prazo da assinatura perto de vencer') = 1,
  'B prazo: sino + WhatsApp na fila');

-- ===================== A + B) fechou: corretor vê o assinado, finalizado =====================
UPDATE public.clicksign_envelopes SET status = 'closed', signed_document_id = pg_temp.id('d_ass'), last_event = 'document_closed'
  WHERE id = pg_temp.id('env1');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('corretor'), '%: todos assinaram') = 1
  AND pg_temp.sino(pg_temp.id('gestor'), '%: todos assinaram') = 1
  AND pg_temp.sino(pg_temp.id('admin'), '%: todos assinaram') = 1, 'B finalizado: sino para corretor, gestor e quem enviou');
SELECT pg_temp.ok((SELECT mensagem FROM public.notifications WHERE user_id = pg_temp.id('corretor') AND titulo LIKE '%todos assinaram')
  = 'O contrato assinado está disponível para baixar. O gestor precisa aprovar a captação.', 'B finalizado: texto do sino');
SELECT pg_temp.ok(pg_temp.fila(pg_temp.id('env1'), 'finalizado') = 3, 'B finalizado: WhatsApp na fila');
SELECT pg_temp.ok((SELECT status FROM public.exclusive_captures WHERE id = pg_temp.id('c1')) = 'em_assinatura',
  'A: captação NÃO é aprovada pelo fechamento (gestor continua aprovando)');
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.exclusive_documents WHERE id = pg_temp.id('d_ass')),
  'A: envelope fechado → corretor (captador) vê o assinado');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE id = pg_temp.id('d_ger')),
  'A: gerado continua oculto ao corretor');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'exclusive-captures'
  AND name = :'org' || '/' || pg_temp.id('c1') || '/assinado.pdf'), 'A: corretor baixa o assinado do Storage');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'exclusive-captures'
  AND name = :'org' || '/' || pg_temp.id('c1') || '/gerado.pdf'), 'A: gerado continua fora do Storage do corretor');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('fora'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id = pg_temp.id('c1'))
  AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'exclusive-captures'
    AND name LIKE :'org' || '/' || pg_temp.id('c1') || '/%'), 'A: outro corretor não vê nada da captação');
RESET ROLE;
-- Assinado que NÃO veio do envelope (signed_document_id aponta outro arquivo) segue oculto.
UPDATE public.clicksign_envelopes SET signed_document_id = gen_random_uuid() WHERE id = pg_temp.id('env1');
SELECT pg_temp.as_user(pg_temp.id('corretor'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE id = pg_temp.id('d_ass')),
  'A: assinado que não é o do envelope fechado segue oculto');
RESET ROLE;
UPDATE public.clicksign_envelopes SET signed_document_id = pg_temp.id('d_ass') WHERE id = pg_temp.id('env1');
-- Reentrega do document_closed não reavisa.
UPDATE public.clicksign_envelopes SET status = 'closed', updated_at = now() WHERE id = pg_temp.id('env1');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('corretor'), '%: todos assinaram') = 1, 'B finalizado: reentrega não duplica');

-- ===================== B) recusado / prazo vencido / cancelado =====================
-- (source_document_id sem FK: envelopes antigos de gerados já substituídos.)
INSERT INTO public.clicksign_envelopes (organization_id, origem, capture_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key, last_event)
  SELECT :'org', 'captacao', pg_temp.id('c1'), gen_random_uuid(), 'running', true, '[]', pg_temp.id('admin'),
    gen_random_uuid()::text, gen_random_uuid()::text, 'activated'
  FROM generate_series(1, 3);
INSERT INTO ids SELECT 'env_' || (row_number() OVER (ORDER BY created_at))::text, id FROM public.clicksign_envelopes
  WHERE capture_id = pg_temp.id('c1') AND id <> pg_temp.id('env1');
UPDATE public.clicksign_envelopes SET status = 'canceled', last_event = 'refusal' WHERE id = pg_temp.id('env_1');
UPDATE public.clicksign_envelopes SET status = 'canceled', last_event = 'deadline' WHERE id = pg_temp.id('env_2');
UPDATE public.clicksign_envelopes SET status = 'canceled', last_event = 'cancel' WHERE id = pg_temp.id('env_3');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('corretor'), '%: assinatura recusada') = 1 AND pg_temp.fila(pg_temp.id('env_1'), 'recusado') = 3,
  'B recusado: sino + WhatsApp');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('corretor'), '%: prazo da assinatura venceu') = 1
  AND NOT EXISTS (SELECT 1 FROM public.clicksign_whatsapp_fila WHERE envelope_id = pg_temp.id('env_2')),
  'B prazo vencido: só sino, sem WhatsApp');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('corretor'), '%: assinatura cancelada') = 1
  AND NOT EXISTS (SELECT 1 FROM public.clicksign_whatsapp_fila WHERE envelope_id = pg_temp.id('env_3')),
  'B cancelado: só sino, sem WhatsApp');
SELECT pg_temp.ok(public.clicksign_lembrete_prazo(now()) = 0, 'B prazo: envelope fechado/cancelado não gera lembrete');

-- ===================== B) fila do WhatsApp =====================
SET LOCAL ROLE service_role;
SELECT pg_temp.ok((SELECT count(*) FROM public.clicksign_whatsapp_pendentes(200) p
  WHERE p.ref_id = pg_temp.id('c1')) = 11, 'fila: 11 pendentes (2 enviado + 3 prazo + 3 finalizado + 3 recusado)');
SELECT pg_temp.ok((SELECT bool_and(p.env_status = 'closed') FROM public.clicksign_whatsapp_pendentes(200) p
  WHERE p.ref_id = pg_temp.id('c1') AND p.evento = 'prazo_perto'), 'fila: prazo_perto de envelope já fechado chega com env_status closed (rotina ignora)');
SELECT pg_temp.ok((SELECT bool_and(p.rotulo LIKE 'Captação #%' AND p.origem = 'captacao') FROM public.clicksign_whatsapp_pendentes(200) p
  WHERE p.ref_id = pg_temp.id('c1')), 'fila: rótulo é só o código da captação');
SELECT public.clicksign_whatsapp_marcar(min(id), 'erro', 'falha para x@example.com') FROM public.clicksign_whatsapp_fila
  WHERE envelope_id = pg_temp.id('env1') AND evento = 'enviado';
RESET ROLE;
SELECT pg_temp.ok((SELECT attempts = 1 AND sent_at IS NULL AND last_error !~ '@' FROM public.clicksign_whatsapp_fila
  WHERE envelope_id = pg_temp.id('env1') AND evento = 'enviado' ORDER BY id LIMIT 1), 'fila: erro conta tentativa e apaga e-mail do log');
SET LOCAL ROLE service_role;
SELECT public.clicksign_whatsapp_marcar(min(id), 'ok') FROM public.clicksign_whatsapp_fila
  WHERE envelope_id = pg_temp.id('env1') AND evento = 'enviado';
RESET ROLE;
SELECT pg_temp.ok((SELECT sent_at IS NOT NULL AND last_error IS NULL FROM public.clicksign_whatsapp_fila
  WHERE envelope_id = pg_temp.id('env1') AND evento = 'enviado' ORDER BY id LIMIT 1), 'fila: ok encerra o item');

-- ===================== B) venda: mesmo mecanismo =====================
ALTER TABLE public.sales DISABLE TRIGGER USER;
INSERT INTO public.sales (id, corretor_id, imovel_id, status, organization_id)
  VALUES (pg_temp.id('v1'), pg_temp.id('corretor'), 'CSA-AVISO', 'aguardando_assinatura', :'org');
ALTER TABLE public.sales ENABLE TRIGGER USER;
INSERT INTO public.clicksign_envelopes (organization_id, origem, sale_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key)
  VALUES (:'org', 'venda', pg_temp.id('v1'), gen_random_uuid(), 'sending', true, '[]', pg_temp.id('admin'),
    gen_random_uuid()::text, gen_random_uuid()::text);
INSERT INTO ids SELECT 'env_v', id FROM public.clicksign_envelopes WHERE sale_id = pg_temp.id('v1');
UPDATE public.clicksign_envelopes SET status = 'running' WHERE id = pg_temp.id('env_v');
SELECT pg_temp.ok(pg_temp.sino(pg_temp.id('corretor'), 'Venda CSA-AVISO: contrato enviado para assinatura') = 1
  AND pg_temp.sino(pg_temp.id('gestor'), 'Venda CSA-AVISO: contrato enviado%') = 1
  AND pg_temp.fila(pg_temp.id('env_v'), 'enviado') = 2, 'venda enviado: sino + WhatsApp para corretor e gestor');
SELECT pg_temp.ok((SELECT sale_id = pg_temp.id('v1') AND exclusive_capture_id IS NULL FROM public.notifications
  WHERE user_id = pg_temp.id('corretor') AND titulo LIKE 'Venda CSA-AVISO: contrato enviado%'), 'venda: sino ligado à venda');

-- Grants: nada aberto ao usuário logado nem a anon.
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.clicksign_aviso_assinou(uuid,text,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.clicksign_whatsapp_pendentes(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.clicksign_lembrete_prazo(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.clicksign_assinado_liberado(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.clicksign_whatsapp_fila', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.clicksign_avisos', 'SELECT'),
  'grants: funções e tabelas dos avisos só para service_role');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
