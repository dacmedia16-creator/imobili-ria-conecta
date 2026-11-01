-- Suíte local de 20261101120000_oportunidades_encaixe_envolvidos (t_6dd4a31b). Dados sintéticos, ROLLBACK no fim.
-- Rodar SOMENTE em banco local descartável (estrutura de produção restaurada sem dados), depois da migration:
--   psql -v ON_ERROR_STOP=1 -1 < supabase/tests/oportunidades_encaixe_envolvidos.sql
-- Cobre: corretor envolvido vê, corretor de fora não vê, staff/team leader/coordenador veem tudo, outra imobiliária não vê,
-- ligação do autor pelo telefone (sem gravar o número) e captações candidatas por papel.
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT SELECT ON t_ids TO authenticated, service_role;
INSERT INTO t_ids SELECT k, gen_random_uuid() FROM unnest(ARRAY[
  'orgA', 'orgB', 'uAna', 'uBruno', 'uCaio', 'uDavi', 'uGestor', 'uStaff', 'uB', 'uSA', 'uDup1', 'uDup2',
  'uTL', 'uCoord', 'capCaio', 'capB']) k;

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
CREATE FUNCTION pg_temp.post(_sk text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.opportunity_posts WHERE source_key = repeat(_sk, 64) $$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text), pg_temp.ok(int, boolean, text), pg_temp.as_user(text), pg_temp.post(text)
  TO authenticated, service_role;

-- Fixture: imobiliária A (Ana procura, Bruno oferece, Caio capta, Davi de fora, gestor, staff,
-- dois com o mesmo celular) e imobiliária B (um corretor). Celulares fictícios.
INSERT INTO public.organizations (id, slug, nome) VALUES
  (pg_temp.id('orgA'), 'opp-env-a', 'Opp Env A'), (pg_temp.id('orgB'), 'opp-env-b', 'Opp Env B');
INSERT INTO auth.users (id, email)
SELECT pg_temp.id(k), k || '@opp-env.teste.local'
FROM unnest(ARRAY['uAna', 'uBruno', 'uCaio', 'uDavi', 'uGestor', 'uStaff', 'uB', 'uSA', 'uDup1', 'uDup2', 'uTL', 'uCoord']) k;
INSERT INTO public.profiles (id, nome, email, ativo, organization_id, telefone)
SELECT pg_temp.id(x.k), x.nome, x.k || '@opp-env.teste.local', true, pg_temp.id(x.org), x.tel
FROM (VALUES ('uAna', 'Ana Teste', 'orgA', '(15) 99000-0001'),
             ('uBruno', 'Bruno Teste', 'orgA', '15 9 9000-0002'),
             ('uCaio', 'Caio Teste', 'orgA', '15990000003'),
             ('uDavi', 'Davi Teste', 'orgA', '15990000004'),
             ('uGestor', 'Gestor Teste', 'orgA', NULL),
             ('uStaff', 'Staff Teste', 'orgA', NULL),
             ('uSA', 'Super Teste', 'orgA', NULL),
             ('uDup1', 'Dup Um', 'orgA', '15990000009'),
             ('uDup2', 'Dup Dois', 'orgA', '(15) 99000-0009'),
             ('uTL', 'TL Teste', 'orgA', NULL),
             ('uCoord', 'Coord Teste', 'orgA', NULL),
             ('uB', 'Corretor B', 'orgB', '15990000001')) x(k, nome, org, tel)
ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, ativo = true, nome = EXCLUDED.nome,
  telefone = EXCLUDED.telefone;
