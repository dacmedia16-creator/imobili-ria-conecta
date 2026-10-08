-- Suíte do Feedback ligado à captação + Plano de Marketing (migration 20261009010000). Roda DENTRO de transação
-- revertida (run-feedback-captacao-plano.sh). Homologação: A = Única (00000000-…-0001), B = agencia-b-homolog.
-- Perfis: captador (UE Corretor), gestor da equipe (UE Gestor), corretor de outra equipe (QA A Corretor Dois),
-- dono de outro ID (QA A Corretor Um), admin (QA A Admin) e admin da imobiliária B. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE txt(k text PRIMARY KEY, v text);
GRANT ALL ON r, ids, txt TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.t(_k text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM txt WHERE k = _k $$;
CREATE FUNCTION pg_temp.pend(_kind text, _cap text) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM public.exclusive_feedback_pendencias(7) WHERE kind = _kind AND capture_id = pg_temp.id(_cap) $$;

SELECT '00000000-0000-4000-8000-000000000001' AS org_a, '2a000000-0000-4000-8000-0000000000b0' AS org_b \gset
INSERT INTO ids VALUES ('captador', '10000000-0000-4000-8000-000000000003'), ('gestor', '10000000-0000-4000-8000-000000000002'),
  ('dono2', '5745cbff-22b6-4a28-a515-dd6706504b8b'), ('outra', 'ebffaded-075c-493f-89e2-1d3d62901dc4'),
  ('admin', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('b_admin', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
INSERT INTO storage.buckets (id, name, public) VALUES ('exclusive-captures', 'exclusive-captures', false) ON CONFLICT (id) DO NOTHING;
UPDATE public.organization_modules SET enabled = true
 WHERE module IN ('captacao_exclusiva', 'feedback_proprietario') AND organization_id IN (:'org_a', :'org_b');
INSERT INTO ids SELECT 'unit_a', id FROM public.exclusive_units WHERE organization_id = :'org_a' AND ativo ORDER BY nome LIMIT 1;
-- IDs RE/MAX fictícios (só nesta transação).
UPDATE public.profiles SET remax_id = '630699001' WHERE id = pg_temp.id('captador');
UPDATE public.profiles SET remax_id = '630699002' WHERE id = pg_temp.id('dono2');
-- Ações do catálogo: uma de cada peso.
INSERT INTO ids SELECT 'a_vital', id FROM public.owner_feedback_actions WHERE organization_id = :'org_a' AND list = 'marketing' AND weight = 'vital' ORDER BY sort LIMIT 1;
INSERT INTO ids SELECT 'a_imp', id FROM public.owner_feedback_actions WHERE organization_id = :'org_a' AND list = 'marketing' AND weight = 'importante' ORDER BY sort LIMIT 1;
INSERT INTO ids SELECT 'a_comp', id FROM public.owner_feedback_actions WHERE organization_id = :'org_a' AND list = 'marketing' AND weight = 'complementar' ORDER BY sort LIMIT 1;
INSERT INTO ids SELECT 'a_fora', id FROM public.owner_feedback_actions WHERE organization_id = :'org_a' AND list = 'marketing' AND weight = 'vital' ORDER BY sort DESC LIMIT 1;

-- Coleta fictícia (a mais recente da imobiliária A).
INSERT INTO public.portal_listing_snapshots (organization_id, portal, collected_on, listing_code, window_kind, views, contacts)
VALUES (:'org_a', 'zap', current_date, '630699001-114', 'cumulative', 150, 4),
       (:'org_a', 'imovelweb', current_date, '630699001-114', 'cumulative', 62, 2),
       (:'org_a', 'zap', current_date, '630699001-131', 'cumulative', 87, 1),
       (:'org_a', 'zap', current_date, '630699002x87', 'cumulative', 140, 3);

-- Quatro captações do captador, aprovadas há 20 dias.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
INSERT INTO ids SELECT 'c' || g, public.exclusive_create_unit(pg_temp.id('unit_a')) FROM generate_series(1, 4) g;
RESET ROLE;
UPDATE public.exclusive_captures SET status = 'aprovada', signed_on = current_date - 20,
  form_data = form_data || jsonb_build_object('imovel', jsonb_build_object('tipo_imovel', 'Casa', 'bairro', 'Jardim Fictício'),
    'proprietario_1', jsonb_build_object('nome_completo', 'Proprietário Fictício'),
    'dossie', jsonb_build_array(pg_temp.id('a_vital'), pg_temp.id('a_imp'), pg_temp.id('a_comp')))
 WHERE id IN (pg_temp.id('c1'), pg_temp.id('c2'), pg_temp.id('c3'), pg_temp.id('c4'));
INSERT INTO public.exclusive_history (capture_id, actor_id, action, created_at)
  SELECT v, pg_temp.id('gestor'), 'aprovar', now() - interval '20 days' FROM ids WHERE k IN ('c1','c2','c3','c4');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_history WHERE capture_id = pg_temp.id('c1') AND action = 'plano_alterado') = 0,
  'aprovação/criação sem mudança de plano não gera histórico de plano');

SET LOCAL ROLE authenticated;
-- 1) Corretor: prefixo travado e lista curta
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((public.exclusive_listing_context(pg_temp.id('c1'))->>'prefix') = '630699001', 'contexto: prefixo = ID RE/MAX do captador');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(public.exclusive_listing_context(pg_temp.id('c1'))->'suggestions') s
  WHERE s->>'code' IN ('630699001-114','630699001-131')) = 2, 'lista curta: anúncios do ID dele sem captação');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(public.exclusive_listing_context(pg_temp.id('c1'))->'suggestions') s
  WHERE s->>'code' LIKE '630699002%') = 0, 'lista curta: não mostra anúncio de outro ID');
