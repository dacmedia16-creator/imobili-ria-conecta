-- Suíte local do módulo Oportunidades (20261014120000). Dados sintéticos, tudo em transação com ROLLBACK.
-- Rodar SOMENTE em banco local descartável (estrutura de produção restaurada sem dados):
--   psql -v ON_ERROR_STOP=1 -1 < supabase/tests/oportunidades_isolamento.sql
-- Saída esperada: uma linha "ok N - ..." por teste e "OPORTUNIDADES: TODOS OS TESTES PASSARAM".
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT SELECT ON t_ids TO authenticated, service_role;
INSERT INTO t_ids VALUES
  ('orgA', gen_random_uuid()), ('orgB', gen_random_uuid()),
  ('uA', gen_random_uuid()), ('uB', gen_random_uuid()), ('uSA', gen_random_uuid()),
  ('capOk', gen_random_uuid()), ('capPend', gen_random_uuid()), ('capArq', gen_random_uuid()), ('capB', gen_random_uuid());

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
GRANT EXECUTE ON FUNCTION pg_temp.id(text), pg_temp.ok(int, boolean, text), pg_temp.as_user(text) TO authenticated, service_role;

-- Fixture: duas imobiliárias, um corretor em cada, um super-admin, captações em vários estados.
INSERT INTO public.organizations (id, slug, nome) VALUES
  (pg_temp.id('orgA'), 'opp-teste-a', 'Opp Teste A'), (pg_temp.id('orgB'), 'opp-teste-b', 'Opp Teste B');
INSERT INTO auth.users (id, email) SELECT pg_temp.id(k), k || '@opp.teste.local' FROM unnest(ARRAY['uA', 'uB', 'uSA']) k;
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (pg_temp.id('uA'), 'Ana Teste', 'uA@opp.teste.local', true, pg_temp.id('orgA')),
  (pg_temp.id('uB'), 'Bruno Teste', 'uB@opp.teste.local', true, pg_temp.id('orgB')),
  (pg_temp.id('uSA'), 'Super Teste', 'uSA@opp.teste.local', true, pg_temp.id('orgA'))
ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, ativo = true, nome = EXCLUDED.nome;
INSERT INTO public.organization_members (organization_id, user_id) VALUES
  (pg_temp.id('orgA'), pg_temp.id('uA')), (pg_temp.id('orgB'), pg_temp.id('uB')), (pg_temp.id('orgA'), pg_temp.id('uSA'))
ON CONFLICT DO NOTHING;
INSERT INTO public.platform_admins (user_id) VALUES (pg_temp.id('uSA'));
-- Organizações novas não ganham a linha do módulo pelo seed da migration: cria desligado (padrão).
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o, 'oportunidades', false FROM unnest(ARRAY[pg_temp.id('orgA'), pg_temp.id('orgB')]) o
ON CONFLICT (organization_id, module) DO NOTHING;

INSERT INTO public.exclusive_captures (id, organization_id, captor_id, created_by, template, status, form_data, broker_name, archived_at, discarded_at)
SELECT pg_temp.id(x.k), pg_temp.id(x.org), pg_temp.id(x.u), pg_temp.id(x.u), 'campolim', x.st,
       jsonb_build_object('imovel', jsonb_build_object('tipo_imovel', 'Casa', 'bairro', 'Vila Hortência',
         'municipio', 'Sorocaba', 'valor_imovel', '415.000,00', 'endereco', 'Rua Secreta, 1')),
       'Ana Teste', x.arq, NULL
FROM (VALUES ('capOk', 'orgA', 'uA', 'aprovada', NULL::timestamptz),
             ('capPend', 'orgA', 'uA', 'enviada', NULL),
             ('capArq', 'orgA', 'uA', 'aprovada', now()),
             ('capB', 'orgB', 'uB', 'aprovada', NULL)) x(k, org, u, st, arq);