INSERT INTO public.organization_members (organization_id, user_id)
SELECT pg_temp.id(CASE WHEN k = 'uB' THEN 'orgB' ELSE 'orgA' END), pg_temp.id(k)
FROM unnest(ARRAY['uAna', 'uBruno', 'uCaio', 'uDavi', 'uGestor', 'uStaff', 'uB', 'uSA', 'uDup1', 'uDup2', 'uTL', 'uCoord']) k
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role, organization_id)
SELECT pg_temp.id(x.k), x.r::public.app_role, pg_temp.id(x.org)
FROM (VALUES ('uAna', 'corretor', 'orgA'), ('uBruno', 'corretor', 'orgA'), ('uCaio', 'corretor', 'orgA'),
             ('uDavi', 'corretor', 'orgA'), ('uGestor', 'gestor', 'orgA'), ('uStaff', 'staff', 'orgA'),
             ('uTL', 'team_leader', 'orgA'), ('uCoord', 'coordenador', 'orgA'),
             ('uB', 'corretor', 'orgB')) x(k, r, org)
ON CONFLICT DO NOTHING;
INSERT INTO public.platform_admins (user_id) VALUES (pg_temp.id('uSA'));
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o, 'oportunidades', true FROM unnest(ARRAY[pg_temp.id('orgA'), pg_temp.id('orgB')]) o
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;

INSERT INTO public.exclusive_captures (id, organization_id, captor_id, created_by, template, status, form_data, broker_name)
SELECT pg_temp.id(x.k), pg_temp.id(x.org), pg_temp.id(x.u), pg_temp.id(x.u), 'campolim', 'aprovada',
       jsonb_build_object('imovel', jsonb_build_object('tipo_imovel', 'Apartamento', 'bairro', 'Campolim',
         'municipio', 'Sorocaba', 'valor_imovel', '520.000,00', 'endereco', 'Rua Secreta, 1')), x.nome
FROM (VALUES ('capCaio', 'orgA', 'uCaio', 'Caio Teste'), ('capB', 'orgB', 'uB', 'Corretor B')) x(k, org, u, nome);

-- Lote do WhatsApp: telefone só no campo autor_telefone (formatos variados, como chega do leitor).
CREATE TEMP TABLE t_lote ON COMMIT DROP AS SELECT jsonb_build_array(
  jsonb_build_object('source_key', repeat('a', 64), 'kind', 'procura', 'tipo', 'Apartamento', 'finalidade', 'Venda',
    'bairro', 'Campolim', 'valor_max', 600000, 'corretor', 'Ana', 'texto', 'Procuro apto no Campolim até 600 mil',
    'posted_at', now(), 'autor_telefone', '5515990000001'),
  jsonb_build_object('source_key', repeat('b', 64), 'kind', 'oferta', 'tipo', 'Apartamento', 'finalidade', 'Venda',
    'bairro', 'Campolim', 'valor', 550000, 'corretor', 'Bruno', 'texto', 'Apto no Campolim R$ 550 mil',
    'posted_at', now(), 'autor_telefone', '551590000002'),           -- formato antigo, sem o 9
  jsonb_build_object('source_key', repeat('c', 64), 'kind', 'oferta', 'tipo', 'Apartamento', 'finalidade', 'Venda',
    'bairro', 'Campolim', 'valor', 560000, 'corretor', 'Sem Cadastro', 'texto', 'Apto Campolim 560 mil',
    'posted_at', now(), 'autor_telefone', '5511988887777'),          -- ninguém com esse celular
  jsonb_build_object('source_key', repeat('d', 64), 'kind', 'oferta', 'tipo', 'Apartamento', 'finalidade', 'Venda',
    'bairro', 'Campolim', 'valor', 570000, 'corretor', 'Duplicado', 'texto', 'Apto Campolim 570 mil',
    'posted_at', now(), 'autor_telefone', '5515990000009'),          -- 2 cadastros com o mesmo celular
  jsonb_build_object('source_key', repeat('e', 64), 'kind', 'oferta', 'tipo', 'Apartamento', 'finalidade', 'Venda',
    'bairro', 'Campolim', 'valor', 580000, 'corretor', 'Sem Telefone', 'texto', 'Apto Campolim 580 mil',
    'posted_at', now())) AS j;
GRANT SELECT ON t_lote TO service_role;