SELECT pg_temp.ok((public.exclusive_listing_check(pg_temp.id('c1'), '630699001-114')->'seen'->>'views')::int = 212
  AND (public.exclusive_listing_check(pg_temp.id('c1'), '630699001-114')->>'own_prefix')::boolean, 'conferir: encontrado na coleta, soma 212 views');
SELECT pg_temp.ok(public.exclusive_listing_check(pg_temp.id('c1'), '630699001-152')->'seen' = 'null'::jsonb, 'conferir: código não coletado');
SELECT pg_temp.ok(NOT (public.exclusive_listing_check(pg_temp.id('c1'), 'abc')->>'valid')::boolean, 'conferir: código inválido');
-- 2) Ligar
SELECT pg_temp.ok(public.exclusive_listing_link(pg_temp.id('c1'), '630699001-114') = 'ativo', 'captador liga o próprio anúncio: ativo');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_listing_links WHERE capture_id = pg_temp.id('c1') AND status = 'ativo' AND linked_by = pg_temp.id('captador')) = 1, 'ligação gravada com quem ligou');
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(public.exclusive_listing_context(pg_temp.id('c2'))->'suggestions') s
  WHERE s->>'code' = '630699001-114') = 0, 'lista curta: anúncio ligado sai da lista');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_listing_link(%L, %L)', pg_temp.id('c2'), '630699001x0114')) LIKE '%outra captação%',
  'mesmo código (formato x/zero à esquerda) não liga em 2 captações');
SELECT pg_temp.ok((public.exclusive_listing_check(pg_temp.id('c2'), '630699001-114')->'conflict'->>'capture_id')::uuid = pg_temp.id('c1'), 'conferir mostra a captação em conflito');
SELECT pg_temp.ok(public.exclusive_listing_link(pg_temp.id('c4'), '630699001-152') = 'ativo', 'código ainda não coletado: salva mesmo assim');
-- Outro ID: aguarda gestor
SELECT pg_temp.ok(public.exclusive_listing_link(pg_temp.id('c2'), '630699002x87') = 'aguardando_gestor', 'outro ID (parceiro/TL): aguardando gestor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_listing_decide(%L, true)',
  (SELECT id FROM public.exclusive_listing_links WHERE capture_id = pg_temp.id('c2') AND status = 'aguardando_gestor'))) LIKE '42501%', 'captador não confirma o próprio pedido');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.exclusive_feedback_pendencias(7)') LIKE '42501%', 'corretor não abre o painel do gestor');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.exclusive_listing_links (organization_id, capture_id, listing_code, status, linked_by) VALUES (%L,%L,%L,%L,%L)',
  :'org_a', pg_temp.id('c3'), '630699001-131', 'ativo', pg_temp.id('captador'))) LIKE '42501%', 'sem escrita direta na tabela (só RPC)');
