-- Suíte das correções da auditoria da captação (migration 20261008210000). Roda DENTRO de transação
-- revertida (run-captacao-auditoria-correcoes.sh). Homologação: A = Única (00000000-…-0001),
-- B = agencia-b-homolog (faz o papel de outra imobiliária / REMAX-TESTE).
-- Perfis: captador (UE Corretor), gestor da equipe (UE Gestor), TL da equipe (QA A Corretor Tres,
-- promovido a team_leader e co-líder só aqui), gestor de OUTRA equipe (QA A Gestor), admin (QA A Admin)
-- e admin da imobiliária B. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.tr(_c text, _action text, _detail text DEFAULT NULL) RETURNS text LANGUAGE sql AS
  $$ SELECT pg_temp.err(format('SELECT public.exclusive_transition(%L, %L, %L)', pg_temp.id(_c), _action, _detail)) $$;
CREATE FUNCTION pg_temp.st(_c text) RETURNS text LANGUAGE sql AS
  $$ SELECT status FROM public.exclusive_captures WHERE id = pg_temp.id(_c) $$;
-- Documento direto (sem storage): _ago = minutos atrás.
CREATE FUNCTION pg_temp.doc(_c text, _kind text, _ago int DEFAULT 0) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.exclusive_documents (capture_id, kind, owner_index, storage_path, file_name, uploaded_by, created_at)
  VALUES (pg_temp.id(_c), _kind, 0, 'x/' || gen_random_uuid() || '.pdf', _kind || '-ficticio.pdf', pg_temp.id('gestor'),
          now() - make_interval(mins => _ago))
  ON CONFLICT (capture_id, kind, owner_index) DO UPDATE SET created_at = excluded.created_at $$;
CREATE FUNCTION pg_temp.plano(_c text, _on boolean) RETURNS void LANGUAGE sql AS $$
  UPDATE public.exclusive_captures SET form_data = form_data || jsonb_build_object('dossie',
    CASE WHEN _on THEN jsonb_build_array(pg_temp.id('acao')::text) ELSE '[]'::jsonb END)
  WHERE id = pg_temp.id(_c) $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('captador', '10000000-0000-4000-8000-000000000003'), ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('tl', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('outra', 'cab7391a-463f-4d97-b99b-ced6e4696796'),
  ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536'),
  ('team', '1a000000-0000-4000-8000-000000000001');
INSERT INTO storage.buckets (id, name, public) VALUES ('exclusive-captures', 'exclusive-captures', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.organization_modules (organization_id, module, enabled)
  SELECT o, m, true FROM unnest(ARRAY[:'org_a', :'org_b']::uuid[]) o, unnest(ARRAY['captacao_exclusiva','feedback_proprietario']) m
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
INSERT INTO ids SELECT 'acao', id FROM public.owner_feedback_actions
  WHERE organization_id = :'org_a' AND list = 'marketing' AND active ORDER BY sort LIMIT 1;
-- TL da Equipe UE (só nesta transação)
INSERT INTO public.user_roles (user_id, role) VALUES (pg_temp.id('tl'), 'team_leader') ON CONFLICT DO NOTHING;
INSERT INTO public.team_co_leaders (team_id, user_id) VALUES (pg_temp.id('team'), pg_temp.id('tl')) ON CONFLICT DO NOTHING;
SELECT pg_temp.ok(pg_temp.id('unit_a') IS NOT NULL AND pg_temp.id('acao') IS NOT NULL, 'pré: unidade e catálogo de marketing ativos na Única');

-- Captações do captador: n1 normal, m1 manual, a1..a3 para devolver aprovada
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
INSERT INTO ids SELECT 'n1', public.exclusive_create_unit(pg_temp.id('unit_a'));
INSERT INTO ids SELECT 'm1', public.exclusive_create_manual(pg_temp.id('unit_a'));
INSERT INTO ids SELECT 'a' || g, public.exclusive_create_unit(pg_temp.id('unit_a')) FROM generate_series(1, 3) g;
RESET ROLE;

-- ===== ALTO-2: trava do Plano e do contrato gerado ===============================================
-- (a) Manual: enviar sem Plano é barrado; com Plano passa.
SELECT pg_temp.doc('m1', 'assinado');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.tr('m1', 'enviar') LIKE '%Plano de Marketing%', 'manual: enviar sem Plano barrado no banco');
RESET ROLE; SELECT pg_temp.plano('m1', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.tr('m1', 'enviar') IS NULL AND pg_temp.st('m1') = 'enviada', 'manual: enviar com Plano passa');
-- Manual: aprovar sem Plano barrado (Plano removido depois do envio, simulando registro antigo)
RESET ROLE; SELECT pg_temp.plano('m1', false); SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok(pg_temp.tr('m1', 'aprovar') LIKE '%Plano de Marketing%', 'manual: aprovar sem Plano barrado');
RESET ROLE; SELECT pg_temp.plano('m1', true); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.tr('m1', 'aprovar') IS NULL AND pg_temp.st('m1') = 'aprovada', 'manual: aprovar com Plano passa (sem exigir gerado)');

