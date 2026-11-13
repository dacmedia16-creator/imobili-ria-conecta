-- Suíte: aprovação automática de TODA captação (corretor, gestor, TL) ao chegar o assinado da Clicksign
-- (migration 20261123120000, t_e433a198 ampliada em t_2cbd375c).
-- Roda DENTRO de transação revertida (run-captacao-autoaprovacao-clicksign.sh), em homologação ou banco
-- descartável; nunca em produção. Dados 100% fictícios, criados aqui. Chama clicksign_attach_signed como
-- service_role, igual ao webhook clicksign-webhook no document_closed.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true) $$;
-- Caminho do PDF assinado (formato do webhook) + objeto no Storage com mimetype PDF.
CREATE FUNCTION pg_temp.pdf(_org uuid, _cap uuid, _n int) RETURNS text LANGUAGE sql AS
  $$ SELECT _org || '/' || _cap || '/' || lpad(_n::text, 8, '0') || '-0000-4000-8000-000000000000.pdf' $$;

\set org 'a0000000-0000-4000-8000-0000000000a0'
\set admin 'a0000000-0000-4000-8000-000000000001'
\set gestor 'a0000000-0000-4000-8000-000000000002'
\set tl 'a0000000-0000-4000-8000-000000000003'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set team 'a0000000-0000-4000-8000-0000000000f1'
\set unit 'a0000000-0000-4000-8000-0000000000e1'
\set acao 'a0000000-0000-4000-8000-0000000000d1'
-- Captações: G = do gestor com Plano; S = do gestor SEM Plano; C = do corretor com Plano; T = do team leader;
-- X = do gestor com envelope de TESTE; M = cadastro manual do gestor; P = do corretor SEM Plano;
-- Y = do corretor com envelope de TESTE; N = cadastro manual do corretor.
\set cg 'c0000000-0000-4000-8000-000000000001'
\set cs 'c0000000-0000-4000-8000-000000000002'
\set cc 'c0000000-0000-4000-8000-000000000003'
\set ct 'c0000000-0000-4000-8000-000000000004'
\set cx 'c0000000-0000-4000-8000-000000000005'
\set cm 'c0000000-0000-4000-8000-000000000006'
\set cp 'c0000000-0000-4000-8000-000000000007'
\set cy 'c0000000-0000-4000-8000-000000000008'
\set cn 'c0000000-0000-4000-8000-000000000009'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org', 'teste-autoaprov-a', 'Imobiliária Exemplo A', 'ativa', '00000000000191', '#112233', '#445566');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org', 'captacao_exclusiva', true), (:'org', 'feedback_proprietario', true), (:'org', 'vouchers_fotos', true);
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'tl', :'c1']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org'),
  (:'gestor', 'Gestor Exemplo', 'gestor@exemplo.test', true, :'org'),
  (:'tl', 'Líder Exemplo', 'tl@exemplo.test', true, :'org'),
  (:'c1', 'Carlos Corretor', 'c1@exemplo.test', true, :'org');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org', :'admin', true), (:'org', :'gestor', true), (:'org', :'tl', true), (:'org', :'c1', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org'), (:'gestor', 'gestor', :'org'), (:'tl', 'team_leader', :'org'),
  (:'c1', 'corretor', :'org');
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES (:'team', :'gestor', 'Equipe Exemplo', :'org');
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES (:'c1', :'team', :'org');
INSERT INTO public.clicksign_org_settings (organization_id, enabled, sale_enabled, test_mode, access_token_secret_id)
  VALUES (:'org', true, false, false, gen_random_uuid());
INSERT INTO public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)
  VALUES (:'unit', :'org', 'Unidade Exemplo', 'J-0001', 'Exemplo Ltda', 'Rua Exemplo, 1', 'Sorocaba', 'SP', '00000000000191', 'Exemplo');
