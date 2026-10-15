-- Suíte local do módulo Mural de Conquistas (20261015120000). Dados sintéticos, tudo em transação com ROLLBACK.
-- Rodar SOMENTE em banco local descartável (estrutura de produção restaurada sem dados):
--   psql -v ON_ERROR_STOP=1 -1 < supabase/tests/mural_conquistas_isolamento.sql
-- Saída esperada: uma linha "ok N - ..." por teste e "MURAL DE CONQUISTAS: TODOS OS TESTES PASSARAM".
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT SELECT ON t_ids TO authenticated, service_role, anon;
INSERT INTO t_ids VALUES
  ('orgA', gen_random_uuid()), ('orgB', gen_random_uuid()),
  ('uA', gen_random_uuid()), ('uA2', gen_random_uuid()), ('uB', gen_random_uuid()), ('uSA', gen_random_uuid()),
  ('vOff', gen_random_uuid()), ('v1', gen_random_uuid()), ('vLanc', gen_random_uuid()), ('vB', gen_random_uuid());

CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT v FROM t_ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.ok(_n int, _cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU % - %', _n, _msg; END IF;
  RAISE NOTICE 'ok % - %', _n, _msg;
END $$;
CREATE FUNCTION pg_temp.as_user(_k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(_k), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.id(_k)::text, true);
  PERFORM set_config('mt.ctx', '', true);
END $$;
-- Simula change_sale_status no nível do banco (status + histórico), sem as validações de formulário.
CREATE FUNCTION pg_temp.status(_k text, _para text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _de text;
BEGIN
  SELECT status::text INTO _de FROM public.sales WHERE id = pg_temp.id(_k);
  UPDATE public.sales SET status = _para::sale_status WHERE id = pg_temp.id(_k);
  INSERT INTO public.sale_status_history (sale_id, de, para, autor_id, organization_id)
  SELECT id, _de::sale_status, _para::sale_status, corretor_id, organization_id FROM public.sales WHERE id = pg_temp.id(_k);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text), pg_temp.ok(int, boolean, text), pg_temp.as_user(text) TO authenticated, service_role, anon;

-- Fixture: duas imobiliárias, dois corretores na A, um na B, um super-admin.
INSERT INTO public.organizations (id, slug, nome) VALUES
  (pg_temp.id('orgA'), 'mural-teste-a', 'Mural Teste A'), (pg_temp.id('orgB'), 'mural-teste-b', 'Mural Teste B');
INSERT INTO auth.users (id, email) SELECT pg_temp.id(k), k || '@mural.teste.local' FROM unnest(ARRAY['uA', 'uA2', 'uB', 'uSA']) k;
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (pg_temp.id('uA'), 'Ana Teste', 'uA@mural.teste.local', true, pg_temp.id('orgA')),
  (pg_temp.id('uA2'), 'Caio Teste', 'uA2@mural.teste.local', true, pg_temp.id('orgA')),
  (pg_temp.id('uB'), 'Bruno Teste', 'uB@mural.teste.local', true, pg_temp.id('orgB')),
  (pg_temp.id('uSA'), 'Super Teste', 'uSA@mural.teste.local', true, pg_temp.id('orgA'))
ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, ativo = true, nome = EXCLUDED.nome;
INSERT INTO public.profile_birthdates (user_id, data_nascimento) VALUES
  (pg_temp.id('uA'), make_date(1990, extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::int, 7)),
  (pg_temp.id('uB'), make_date(1985, extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::int, 9));
INSERT INTO public.organization_members (organization_id, user_id) VALUES
  (pg_temp.id('orgA'), pg_temp.id('uA')), (pg_temp.id('orgA'), pg_temp.id('uA2')),
  (pg_temp.id('orgB'), pg_temp.id('uB')), (pg_temp.id('orgA'), pg_temp.id('uSA'))
ON CONFLICT DO NOTHING;
INSERT INTO public.platform_admins (user_id) VALUES (pg_temp.id('uSA'));
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o, 'mural_conquistas', false FROM unnest(ARRAY[pg_temp.id('orgA'), pg_temp.id('orgB')]) o
ON CONFLICT (organization_id, module) DO NOTHING;

-- As travas de formulário da venda (pagamento, mídia, ficha...) têm testes próprios; aqui só o gatilho do mural
-- fica ligado em sales. Tudo volta no ROLLBACK.
ALTER TABLE public.sales DISABLE TRIGGER USER;
ALTER TABLE public.sales ENABLE TRIGGER trg_zz_mural_conquistas;
INSERT INTO public.sales (id, organization_id, corretor_id, corretor_captador_id, corretor_vendedor_id, modalidade, status,
                          tipo_imovel, imovel_bairro, imovel_cidade, valor_negociado)
SELECT pg_temp.id(x.k), pg_temp.id(x.org), pg_temp.id(x.cap), pg_temp.id(x.cap), pg_temp.id(x.ven), x.mod, 'aguardando_assinatura',
       'Casa', 'Campolim', 'Sorocaba', 987654.32
FROM (VALUES ('vOff', 'orgA', 'uA', 'uA2', 'padrao'), ('v1', 'orgA', 'uA', 'uA2', 'padrao'),
             ('vLanc', 'orgA', 'uA2', 'uA2', 'lancamento'), ('vB', 'orgB', 'uB', 'uB', 'padrao')) x(k, org, cap, ven, mod);

-- 1-3: começa desligado; venda assinada com módulo desligado não gera post nem evento.
SELECT pg_temp.ok(1, (SELECT enabled = false FROM public.organization_modules WHERE organization_id = pg_temp.id('orgA') AND module = 'mural_conquistas'), 'módulo nasce desligado');
SELECT pg_temp.status('vOff', 'contrato_assinado');
SELECT pg_temp.ok(2, (SELECT count(*) = 0 FROM public.achievement_posts WHERE organization_id = pg_temp.id('orgA')), 'desligado: venda assinada não cria post');
SELECT pg_temp.ok(3, EXISTS (SELECT 1 FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'achievement_posts'),
  'tabela de posts publicada no Realtime');

-- 4-5: só super-admin liga.
SELECT pg_temp.as_user('uA');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.platform_set_organization_module(pg_temp.id('orgA'), 'mural_conquistas', true);
  RAISE EXCEPTION 'FALHOU 4 - corretor conseguiu ligar o módulo';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 4 - corretor não liga módulo';
END $$;
RESET ROLE;
SELECT pg_temp.as_user('uSA');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(5, public.platform_set_organization_module(pg_temp.id('orgA'), 'mural_conquistas', true), 'super-admin liga o módulo na A');
RESET ROLE;

-- 6-8: venda assinada cria 1 post com nomes/papéis e imóvel, sem valor nem cliente.
SELECT pg_temp.status('v1', 'contrato_assinado');
SELECT pg_temp.ok(6, (SELECT count(*) = 1 FROM public.achievement_posts WHERE sale_id = pg_temp.id('v1') AND ativo
  AND captador_nome = 'Ana Teste' AND vendedor_nome = 'Caio Teste' AND bairro = 'Campolim' AND cidade = 'Sorocaba' AND tipo_imovel = 'Casa'),
  'contrato assinado cria o post com nomes, papéis e imóvel');
SELECT pg_temp.ok(7, NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'achievement_posts'
  AND (column_name ~* 'valor|comiss|cliente|comprador|vendedor_cliente')), 'post não tem coluna de valor, comissão ou cliente');