-- 3) Plano de Marketing
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE in_plan) = 3, 'plano: 3 ações escolhidas na captação');
SELECT pg_temp.ok((SELECT prazo FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE action_id = pg_temp.id('a_vital')) = current_date - 13, 'prazo essencial = aprovação + 7 dias');
SELECT public.exclusive_plan_mark(pg_temp.id('c1'), pg_temp.id('a_vital'), current_date - 15);
SELECT pg_temp.ok((SELECT done_on = current_date - 15 AND done_by_nome IS NOT NULL FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE action_id = pg_temp.id('a_vital')), 'marcar feito: data + quem marcou');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_plan_mark(%L,%L,%L)', pg_temp.id('c1'), pg_temp.id('a_fora'), current_date)) LIKE '%fora do Plano%', 'ação fora do plano da captação: recusa');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_plan_mark(%L,%L,%L)', pg_temp.id('c1'), pg_temp.id('a_imp'), current_date + 1)) LIKE '%Data inválida%', 'data futura: recusa');
-- Prova (foto) no bucket privado
INSERT INTO txt SELECT 'proof', :'org_a' || '/' || pg_temp.id('c1') || '/plano/' || gen_random_uuid() || '.png';
INSERT INTO storage.objects (bucket_id, name, metadata) SELECT 'exclusive-captures', pg_temp.t('proof'), '{"mimetype":"image/png"}';
SELECT public.exclusive_plan_mark(pg_temp.id('c1'), pg_temp.id('a_imp'), current_date, pg_temp.t('proof'), 'placa.png');
SELECT pg_temp.ok((SELECT proof_path = pg_temp.t('proof') FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE action_id = pg_temp.id('a_imp')), 'prova anexada à ação');
SELECT pg_temp.ok((SELECT count(*) FROM storage.objects WHERE name = pg_temp.t('proof')) = 1, 'captador lê a prova');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_plan_mark(%L,%L,%L,%L,%L)', pg_temp.id('c1'), pg_temp.id('a_comp'), current_date,
  :'org_a' || '/' || pg_temp.id('c2') || '/plano/' || gen_random_uuid() || '.png', 'x.png')) LIKE '%Prova inválida%', 'prova de outra captação: recusa');
SELECT public.exclusive_plan_unmark(pg_temp.id('c1'), pg_temp.id('a_imp'));
SELECT public.exclusive_plan_mark(pg_temp.id('c1'), pg_temp.id('a_imp'), current_date, pg_temp.t('proof'), 'placa.png');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_history WHERE capture_id = pg_temp.id('c1') AND action IN ('plano_feito','plano_desmarcado','anuncio_ligado')) = 5, 'histórico registra ligar, marcar e desmarcar');

-- 4) Corretor de outra equipe e imobiliária B
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_listing_context(%L)', pg_temp.id('c1'))) LIKE '42501%', 'outra equipe: não abre a área do anúncio');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_listing_link(%L, %L)', pg_temp.id('c3'), '630699001-131')) LIKE '42501%', 'outra equipe: não liga');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_plan_mark(%L,%L,%L)', pg_temp.id('c1'), pg_temp.id('a_comp'), current_date)) LIKE '42501%', 'outra equipe: não marca o plano');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_listing_links WHERE capture_id = pg_temp.id('c1')) = 0, 'outra equipe: não lê a ligação');
SELECT pg_temp.ok((SELECT count(*) FROM storage.objects WHERE name = pg_temp.t('proof')) = 0, 'outra equipe: não lê a prova');
SELECT pg_temp.ok(public.owner_feedback_captacao('630699001-114') IS NULL, 'outra equipe: Feedback não mostra a captação');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_plan_view(%L)', pg_temp.id('c1'))) LIKE '42501%', 'imobiliária B: não vê o plano');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_listing_links) + (SELECT count(*) FROM public.exclusive_plan_done) = 0, 'imobiliária B: nenhuma linha visível');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_feedback_pendencias(7) WHERE capture_id IN (SELECT v FROM ids)) = 0, 'imobiliária B: painel sem captações da A');