INSERT INTO public.owner_feedback_actions (id, organization_id, list, category, label, weight, sort, active)
  VALUES (:'acao', :'org', 'marketing', 'Divulgação', 'Fotos profissionais', 'vital', 1, true);
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, manual)
  SELECT v.id, v.captor, v.captor, 'remax-padrao', :'unit', 'em_assinatura',
    jsonb_build_object('imovel', jsonb_build_object('bairro', 'Centro'),
      'dossie', CASE WHEN v.plano THEN jsonb_build_array(:'acao') ELSE '[]'::jsonb END),
    'Pessoa Exemplo', '11144477735', 'CRECI 1', :'org', v.manual
  FROM (VALUES (:'cg'::uuid, :'gestor'::uuid, true, false), (:'cs'::uuid, :'gestor'::uuid, false, false),
               (:'cc'::uuid, :'c1'::uuid, true, false), (:'ct'::uuid, :'tl'::uuid, true, false),
               (:'cx'::uuid, :'gestor'::uuid, true, false), (:'cm'::uuid, :'gestor'::uuid, true, true),
               (:'cp'::uuid, :'c1'::uuid, false, false), (:'cy'::uuid, :'c1'::uuid, true, false),
               (:'cn'::uuid, :'c1'::uuid, true, true))
       v(id, captor, plano, manual);
-- PDF gerado pelo sistema (1 hora antes) + envelope em assinatura apontando para ele + PDF assinado no Storage.
INSERT INTO public.exclusive_documents (id, capture_id, kind, owner_index, storage_path, file_name, uploaded_by,
    created_at, organization_id)
  SELECT gen_random_uuid(), c, 'gerado', 0, :'org' || '/' || c || '/gerado.pdf', 'gerado.pdf', :'gestor',
    now() - interval '1 hour', :'org'
  FROM unnest(ARRAY[:'cg', :'cs', :'cc', :'ct', :'cx', :'cm', :'cp', :'cy', :'cn']::uuid[]) c;
INSERT INTO public.clicksign_envelopes (id, organization_id, origem, capture_id, source_document_id,
    envelope_key, document_key, status, is_test, created_by, signers)
  SELECT gen_random_uuid(), :'org', 'captacao', d.capture_id, d.id, gen_random_uuid()::text,
    gen_random_uuid()::text, 'running', d.capture_id IN (:'cx'::uuid, :'cy'::uuid), :'gestor', '[]'::jsonb
  FROM public.exclusive_documents d WHERE d.organization_id = :'org' AND d.kind = 'gerado';
INSERT INTO storage.objects (bucket_id, name, metadata)
  SELECT 'exclusive-captures', pg_temp.pdf(:'org', c, 1), '{"mimetype":"application/pdf"}'::jsonb
  FROM unnest(ARRAY[:'cg', :'cs', :'cc', :'ct', :'cx', :'cm', :'cp', :'cy', :'cn']::uuid[]) c;
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.env(_cap uuid) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM public.clicksign_envelopes WHERE capture_id = _cap $$;
-- O webhook: document_closed → clicksign_attach_signed(envelope, caminho, nome) como service_role.
CREATE FUNCTION pg_temp.webhook(_cap uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _r text;
BEGIN
  PERFORM pg_temp.as_service();
  SET LOCAL ROLE service_role;
  _r := public.clicksign_attach_signed(pg_temp.env(_cap),
    pg_temp.pdf('a0000000-0000-4000-8000-0000000000a0'::uuid, _cap, 1), 'contrato-assinado-clicksign.pdf');
  RESET ROLE;
  RETURN _r;
END $$;
CREATE FUNCTION pg_temp.st(_cap uuid) RETURNS text LANGUAGE sql AS
  $$ SELECT status FROM public.exclusive_captures WHERE id = _cap $$;
CREATE FUNCTION pg_temp.auto(_cap uuid) RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM public.exclusive_history WHERE capture_id = _cap AND action = 'aprovar' $$;
CREATE FUNCTION pg_temp.hoje() RETURNS date LANGUAGE sql AS
  $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

-- 1) Captação do gestor + contrato assinado + Plano → aprovada automaticamente -------------------------
SELECT pg_temp.ok(pg_temp.webhook(:'cg') = 'attached', 'gestor+plano: webhook anexa (retorno attached, Edge igual)');
SELECT pg_temp.ok(status = 'aprovada' AND signed_on = pg_temp.hoje(),
  'gestor+plano: captação aprovada com signed_on = hoje (igual à aprovação manual)')
  FROM public.exclusive_captures WHERE id = :'cg';