CREATE TEMP TABLE t_post ON COMMIT DROP AS SELECT id, created_at FROM public.achievement_posts WHERE sale_id = pg_temp.id('v1');
GRANT SELECT ON t_post TO authenticated;
-- Reprocessar (avança etapa e grava de novo) não duplica nem recria.
SELECT pg_temp.status('v1', 'ocorrencia_pendente');
SELECT public.achievement_sync_sale(pg_temp.id('v1'));
SELECT pg_temp.ok(8, (SELECT count(*) = 1 FROM public.achievement_posts WHERE sale_id = pg_temp.id('v1'))
  AND (SELECT p.id = t.id FROM public.achievement_posts p, t_post t WHERE p.sale_id = pg_temp.id('v1')), 'reprocessamento não duplica (mesmo post)');

-- 9-10: cancelada some do mural; voltar a assinar reativa o MESMO post (sem novo INSERT = sem confete repetido).
SELECT pg_temp.status('v1', 'cancelada');
SELECT pg_temp.ok(9, (SELECT ativo = false FROM public.achievement_posts WHERE sale_id = pg_temp.id('v1')), 'cancelada: post sai do mural');
SELECT pg_temp.status('v1', 'contrato_assinado');
SELECT pg_temp.ok(10, (SELECT ativo AND p.id = t.id AND p.created_at = t.created_at FROM public.achievement_posts p, t_post t WHERE p.sale_id = pg_temp.id('v1')),
  'reassinada: reativa o mesmo post, sem novo evento de inserção');