CREATE TEMP TABLE t_lote ON COMMIT DROP AS SELECT jsonb_build_array(
  jsonb_build_object('source_key', repeat('a', 64), 'kind', 'procura', 'tipo', 'Casa', 'finalidade', 'Venda',
    'bairro', 'Vila Hortência', 'valor_max', 400000, 'corretor', 'Elaine 15 99123',
    'texto', 'Procuro casa até 400 mil, falar 15 99123-4567 ou elaine@x.com https://x.com/a senha: abc123',
    'posted_at', now()),
  jsonb_build_object('source_key', repeat('b', 64), 'kind', 'oferta', 'tipo', 'Apartamento', 'finalidade', 'Venda',
    'bairro', 'Campolim', 'valor', 500000, 'corretor', 'Luciano', 'texto', 'Apto no Campolim, R$ 500 mil.',
    'posted_at', now() - interval '2 days')) AS j;
GRANT SELECT ON t_lote TO service_role;

-- 1-3: módulo começa desligado; ingestão não grava nada.
SELECT pg_temp.ok(1, (SELECT enabled = false FROM public.organization_modules WHERE organization_id = pg_temp.id('orgA') AND module = 'oportunidades'), 'módulo nasce desligado');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(2, public.opportunity_ingest(pg_temp.id('orgA'), (SELECT j FROM t_lote)) = 0, 'ingestão com módulo desligado retorna 0');
RESET ROLE;
SELECT pg_temp.ok(3, (SELECT count(*) = 0 FROM public.opportunity_posts WHERE organization_id = pg_temp.id('orgA')), 'nada gravado com módulo desligado');

-- 4-5: só super-admin liga módulo.
SELECT pg_temp.as_user('uA');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.platform_set_organization_module(pg_temp.id('orgA'), 'oportunidades', true);
  RAISE EXCEPTION 'FALHOU 4 - corretor conseguiu ligar o módulo';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 4 - corretor não liga módulo';
END $$;
RESET ROLE;
SELECT pg_temp.as_user('uSA');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(5, public.platform_set_organization_module(pg_temp.id('orgA'), 'oportunidades', true), 'super-admin liga o módulo na A');
RESET ROLE;
SELECT pg_temp.ok(6, (SELECT count(*) = 1 FROM public.organization_module_history WHERE organization_id = pg_temp.id('orgA') AND module = 'oportunidades' AND enabled), 'troca registrada no histórico');

-- 7-9: ingestão (service_role) grava, limpa dados pessoais e não duplica.
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(7, public.opportunity_ingest(pg_temp.id('orgA'), (SELECT j FROM t_lote)) = 2, 'ingestão grava 2 posts');
SELECT pg_temp.ok(8, public.opportunity_ingest(pg_temp.id('orgA'), (SELECT j FROM t_lote)) = 2
  AND (SELECT count(*) = 2 FROM public.opportunity_posts WHERE organization_id = pg_temp.id('orgA')), 'repostagem não duplica');
RESET ROLE;
SELECT pg_temp.ok(9, (SELECT texto !~ '\d{4}-?\d{4}' AND texto !~ '@' AND texto !~* 'https?://' AND texto !~* 'abc123'
  AND corretor !~ '\d' FROM public.opportunity_posts WHERE source_key = repeat('a', 64)), 'telefone, e-mail, link, senha e dígitos do nome removidos');

-- 10: authenticated não chama a ingestão.
SELECT pg_temp.as_user('uA');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.opportunity_ingest(pg_temp.id('orgA'), '[]'::jsonb);
  RAISE EXCEPTION 'FALHOU 10 - authenticated chamou a ingestão';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 10 - authenticated não chama a ingestão';
END $$;

-- 11-13: corretor da A lê o mural e só as captações aprovadas, ativas, da própria imobiliária, sem endereço.
SELECT pg_temp.ok(11, (SELECT count(*) = 2 FROM public.opportunity_posts), 'corretor da A vê os 2 posts da A');
SELECT pg_temp.ok(12, (SELECT array_agg(id) = ARRAY[pg_temp.id('capOk')] FROM public.opportunity_capture_candidates()), 'candidatas = só aprovada, não arquivada, da A');
SELECT pg_temp.ok(13, (SELECT NOT (proargnames && ARRAY['endereco', 'proprietario', 'form_data', 'telefone'])
  FROM pg_proc WHERE oid = 'public.opportunity_capture_candidates()'::regprocedure)
  AND (SELECT bairro = 'Vila Hortência' FROM public.opportunity_capture_candidates()), 'candidatas sem endereço/proprietário, só campos do encaixe');