SELECT pg_temp.ok(count(*) = 1 AND bool_and(actor_id = :'gestor') AND bool_and(detail LIKE 'Aprovada automaticamente:%'),
  'gestor+plano: histórico ''aprovar'' com "Aprovada automaticamente", autor = o captador (gestor)')
  FROM public.exclusive_history WHERE capture_id = :'cg' AND action = 'aprovar';
SELECT pg_temp.ok(count(*) = 1, 'gestor+plano: histórico do anexo automático continua (documento_anexado)')
  FROM public.exclusive_history WHERE capture_id = :'cg' AND action = 'documento_anexado';
SELECT pg_temp.ok(e.status = 'closed' AND e.signed_document_id IS NOT NULL AND e.last_event = 'document_closed',
  'gestor+plano: envelope fechado com o assinado') FROM public.clicksign_envelopes e WHERE e.capture_id = :'cg';
SELECT pg_temp.ok(count(*) >= 1 AND bool_and(mensagem LIKE '%aprovada automaticamente%')
  AND bool_and(mensagem NOT LIKE '%gestor precisa aprovar%'),
  'gestor+plano: sino diz que foi aprovada automaticamente')
  FROM public.notifications WHERE exclusive_capture_id = :'cg' AND tipo = 'clicksign_status';
SELECT pg_temp.ok(count(*) >= 1 AND bool_and(f.evento = 'aprovada_auto'),
  'gestor+plano: WhatsApp na fila com o evento aprovada_auto')
  FROM public.clicksign_whatsapp_fila f JOIN public.clicksign_envelopes e ON e.id = f.envelope_id
  WHERE e.capture_id = :'cg';

-- 2) Webhook repetido: nenhum efeito -------------------------------------------------------------------
SELECT count(*) AS n_notif FROM public.notifications WHERE exclusive_capture_id = :'cg' \gset
SELECT pg_temp.ok(pg_temp.webhook(:'cg') = 'already', 'duplicado: segundo webhook devolve already');
SELECT pg_temp.ok(pg_temp.webhook(:'cg') = 'already', 'duplicado: terceiro webhook devolve already');
SELECT pg_temp.ok(pg_temp.auto(:'cg') = 1 AND pg_temp.st(:'cg') = 'aprovada',
  'duplicado: continua 1 aprovação só, status aprovada');
SELECT pg_temp.ok(count(*) = 1, 'duplicado: 1 só contrato assinado')
  FROM public.exclusive_documents WHERE capture_id = :'cg' AND kind = 'assinado';
SELECT pg_temp.ok(count(*) = :n_notif, 'duplicado: nenhum aviso a mais')
  FROM public.notifications WHERE exclusive_capture_id = :'cg';

-- 3) Gestor SEM Plano de Marketing → anexa e continua aguardando ----------------------------------------
SELECT pg_temp.ok(pg_temp.webhook(:'cs') = 'attached', 'gestor sem plano: anexa o assinado');
SELECT pg_temp.ok(pg_temp.st(:'cs') = 'em_assinatura' AND pg_temp.auto(:'cs') = 0
  AND (SELECT signed_on IS NULL FROM public.exclusive_captures WHERE id = :'cs'),
  'gestor sem plano: continua aguardando (em_assinatura, sem aprovar, sem signed_on)');