-- 11-12: lançamento entra só quando vai ao Financeiro.
SELECT pg_temp.status('vLanc', 'ocorrencia_pendente');
SELECT pg_temp.ok(11, (SELECT count(*) = 0 FROM public.achievement_posts WHERE sale_id = pg_temp.id('vLanc')), 'lançamento antes do Financeiro: sem post');
SELECT pg_temp.status('vLanc', 'ocorrencia_analise_financeiro');
SELECT pg_temp.ok(12, (SELECT count(*) = 1 FROM public.achievement_posts WHERE sale_id = pg_temp.id('vLanc') AND ativo), 'lançamento no Financeiro: entra no mural');

-- 13-18: corretor da A vê o feed, parabeniza uma vez, ranking por quantidade, aniversário só dia/mês.
SELECT pg_temp.as_user('uA');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(13, (SELECT count(*) = 2 FROM public.achievement_feed(30)) AND (SELECT count(*) = 2 FROM public.achievement_posts),
  'corretor da A vê os 2 posts da A');
SELECT pg_temp.ok(14, public.achievement_cheer((SELECT id FROM t_post)) = 1 AND public.achievement_cheer((SELECT id FROM t_post)) = 1,
  'parabenizar conta 1 vez por pessoa');
SELECT pg_temp.ok(15, (SELECT cheered_by_me AND cheers = 1 FROM public.achievement_feed(30) WHERE id = (SELECT id FROM t_post)), 'feed mostra o parabéns');
SELECT pg_temp.ok(16, (SELECT array_agg(nome || ':' || pontos ORDER BY pontos DESC, nome) = ARRAY['Caio Teste:4', 'Ana Teste:2']
  FROM public.achievement_ranking(extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::int, extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::int)),
  'ranking pela venda válida (conta também a assinada antes de ligar): captador +1, vendedor +1');
SELECT pg_temp.ok(17, (SELECT array_agg(nome) = ARRAY['Ana Teste'] AND bool_and(dia = 7)
  FROM public.achievement_birthdays(extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::int)),
  'aniversariantes: só da A, só dia/mês');
SELECT pg_temp.ok(18, (SELECT NOT (proargnames && ARRAY['data_nascimento', 'ano', 'idade'])
  FROM pg_proc WHERE oid = 'public.achievement_birthdays(integer)'::regprocedure), 'aniversário não expõe ano nem idade');
-- 19-21: corretor não escreve direto nos posts nem parabeniza em nome de outro; silenciar é pessoal.
DO $$ BEGIN
  UPDATE public.achievement_posts SET bairro = 'x';
  RAISE EXCEPTION 'FALHOU 19 - corretor alterou post';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 19 - corretor não altera post';
END $$;
DO $$ BEGIN
  INSERT INTO public.achievement_cheers (post_id, user_id, organization_id)
  SELECT id, pg_temp.id('uA2'), pg_temp.id('orgA') FROM t_post;
  RAISE EXCEPTION 'FALHOU 20 - parabenizou em nome de outro';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 20 - não grava parabéns direto';