-- (b) Normal: captação enviada (estado montado direto, como os registros pendentes de produção)
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'enviada' WHERE id = pg_temp.id('n1');
SELECT pg_temp.doc('n1', 'gerado', 30); SELECT pg_temp.doc('n1', 'assinado', 10);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok(pg_temp.tr('n1', 'aprovar') LIKE '%Plano de Marketing%', 'normal: aprovar sem Plano barrado no banco');
RESET ROLE; SELECT pg_temp.plano('n1', true);
-- Plano com id que não é do catálogo ativo não conta
UPDATE public.exclusive_captures SET form_data = form_data || jsonb_build_object('dossie', jsonb_build_array(gen_random_uuid()::text))
  WHERE id = pg_temp.id('n1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.tr('n1', 'aprovar') LIKE '%Plano de Marketing%', 'normal: Plano com ação fora do catálogo não conta');
RESET ROLE; SELECT pg_temp.plano('n1', true);
-- Sem o gerado
DELETE FROM public.exclusive_documents WHERE capture_id = pg_temp.id('n1') AND kind = 'gerado';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.tr('n1', 'aprovar') LIKE '%Gere o contrato pelo sistema%', 'normal: aprovar sem contrato gerado barrado');
-- Assinado anexado ANTES do gerado
RESET ROLE; SELECT pg_temp.doc('n1', 'gerado', 5); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.tr('n1', 'aprovar') LIKE '%Gere o contrato pelo sistema%', 'normal: assinado anterior ao gerado barrado');
-- exclusive_register_document: assinado sem gerado é recusado
RESET ROLE;
DELETE FROM public.exclusive_documents WHERE capture_id = pg_temp.id('n1') AND kind IN ('gerado', 'assinado');
INSERT INTO ids SELECT 'obj', gen_random_uuid();
INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('exclusive-captures',
  :'org_a' || '/' || pg_temp.id('n1') || '/' || pg_temp.id('obj') || '.pdf', '{"mimetype":"application/pdf"}');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_register_document(%L, ''assinado'', 0, %L, ''c.pdf'')',
  pg_temp.id('n1'), :'org_a' || '/' || pg_temp.id('n1') || '/' || pg_temp.id('obj') || '.pdf')) LIKE '%Gere o contrato pelo sistema%',
  'normal: banco recusa anexar assinado antes do gerado');
-- Com gerado e assinado depois dele: aprova
RESET ROLE; SELECT pg_temp.doc('n1', 'gerado', 30); SELECT pg_temp.doc('n1', 'assinado', 10); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.tr('n1', 'aprovar') IS NULL AND pg_temp.st('n1') = 'aprovada', 'normal: gerado + assinado + Plano aprova');
-- Imobiliária sem catálogo ativo / Feedback desligado: Plano não é exigido
RESET ROLE;
SELECT pg_temp.ok(NOT public.exclusive_plano_ok(:'org_a', '{}'::jsonb), 'plano_ok: Única com catálogo exige Plano');
UPDATE public.organization_modules SET enabled = false WHERE organization_id = :'org_a' AND module = 'feedback_proprietario';
SELECT pg_temp.ok(public.exclusive_plano_ok(:'org_a', '{}'::jsonb), 'plano_ok: Feedback desligado não exige Plano');
UPDATE public.organization_modules SET enabled = true WHERE organization_id = :'org_a' AND module = 'feedback_proprietario';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_plano_ok(%L, ''{}''::jsonb)', :'org_a')) LIKE '42501%',
  'plano_ok não é executável pelo usuário (só dentro das RPCs)');

-- ===== ALTO-1: devolver captação aprovada ========================================================
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = current_date - 15, geo_lat = -23.5, geo_lon = -47.45
  WHERE id IN (pg_temp.id('a1'), pg_temp.id('a2'), pg_temp.id('a3'));
SELECT pg_temp.doc(k, 'gerado', 30), pg_temp.doc(k, 'assinado', 10) FROM unnest(ARRAY['a1','a2','a3']) k;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.mapa_captacoes_v2() WHERE id = pg_temp.id('a1')), 'pré: a1 aprovada aparece no Mapa');
-- Quem NÃO pode
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.tr('a1', 'devolver', 'motivo teste') IS NOT NULL AND pg_temp.st('a1') = 'aprovada', 'corretor (captador) não devolve aprovada');
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok(pg_temp.tr('a1', 'devolver', 'motivo teste') IS NOT NULL, 'gestor de OUTRA equipe não devolve');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok(pg_temp.tr('a1', 'devolver', 'motivo teste') LIKE '%Captação não disponível%', 'imobiliária B (REMAX-TESTE): não disponível');
-- TL sem motivo
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok(pg_temp.tr('a1', 'devolver', '   ') LIKE '%motivo%', 'TL: motivo obrigatório');
-- Com venda ativa ligada: barrado
RESET ROLE;
SELECT set_config('app.virou_venda', 'on', true);
WITH x AS (INSERT INTO public.sales (corretor_id, exclusive_capture_id, organization_id)
  VALUES (pg_temp.id('captador'), pg_temp.id('a1'), :'org_a') RETURNING id)