SELECT pg_temp.ok(count(*) >= 1 AND bool_and(mensagem LIKE '%gestor precisa aprovar%'),
  'gestor sem plano: sino continua pedindo a aprovação')
  FROM public.notifications WHERE exclusive_capture_id = :'cs' AND tipo = 'clicksign_status';
SELECT pg_temp.ok(bool_and(f.evento = 'finalizado'), 'gestor sem plano: WhatsApp com o evento antigo (finalizado)')
  FROM public.clicksign_whatsapp_fila f JOIN public.clicksign_envelopes e ON e.id = f.envelope_id
  WHERE e.capture_id = :'cs';
-- Depois de marcar o Plano, a aprovação manual de hoje continua funcionando.
SET LOCAL session_replication_role = replica;
UPDATE public.exclusive_captures SET form_data = jsonb_set(form_data, '{dossie}', jsonb_build_array(:'acao'))
  WHERE id = :'cs';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.as_user(:'gestor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L)', :'cs', 'aprovar')) IS NULL,
  'gestor sem plano: depois de marcar o Plano, aprova manualmente como hoje');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.st(:'cs') = 'aprovada', 'gestor sem plano: aprovada pelo botão');

-- 4) Corretor + contrato assinado + Plano → aprovada automaticamente (decisão de Denis 13/11) -----------
-- Antes: 2 captações do corretor já aprovadas neste mês (para testar os vouchers de fotos: regra de 3).
SET LOCAL session_replication_role = replica;
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, manual, signed_on)
  SELECT gen_random_uuid(), :'c1', :'c1', 'remax-padrao', :'unit', 'aprovada', '{}'::jsonb,
    'Pessoa Exemplo', '11144477735', 'CRECI 1', :'org', false, pg_temp.hoje()
  FROM generate_series(1, 2);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.ok(count(*) = 0, 'corretor: antes do webhook, 2 assinadas no mês e nenhum voucher')
  FROM public.photo_vouchers WHERE organization_id = :'org' AND corretor_id = :'c1';
SELECT pg_temp.ok(pg_temp.webhook(:'cc') = 'attached', 'corretor+plano: anexa o assinado');
SELECT pg_temp.ok(status = 'aprovada' AND signed_on = pg_temp.hoje(),
  'corretor+plano: aprovada automaticamente com signed_on = hoje')
  FROM public.exclusive_captures WHERE id = :'cc';
SELECT pg_temp.ok(count(*) = 1 AND bool_and(actor_id = :'c1') AND bool_and(detail LIKE 'Aprovada automaticamente:%'),
  'corretor+plano: 1 histórico ''aprovar'' automático, autor = o captador (corretor)')
  FROM public.exclusive_history WHERE capture_id = :'cc' AND action = 'aprovar';
SELECT pg_temp.ok(
  EXISTS (SELECT 1 FROM public.notifications WHERE exclusive_capture_id = :'cc' AND user_id = :'c1'
            AND mensagem LIKE '%aprovada automaticamente%')
  AND EXISTS (SELECT 1 FROM public.notifications WHERE exclusive_capture_id = :'cc' AND user_id = :'gestor'
            AND mensagem LIKE '%aprovada automaticamente%')
  AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE exclusive_capture_id = :'cc'
            AND mensagem LIKE '%gestor precisa aprovar%'),
  'corretor+plano: sino "aprovada automaticamente" para o captador e para o gestor da equipe');
SELECT pg_temp.ok(count(DISTINCT f.user_id) FILTER (WHERE f.user_id IN (:'c1', :'gestor')) = 2
  AND bool_and(f.evento = 'aprovada_auto'),
  'corretor+plano: WhatsApp aprovada_auto para o captador e para o gestor da equipe')
  FROM public.clicksign_whatsapp_fila f JOIN public.clicksign_envelopes e ON e.id = f.envelope_id
  WHERE e.capture_id = :'cc';
SELECT pg_temp.ok(count(*) = 1, 'corretor+plano: 1 aviso por pessoa (sem duplicar)')
  FROM public.notifications WHERE exclusive_capture_id = :'cc' AND user_id = :'c1';