-- 14-15: "não encaixa" grava só como o próprio usuário.
INSERT INTO public.opportunity_hidden_pairs (organization_id, post_id, target_id, hidden_by)
SELECT pg_temp.id('orgA'), id, pg_temp.id('capOk'), pg_temp.id('uA') FROM public.opportunity_posts WHERE source_key = repeat('a', 64);
SELECT pg_temp.ok(14, (SELECT count(*) = 1 FROM public.opportunity_hidden_pairs), 'corretor marca "não encaixa"');
DO $$ BEGIN
  INSERT INTO public.opportunity_hidden_pairs (organization_id, post_id, target_id, hidden_by)
  SELECT pg_temp.id('orgA'), id, gen_random_uuid(), pg_temp.id('uB') FROM public.opportunity_posts WHERE source_key = repeat('b', 64);
  RAISE EXCEPTION 'FALHOU 15 - gravou em nome de outro usuário';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 15 - não grava em nome de outro usuário';
END $$;
-- 16: corretor não altera nem apaga posts e não lê alertas.
DO $$ BEGIN
  UPDATE public.opportunity_posts SET texto = 'x';
  RAISE EXCEPTION 'FALHOU 16 - corretor alterou post';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 16 - corretor não altera post';
END $$;
DO $$ BEGIN
  PERFORM 1 FROM public.opportunity_alerts;
  RAISE EXCEPTION 'FALHOU 17 - corretor leu alertas';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 17 - corretor não lê alertas';
END $$;
RESET ROLE;

-- 18-19: imobiliária B (módulo desligado) não vê nada da A, nem captações.
SELECT pg_temp.as_user('uB');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(18, (SELECT count(*) = 0 FROM public.opportunity_posts) AND (SELECT count(*) = 0 FROM public.opportunity_hidden_pairs), 'B não vê mural da A');
SELECT pg_temp.ok(19, (SELECT count(*) = 0 FROM public.opportunity_capture_candidates()), 'B (desligada) não recebe candidatas');
SELECT pg_temp.ok(20, public.opportunities_enabled() = false, 'opportunities_enabled() falso na B');
RESET ROLE;

-- 21: mesmo com módulo ligado na B, ela não vê a A.
SELECT pg_temp.as_user('uSA');
SET LOCAL ROLE authenticated;
SELECT public.platform_set_organization_module(pg_temp.id('orgB'), 'oportunidades', true);
RESET ROLE;
SELECT pg_temp.as_user('uB');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(21, (SELECT count(*) = 0 FROM public.opportunity_posts)
  AND (SELECT array_agg(id) = ARRAY[pg_temp.id('capB')] FROM public.opportunity_capture_candidates()), 'B ligada vê só o que é dela');
RESET ROLE;

-- 22: desligar a A some com o mural para o corretor da A.
SELECT pg_temp.as_user('uSA');
SET LOCAL ROLE authenticated;
SELECT public.platform_set_organization_module(pg_temp.id('orgA'), 'oportunidades', false);
RESET ROLE;
SELECT pg_temp.as_user('uA');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(22, (SELECT count(*) = 0 FROM public.opportunity_posts), 'A desligada: mural vazio no banco');
RESET ROLE;

-- 23: anon não lê nada.
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM public.opportunity_posts;
  RAISE EXCEPTION 'FALHOU 23 - anon leu posts';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok 23 - anon não lê posts';
END $$;
RESET ROLE;

-- 24: limpeza de senha não estraga palavras comuns ("passa", "ultrapassa", "compass").
SELECT pg_temp.ok(24,
  public.opportunity_clean_text('Imóvel passa por reforma, ultrapassa expectativas, compass, senha: abc123')
    = 'Imóvel passa por reforma, ultrapassa expectativas, compass, [senha oculta]'
  AND public.opportunity_clean_text('pass=xyz e PWD : 9988 e token:abc') = '[senha oculta] e [senha oculta] e [senha oculta]'
  AND public.opportunity_clean_text('senha abc (sem separador fica)') = 'senha abc (sem separador fica)',
  'limpeza de senha com limite de palavra e separador obrigatório');

DO $$ BEGIN RAISE NOTICE 'OPORTUNIDADES: TODOS OS TESTES PASSARAM'; END $$;
ROLLBACK;