INSERT INTO ids SELECT 'v1', id FROM x;
SELECT set_config('app.virou_venda', 'off', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok(pg_temp.tr('a1', 'devolver', 'Endereço errado') LIKE '%venda ativa%' AND pg_temp.st('a1') = 'aprovada',
  'devolver aprovada COM venda ativa: barrado');
-- Venda arquivada: libera
RESET ROLE;
ALTER TABLE public.sales DISABLE TRIGGER USER;
UPDATE public.sales SET status = 'arquivada' WHERE id = pg_temp.id('v1');
ALTER TABLE public.sales ENABLE TRIGGER USER;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok(pg_temp.tr('a1', 'devolver', 'Endereço errado no contrato') IS NULL AND pg_temp.st('a1') = 'devolvida',
  'TL devolve aprovada SEM venda ativa');
RESET ROLE;
SELECT pg_temp.ok((SELECT signed_on IS NULL FROM public.exclusive_captures WHERE id = pg_temp.id('a1')), 'signed_on limpo');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.exclusive_documents WHERE capture_id = pg_temp.id('a1') AND kind = 'assinado'),
  'contrato assinado mantido como histórico');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.exclusive_documents WHERE capture_id = pg_temp.id('a1') AND kind = 'gerado'),
  'PDF gerado (sem assinatura) removido para ser refeito');
SELECT pg_temp.ok((SELECT string_agg(action, ',' ORDER BY id) = 'aprovacao_desfeita,devolver' FROM public.exclusive_history
  WHERE capture_id = pg_temp.id('a1') AND action IN ('aprovacao_desfeita', 'devolver')), 'histórico: aprovacao_desfeita + devolver');
SELECT pg_temp.ok((SELECT detail = 'Endereço errado no contrato' AND actor_id = pg_temp.id('tl') FROM public.exclusive_history
  WHERE capture_id = pg_temp.id('a1') AND action = 'devolver'), 'histórico: motivo e quem devolveu');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.mapa_captacoes_v2() WHERE id = pg_temp.id('a1')), 'devolvida some do Mapa');
-- Gestor e admin também podem
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok(pg_temp.tr('a2', 'devolver', 'Falta foto da fachada') IS NULL AND pg_temp.st('a2') = 'devolvida', 'gestor da equipe devolve aprovada');
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok(pg_temp.tr('a3', 'devolver', 'Revisar comissão') IS NULL AND pg_temp.st('a3') = 'devolvida', 'admin devolve aprovada');
-- O corretor reenvia a devolvida: a trava do Plano vale de novo
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.tr('a1', 'enviar') IS NOT NULL AND pg_temp.st('a1') = 'devolvida', 'devolvida incompleta não reenvia');

-- ===== BAIXO-1: histórico com nome ===============================================================
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok((SELECT actor_nome = 'QA A Corretor Tres' FROM public.exclusive_history_view(pg_temp.id('a1'))
  WHERE action = 'devolver'), 'histórico mostra o NOME de quem devolveu (gestor vendo)');
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT count(*) > 0 AND bool_and(actor_nome IS NOT NULL) FROM public.exclusive_history_view(pg_temp.id('a1'))),
  'captador vê o histórico com nomes');
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.exclusive_history_view(pg_temp.id('n1'))), 'outra equipe: 0 linhas de histórico');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.exclusive_history_view(pg_temp.id('a1'))), 'imobiliária B: 0 linhas de histórico');

-- ===== Sino: coluna nova ========================================================================
RESET ROLE;
SELECT pg_temp.ok(pg_temp.err(format($q$INSERT INTO public.notifications (user_id, tipo, titulo, mensagem, organization_id, exclusive_capture_id)
  VALUES (%L, 'captacao', 't', 'm', %L, %L)$q$, pg_temp.id('b_admin'), :'org_b', pg_temp.id('a1'))) LIKE '23503%',
  'sino: aviso não pode apontar captação de outra imobiliária (FK composta)');
-- Como o servidor grava (service_role, sem usuário no JWT)
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true), set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE service_role;
INSERT INTO r SELECT e IS NULL, 'sino: servidor grava aviso com link da captação ' || coalesce(e, '')
  FROM pg_temp.err(format($q$INSERT INTO public.notifications (user_id, tipo, titulo, mensagem, organization_id, exclusive_capture_id)
  VALUES (%L, 'captacao', 't', 'm', %L, %L)$q$, pg_temp.id('captador'), :'org_a', pg_temp.id('a1'))) e;

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) || ' de ' || count(*) FROM r;