SELECT pg_temp.ok(count(*) = 3, 'corretor+plano: 3ª captação assinada no mês → 3 vouchers de fotos pelo webhook')
  FROM public.photo_vouchers WHERE organization_id = :'org' AND corretor_id = :'c1';
SELECT pg_temp.ok(pg_temp.webhook(:'cc') = 'already' AND pg_temp.auto(:'cc') = 1,
  'corretor+plano: webhook duplicado sem efeito');

-- 4b) Corretor SEM Plano → anexa e continua aguardando ----------------------------------------------------
SELECT pg_temp.ok(pg_temp.webhook(:'cp') = 'attached', 'corretor sem plano: anexa o assinado');
SELECT pg_temp.ok(pg_temp.st(:'cp') = 'em_assinatura' AND pg_temp.auto(:'cp') = 0
  AND (SELECT signed_on IS NULL FROM public.exclusive_captures WHERE id = :'cp'),
  'corretor sem plano: continua aguardando (sem aprovar, sem signed_on)');
SELECT pg_temp.ok(count(*) >= 2 AND bool_and(mensagem LIKE '%gestor precisa aprovar%'),
  'corretor sem plano: sino continua pedindo a aprovação ao gestor')
  FROM public.notifications WHERE exclusive_capture_id = :'cp' AND tipo = 'clicksign_status';

-- 4c) Corretor com envelope de TESTE e cadastro manual do corretor → não aprovam ------------------------
SELECT pg_temp.ok(pg_temp.webhook(:'cy') = 'attached' AND pg_temp.st(:'cy') = 'em_assinatura' AND pg_temp.auto(:'cy') = 0,
  'corretor, envelope de teste: anexa, mas não aprova');
SELECT pg_temp.ok(pg_temp.webhook(:'cn') = 'attached' AND pg_temp.st(:'cn') = 'em_assinatura' AND pg_temp.auto(:'cn') = 0,
  'corretor, cadastro manual: continua com aprovação manual');

-- 5) Team leader → também aprova sozinho -----------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.webhook(:'ct') = 'attached' AND pg_temp.st(:'ct') = 'aprovada' AND pg_temp.auto(:'ct') = 1,
  'team leader + plano: aprovada automaticamente');

-- 6) Envelope em modo TESTE → não aprova ----------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.webhook(:'cx') = 'attached' AND pg_temp.st(:'cx') = 'em_assinatura' AND pg_temp.auto(:'cx') = 0,
  'envelope de teste: anexa, mas não aprova');

-- 7) Cadastro manual → não aprova sozinho ---------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.webhook(:'cm') = 'attached' AND pg_temp.st(:'cm') = 'em_assinatura' AND pg_temp.auto(:'cm') = 0,
  'cadastro manual: continua com aprovação manual');

-- 7b) Captador que saiu da imobiliária: a trava de organização da tabela barra a aprovação (igual ao botão).
-- O anexo vale, a captação continua aguardando e o histórico mostra que a aprovação automática falhou. -------
\set cf 'c0000000-0000-4000-8000-00000000000a'
SET LOCAL session_replication_role = replica;
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, manual)
  VALUES (:'cf', :'c1', :'c1', 'remax-padrao', :'unit', 'em_assinatura',
    jsonb_build_object('dossie', jsonb_build_array(:'acao')), 'Pessoa Exemplo', '11144477735', 'CRECI 1', :'org', false);
INSERT INTO public.exclusive_documents (id, capture_id, kind, owner_index, storage_path, file_name, uploaded_by,
    created_at, organization_id)
  VALUES (gen_random_uuid(), :'cf', 'gerado', 0, :'org' || '/' || :'cf' || '/gerado.pdf', 'gerado.pdf', :'gestor',
    now() - interval '1 hour', :'org');