-- 5) Gestor: painel e confirmação
RESET ROLE;
UPDATE public.exclusive_listing_links SET linked_at = now() - interval '10 days' WHERE capture_id = pg_temp.id('c4');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok(pg_temp.pend('sem_anuncio', 'c3') = 1, 'painel: aprovada há 20 dias sem anúncio');
SELECT pg_temp.ok(pg_temp.pend('sem_anuncio', 'c1') = 0, 'painel: captação ligada não aparece como sem anúncio');
SELECT pg_temp.ok(pg_temp.pend('nao_coletado', 'c4') = 1, 'painel: código salvo que não apareceu na coleta');
SELECT pg_temp.ok(pg_temp.pend('confirmar', 'c2') = 1, 'painel: anúncio de outro ID a confirmar');
SELECT pg_temp.ok((SELECT acao FROM public.exclusive_feedback_pendencias(7) WHERE kind = 'confirmar' AND capture_id = pg_temp.id('c2')) = 'QA A Corretor Um', 'painel: mostra o dono do outro ID');
SELECT pg_temp.ok(pg_temp.pend('atrasada', 'c1') = 0, 'painel: c1 sem atrasadas (essencial e importante feitas, complementar no prazo)');
SELECT pg_temp.ok(pg_temp.pend('atrasada', 'c3') = 2, 'painel: c3 com 2 atrasadas (essencial e importante)');
SELECT public.exclusive_listing_decide((SELECT id FROM public.exclusive_listing_links WHERE capture_id = pg_temp.id('c2') AND status = 'aguardando_gestor'), true);
SELECT pg_temp.ok((SELECT status = 'ativo' AND decided_by = pg_temp.id('gestor') FROM public.exclusive_listing_links WHERE capture_id = pg_temp.id('c2') AND status <> 'encerrado'), 'gestor confirma: ativo, com quem decidiu');
SELECT pg_temp.ok(pg_temp.pend('confirmar', 'c2') = 0, 'painel: confirmado sai da fila');
SELECT pg_temp.ok((SELECT count(*) FROM storage.objects WHERE name = pg_temp.t('proof')) = 1, 'gestor da equipe lê a prova');
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_listing_unlink(%L, %L)', pg_temp.id('c2'), 'troca')) LIKE '42501%', 'outro ID confirmado: só o gestor desliga');
SELECT pg_temp.ok((public.owner_feedback_captacao('630699001X114')->>'capture_id')::uuid = pg_temp.id('c1'), 'Feedback acha a captação pelo código (com x)');
SELECT public.exclusive_listing_unlink(pg_temp.id('c4'), 'número digitado errado');
SELECT pg_temp.ok(public.exclusive_listing_link(pg_temp.id('c4'), '630699001-131') = 'ativo', 'depois de desligar, liga outro código');
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_listing_links WHERE capture_id IN (pg_temp.id('c1'), pg_temp.id('c2'), pg_temp.id('c4'))) = 4, 'admin vê as ligações da imobiliária (inclui histórico)');
SELECT pg_temp.ok(pg_temp.pend('sem_anuncio', 'c3') = 1, 'admin vê o painel da imobiliária');

-- 6) Plano alterado depois da aprovação: registra, não apaga o que foi feito
RESET ROLE;
UPDATE public.exclusive_captures SET form_data = jsonb_set(form_data, '{dossie}', jsonb_build_array(pg_temp.id('a_comp'), pg_temp.id('a_fora')))
 WHERE id = pg_temp.id('c1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('captador')::text);
SELECT pg_temp.ok((SELECT detail FROM public.exclusive_history WHERE capture_id = pg_temp.id('c1') AND action = 'plano_alterado' LIMIT 1) LIKE '%+1 / -2%', 'plano alterado após aprovação vai ao histórico (+1/-2)');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_plan_view(pg_temp.id('c1')) WHERE NOT in_plan AND done_on IS NOT NULL) = 2, 'ações feitas que saíram do plano continuam guardadas');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