-- 1-5: ingestão liga o autor pelo celular, só com 1 cadastro ativo da MESMA imobiliária; não grava telefone.
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(1, public.opportunity_ingest(pg_temp.id('orgA'), (SELECT j FROM t_lote)) = 5, 'ingestão grava 5 posts');
RESET ROLE;
SELECT pg_temp.ok(2, (SELECT author_profile_id = pg_temp.id('uAna') FROM public.opportunity_posts WHERE id = pg_temp.post('a'))
  AND (SELECT author_profile_id = pg_temp.id('uBruno') FROM public.opportunity_posts WHERE id = pg_temp.post('b')),
  'autor ligado pelo celular (com e sem o 9, com 55)');
SELECT pg_temp.ok(3, (SELECT count(*) = 3 FROM public.opportunity_posts
  WHERE id IN (pg_temp.post('c'), pg_temp.post('d'), pg_temp.post('e')) AND author_profile_id IS NULL),
  'sem cadastro, celular duplicado ou sem telefone = sem autor');
SELECT pg_temp.ok(4, NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'opportunity_posts' AND column_name ~ 'telefone|phone')
  AND NOT EXISTS (SELECT 1 FROM public.opportunity_posts WHERE organization_id = pg_temp.id('orgA')
    AND (texto ~ '9900|8888' OR corretor ~ '\d')), 'telefone não é gravado no post');
-- O corretor da B tem o mesmo celular da Ana: na ingestão da A ele não é escolhido (testado em 2).
-- Repostagem sem telefone não apaga o autor já ligado.
SET LOCAL ROLE service_role;
SELECT public.opportunity_ingest(pg_temp.id('orgA'), jsonb_build_array((SELECT j->0 FROM t_lote) - 'autor_telefone'));
RESET ROLE;
SELECT pg_temp.ok(5, (SELECT author_profile_id = pg_temp.id('uAna') FROM public.opportunity_posts WHERE id = pg_temp.post('a')),
  'repostagem sem telefone mantém o autor');