INSERT INTO public.clicksign_envelopes (id, organization_id, origem, capture_id, source_document_id,
    envelope_key, document_key, status, is_test, created_by, signers)
  SELECT gen_random_uuid(), :'org', 'captacao', :'cf', d.id, gen_random_uuid()::text, gen_random_uuid()::text,
    'running', false, :'gestor', '[]'::jsonb FROM public.exclusive_documents d WHERE d.capture_id = :'cf';
INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('exclusive-captures', pg_temp.pdf(:'org', :'cf', 1), '{"mimetype":"application/pdf"}'::jsonb);
-- Corretor movido para outra imobiliária (o perfil deixa de ser desta org).
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  ('a0000000-0000-4000-8000-0000000000b0', 'teste-autoaprov-b', 'Imobiliária Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
UPDATE public.profiles SET organization_id = 'a0000000-0000-4000-8000-0000000000b0' WHERE id = :'c1';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.ok(pg_temp.webhook(:'cf') = 'attached' AND pg_temp.st(:'cf') = 'em_assinatura'
  AND pg_temp.auto(:'cf') = 0, 'captador fora da imobiliária: anexa, mas não aprova (falha isolada)');
SELECT pg_temp.ok(count(*) = 1, 'captador fora da imobiliária: anexo do assinado continua valendo')
  FROM public.exclusive_documents WHERE capture_id = :'cf' AND kind = 'assinado';
SELECT pg_temp.ok(count(*) = 1 AND bool_and(actor_id = :'gestor') AND bool_and(detail LIKE '%aprove pelo botão%'),
  'falha da aprovação automática fica registrada no histórico (aprovacao_auto_falhou)')
  FROM public.exclusive_history WHERE capture_id = :'cf' AND action = 'aprovacao_auto_falhou';
SELECT pg_temp.ok(count(*) >= 1 AND bool_and(mensagem LIKE '%gestor precisa aprovar%'),
  'falha da aprovação automática: o aviso continua pedindo a aprovação do gestor')
  FROM public.notifications WHERE exclusive_capture_id = :'cf' AND tipo = 'clicksign_status';
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET organization_id = :'org' WHERE id = :'c1';
SET LOCAL session_replication_role = origin;

-- 8) A trava "só gestor/TL" saiu: a função auxiliar da 1ª versão não existe -------------------------------
SELECT pg_temp.ok(to_regprocedure('public.exclusive_captor_eh_gestor(public.exclusive_captures)') IS NULL,
  'sem a função exclusive_captor_eh_gestor (regra vale para todo captador)');

-- 9) Devolver depois de aprovada automaticamente continua possível ---------------------------------------
SELECT pg_temp.as_user(:'gestor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L, %L)', :'cg', 'devolver',
  'Conferir dados')) IS NULL, 'devolver depois da aprovação automática: aceito');
RESET ROLE;
SELECT pg_temp.ok(status = 'devolvida' AND signed_on IS NULL, 'devolvida: status devolvida e signed_on limpo')
  FROM public.exclusive_captures WHERE id = :'cg';

-- 9b) Devolver a captação de corretor aprovada automaticamente também continua possível -------------------
SELECT pg_temp.as_user(:'gestor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transition(%L, %L, %L)', :'cc', 'devolver',
  'Conferir dados')) IS NULL, 'corretor: devolver depois da aprovação automática é aceito');
RESET ROLE;
SELECT pg_temp.ok(status = 'devolvida' AND signed_on IS NULL, 'corretor devolvida: status devolvida e signed_on limpo')
  FROM public.exclusive_captures WHERE id = :'cc';

-- 10) Acesso: usuário logado continua sem chamar a função do webhook ----------------------------------------
SELECT pg_temp.as_user(:'c1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_attach_signed(%L, %L, %L)', pg_temp.env(:'cc'), 'x', 'y'))
  LIKE '42501%', 'clicksign_attach_signed: authenticated continua sem acesso');
RESET ROLE;

SELECT (CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END) || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