END $$;
SELECT public.achievement_set_muted(true);
SELECT pg_temp.ok(21, (SELECT array_agg(user_id) = ARRAY[pg_temp.id('uA')] FROM public.achievement_mutes), 'silenciar grava preferência própria');
-- 29-30: data de nascimento completa é privada; só o dono lê e grava (via RPC).
SELECT public.profile_set_birthdate(DATE '1991-03-04');
SELECT pg_temp.ok(29, (SELECT array_agg(user_id::text || '|' || data_nascimento) = ARRAY[pg_temp.id('uA')::text || '|1991-03-04']
  FROM public.profile_birthdates), 'nascimento: só o próprio lê e grava');
DO $$ BEGIN
  UPDATE public.profile_birthdates SET data_nascimento = DATE '1970-01-01';
  RAISE EXCEPTION 'FALHOU 30 - gravou nascimento direto';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 30 - nascimento não é gravado direto na tabela';
END $$;
SELECT public.profile_set_birthdate(make_date(1990, extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::int, 7));
RESET ROLE;
SELECT pg_temp.as_user('uA2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(31, (SELECT count(*) = 0 FROM public.profile_birthdates), 'colega não lê nascimento de outro');
RESET ROLE;

-- 22-24: B não vê nada da A; mesmo ligada, só vê o que é dela; parabéns cruzado falha.
SELECT pg_temp.as_user('uB');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(22, (SELECT count(*) = 0 FROM public.achievement_posts) AND (SELECT count(*) = 0 FROM public.achievement_feed(30))
  AND (SELECT count(*) = 0 FROM public.achievement_cheers) AND (SELECT count(*) = 0 FROM public.achievement_mutes)
  AND public.achievements_enabled() = false, 'B (desligada) não vê o mural da A');
RESET ROLE;
SELECT pg_temp.as_user('uSA');
SET LOCAL ROLE authenticated;
SELECT public.platform_set_organization_module(pg_temp.id('orgB'), 'mural_conquistas', true);
RESET ROLE;
SELECT pg_temp.as_user('uB');
SELECT pg_temp.status('vB', 'contrato_assinado');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(23, (SELECT array_agg(sale_id) = ARRAY[pg_temp.id('vB')] FROM public.achievement_posts)
  AND (SELECT array_agg(nome) = ARRAY['Bruno Teste'] FROM public.achievement_birthdays(extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::int)),
  'B ligada vê só o que é dela');
DO $$ BEGIN
  PERFORM public.achievement_cheer((SELECT id FROM t_post));
  RAISE EXCEPTION 'FALHOU 24 - B parabenizou post da A';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 24 - B não parabeniza post da A';
END $$;
RESET ROLE;

-- 25: desligar a A esconde tudo no banco.
SELECT pg_temp.as_user('uSA');
SET LOCAL ROLE authenticated;
SELECT public.platform_set_organization_module(pg_temp.id('orgA'), 'mural_conquistas', false);
RESET ROLE;
SELECT pg_temp.as_user('uA');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(25, (SELECT count(*) = 0 FROM public.achievement_posts) AND (SELECT count(*) = 0 FROM public.achievement_feed(30))
  AND (SELECT count(*) = 0 FROM public.achievement_ranking(2026, 10)), 'A desligada: mural vazio no banco');
RESET ROLE;

-- 26: anon não lê nada.
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM public.achievement_posts;
  RAISE EXCEPTION 'FALHOU 26 - anon leu posts';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 26 - anon não lê posts';
END $$;
RESET ROLE;

-- 27: a sincronização não é chamável por usuário comum.
SELECT pg_temp.as_user('uA');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.achievement_sync_sale(gen_random_uuid());
  RAISE EXCEPTION 'FALHOU 27 - authenticated chamou a sincronização';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 27 - authenticated não chama a sincronização';
END $$;
RESET ROLE;

-- 28: a venda não foi alterada pela comemoração (valor preservado).
SELECT pg_temp.ok(28, (SELECT bool_and(valor_negociado = 987654.32) FROM public.sales WHERE organization_id IN (pg_temp.id('orgA'), pg_temp.id('orgB'))),
  'dados da venda intactos');

DO $$ BEGIN RAISE NOTICE 'MURAL DE CONQUISTAS: TODOS OS TESTES PASSARAM'; END $$;
ROLLBACK;