-- 6-8: quem é staff / visualizador.
SELECT pg_temp.as_user('uAna');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(6, (SELECT org_id = pg_temp.id('orgA') AND NOT is_staff FROM public.opportunity_viewer()), 'corretor: viewer da A, não staff');
RESET ROLE;
SELECT pg_temp.as_user('uGestor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(7, (SELECT is_staff FROM public.opportunity_viewer()), 'gestor é staff');
RESET ROLE;
SELECT pg_temp.as_user('uStaff');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(8, (SELECT is_staff FROM public.opportunity_viewer()), 'papel staff é staff');
RESET ROLE;
SELECT pg_temp.as_user('uTL');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(30, (SELECT is_staff FROM public.opportunity_viewer()), 'team leader vê tudo (t_1805d507)');
SELECT pg_temp.ok(31, (SELECT array_agg(id) = ARRAY[pg_temp.id('capCaio')] FROM public.opportunity_capture_candidates()),
  'team leader recebe todas as captações da A');
RESET ROLE;
SELECT pg_temp.as_user('uCoord');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(32, (SELECT is_staff FROM public.opportunity_viewer()), 'coordenador vê tudo (t_1805d507)');
SELECT pg_temp.ok(33, (SELECT array_agg(id) = ARRAY[pg_temp.id('capCaio')] FROM public.opportunity_capture_candidates()),
  'coordenador recebe todas as captações da A');
RESET ROLE;

-- 9-11: captações candidatas — corretor só as próprias; staff todas da imobiliária.
SELECT pg_temp.as_user('uDavi');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(9, (SELECT count(*) = 0 FROM public.opportunity_capture_candidates()), 'corretor de fora não recebe captação dos outros');
RESET ROLE;
SELECT pg_temp.as_user('uCaio');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(10, (SELECT array_agg(id) = ARRAY[pg_temp.id('capCaio')] FROM public.opportunity_capture_candidates()), 'captador recebe a própria (Minha Carreira)');
RESET ROLE;
SELECT pg_temp.as_user('uGestor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(11, (SELECT array_agg(id) = ARRAY[pg_temp.id('capCaio')] FROM public.opportunity_capture_candidates()), 'staff recebe todas da A (e nada da B)');
RESET ROLE;

-- 12-17: "não encaixa" — só quem está no par marca e lê.
SELECT pg_temp.as_user('uDavi');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  INSERT INTO public.opportunity_hidden_pairs (organization_id, post_id, target_id, hidden_by)
  VALUES (pg_temp.id('orgA'), pg_temp.post('a'), pg_temp.post('b'), pg_temp.id('uDavi'));
  RAISE EXCEPTION 'FALHOU 12 - corretor de fora marcou não encaixa';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 12 - corretor de fora não marca não encaixa';
END $$;
DO $$ BEGIN
  INSERT INTO public.opportunity_hidden_pairs (organization_id, post_id, target_id, hidden_by)
  VALUES (pg_temp.id('orgA'), pg_temp.post('a'), pg_temp.post('c'), pg_temp.id('uDavi'));
  RAISE EXCEPTION 'FALHOU 13 - corretor marcou par com post sem autor';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 13 - post sem autor não dá acesso a corretor';
END $$;
RESET ROLE;
SELECT pg_temp.as_user('uBruno');
SET LOCAL ROLE authenticated;
INSERT INTO public.opportunity_hidden_pairs (organization_id, post_id, target_id, hidden_by)
VALUES (pg_temp.id('orgA'), pg_temp.post('a'), pg_temp.post('b'), pg_temp.id('uBruno'));
SELECT pg_temp.ok(14, (SELECT count(*) = 1 FROM public.opportunity_hidden_pairs), 'autor da oferta marca e lê o próprio par');
RESET ROLE;
SELECT pg_temp.as_user('uCaio');
SET LOCAL ROLE authenticated;
INSERT INTO public.opportunity_hidden_pairs (organization_id, post_id, target_id, hidden_by)
VALUES (pg_temp.id('orgA'), pg_temp.post('a'), pg_temp.id('capCaio'), pg_temp.id('uCaio'));
SELECT pg_temp.ok(15, (SELECT array_agg(target_id) = ARRAY[pg_temp.id('capCaio')] FROM public.opportunity_hidden_pairs),
  'captador marca a própria captação e não lê o par Ana × Bruno');
RESET ROLE;
SELECT pg_temp.as_user('uDavi');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(16, (SELECT count(*) = 0 FROM public.opportunity_hidden_pairs), 'corretor de fora não lê pares ocultos');
SELECT pg_temp.ok(17, (SELECT count(*) = 5 FROM public.opportunity_posts), 'cartões continuam visíveis para todos');
RESET ROLE;
SELECT pg_temp.as_user('uAna');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(18, (SELECT count(*) = 2 FROM public.opportunity_hidden_pairs), 'autora da procura lê os dois pares dela');
RESET ROLE;
SELECT pg_temp.as_user('uGestor');
SET LOCAL ROLE authenticated;
INSERT INTO public.opportunity_hidden_pairs (organization_id, post_id, target_id, hidden_by)
VALUES (pg_temp.id('orgA'), pg_temp.post('a'), pg_temp.post('c'), pg_temp.id('uGestor'));
SELECT pg_temp.ok(19, (SELECT count(*) = 3 FROM public.opportunity_hidden_pairs), 'staff marca qualquer par e lê todos');
RESET ROLE;

-- 20-22: outra imobiliária não vê nada da A.
SELECT pg_temp.as_user('uB');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(20, (SELECT count(*) = 0 FROM public.opportunity_posts) AND (SELECT count(*) = 0 FROM public.opportunity_hidden_pairs),
  'B não vê posts nem pares da A');
SELECT pg_temp.ok(21, (SELECT array_agg(id) = ARRAY[pg_temp.id('capB')] FROM public.opportunity_capture_candidates())
  AND (SELECT org_id = pg_temp.id('orgB') FROM public.opportunity_viewer()), 'B só recebe a própria captação e o próprio contexto');
DO $$ BEGIN
  INSERT INTO public.opportunity_hidden_pairs (organization_id, post_id, target_id, hidden_by)
  VALUES (pg_temp.id('orgA'), pg_temp.post('a'), pg_temp.id('capB'), pg_temp.id('uB'));
  RAISE EXCEPTION 'FALHOU 22 - B gravou par na A';
EXCEPTION WHEN insufficient_privilege OR not_null_violation THEN RAISE NOTICE 'ok 22 - B não grava par na A';
END $$;
RESET ROLE;

-- 23-24: módulo desligado na A: viewer vazio; anon e corretor não chamam as funções internas.
SELECT pg_temp.as_user('uSA');
SET LOCAL ROLE authenticated;
SELECT public.platform_set_organization_module(pg_temp.id('orgA'), 'oportunidades', false);
RESET ROLE;
SELECT pg_temp.as_user('uGestor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(23, (SELECT count(*) = 0 FROM public.opportunity_viewer()) AND (SELECT count(*) = 0 FROM public.opportunity_capture_candidates()),
  'A desligada: sem viewer e sem candidatas, mesmo para staff');
DO $$ BEGIN
  PERFORM public.opportunity_phone_key('15990000001');
  RAISE EXCEPTION 'FALHOU 24 - authenticated chamou opportunity_phone_key';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 24 - authenticated não chama opportunity_phone_key';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM public.opportunity_viewer();
  RAISE EXCEPTION 'FALHOU 25 - anon chamou opportunity_viewer';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 25 - anon não chama opportunity_viewer';
END $$;
RESET ROLE;

-- 27: a tela não lê o autor do post (só o servidor).
SELECT pg_temp.as_user('uAna');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM author_profile_id FROM public.opportunity_posts;
  RAISE EXCEPTION 'FALHOU 27 - corretor leu author_profile_id';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 27 - corretor não lê author_profile_id';
END $$;
RESET ROLE;

-- 28-29: vínculo é recalculado (celular trocado / repetido depois) e não gruda no errado.
UPDATE public.organization_modules SET enabled = true WHERE organization_id = pg_temp.id('orgA') AND module = 'oportunidades';
UPDATE public.profiles SET telefone = '15990000001' WHERE id = pg_temp.id('uDavi'); -- Davi copia o celular da Ana
SET LOCAL ROLE service_role;
SELECT public.opportunity_ingest(pg_temp.id('orgA'), jsonb_build_array((SELECT j->0 FROM t_lote)));
RESET ROLE;
SELECT pg_temp.ok(28, (SELECT author_profile_id IS NULL FROM public.opportunity_posts WHERE id = pg_temp.post('a')),
  'celular repetido desfaz o vínculo (ninguém ganha o post)');
UPDATE public.profiles SET telefone = '15990000004' WHERE id = pg_temp.id('uDavi');
SET LOCAL ROLE service_role;
SELECT public.opportunity_ingest(pg_temp.id('orgA'), jsonb_build_array((SELECT j->0 FROM t_lote)));
RESET ROLE;
SELECT pg_temp.ok(29, (SELECT author_profile_id = pg_temp.id('uAna') FROM public.opportunity_posts WHERE id = pg_temp.post('a')),
  'celular de volta ao normal religa a autora');

-- 26: chave de celular.
SELECT pg_temp.ok(26, public.opportunity_phone_key('+55 (15) 99123-4567') = '1591234567'
  AND public.opportunity_phone_key('551591234567') = '1591234567'
  AND public.opportunity_phone_key('15 3222-1111') = '1532221111'
  AND public.opportunity_phone_key('123') IS NULL AND public.opportunity_phone_key(NULL) IS NULL,
  'chave do celular: com/sem 55, com/sem 9; curto = sem chave');

DO $$ BEGIN RAISE NOTICE 'OPORTUNIDADES ENCAIXE ENVOLVIDOS: TODOS OS TESTES PASSARAM'; END $$;
ROLLBACK;
