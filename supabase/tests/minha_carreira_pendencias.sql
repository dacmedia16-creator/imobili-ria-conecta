-- Suíte da migration 20261016100000 (Minha carreira: minhas_pendencias e minhas_captacoes). Roda DENTRO
-- de transação revertida (run-minha-carreira-pendencias.sh). Homologação: A = Agência A (…-0001),
-- B = Agência B (2a…b0). Perfis: corretor A1 (UE Corretor), corretor A2 (QA A Corretor Um),
-- corretor B (QA B Corretor Um). Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.as_user(text), pg_temp.id(text) TO authenticated;
CREATE FUNCTION pg_temp.cap(_k text, _org text, _u text, _st text, _form jsonb, _signed date, _manual bool DEFAULT false)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, gen_random_uuid());
  INSERT INTO public.exclusive_captures (id, organization_id, captor_id, created_by, template, status, form_data,
    broker_name, signed_on, manual)
  VALUES (pg_temp.id(_k), pg_temp.id(_org), pg_temp.id(_u), pg_temp.id(_u), 'campolim', _st, _form, 'Corretor Teste',
    _signed, _manual) $$;
CREATE FUNCTION pg_temp.doc(_cap text, _kind text, _owner int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.exclusive_documents (capture_id, kind, owner_index, storage_path, file_name, uploaded_by, organization_id)
  SELECT c.id, _kind, _owner, 'teste/' || gen_random_uuid() || '.pdf', _kind || '.pdf', c.captor_id, c.organization_id
    FROM public.exclusive_captures c WHERE c.id = pg_temp.id(_cap) $$;
CREATE FUNCTION pg_temp.link(_cap text, _code text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.exclusive_listing_links (organization_id, capture_id, listing_code, status, linked_by, linked_at)
  SELECT c.organization_id, c.id, _code, 'ativo', c.captor_id, now() - interval '40 days'
    FROM public.exclusive_captures c WHERE c.id = pg_temp.id(_cap) $$;
CREATE FUNCTION pg_temp.snap(_org text, _portal text, _code text, _dias_atras int, _wk text, _v int, _c int) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.portal_listing_snapshots (organization_id, portal, collected_on, listing_code, window_kind, views, contacts)
  VALUES (pg_temp.id(_org), _portal, (now() AT TIME ZONE 'America/Sao_Paulo')::date - _dias_atras, _code, _wk, _v, _c) $$;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('a2', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244');
-- Módulo de captação ligado nas duas (só dentro da transação).
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o, 'captacao_exclusiva', true FROM unnest(ARRAY[pg_temp.id('orgA'), pg_temp.id('orgB')]) o
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO ids SELECT 'act', id FROM public.owner_feedback_actions
 WHERE organization_id = pg_temp.id('orgA') AND list = 'marketing' AND active ORDER BY sort LIMIT 1;
SELECT pg_temp.ok(pg_temp.id('act') IS NOT NULL, 'pré: ação de marketing da organização A');

SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje \gset
SELECT jsonb_build_object('imovel', jsonb_build_object('tipo_imovel', 'Casa', 'bairro', 'Jardim Teste'),
  'condicoes', jsonb_build_object('prazo_dias_numero', '180')) AS base \gset

-- A1: rascunho sem documento (normal), rascunho manual, devolvida completa, aprovada antiga sem anúncio
-- com ação da semana 1 atrasada e vencendo em 10 dias, aprovada com anúncio parado, aprovada com anúncio
-- vendendo, aprovada com anúncio sem base de comparação, arquivada.
SELECT pg_temp.cap('rasc', 'orgA', 'a1', 'rascunho', :'base'::jsonb, NULL);
SELECT pg_temp.cap('manual', 'orgA', 'a1', 'rascunho', :'base'::jsonb, NULL, true);
SELECT pg_temp.cap('dev', 'orgA', 'a1', 'devolvida', :'base'::jsonb, NULL);
SELECT pg_temp.doc('dev', 'cnh', 1), pg_temp.doc('dev', 'matricula', 0), pg_temp.doc('dev', 'iptu', 0);
SELECT pg_temp.cap('velha', 'orgA', 'a1', 'aprovada', :'base'::jsonb || jsonb_build_object(
  'dossie', jsonb_build_array(pg_temp.id('act')), 'plano_semanas', jsonb_build_object(pg_temp.id('act')::text, '[1]'::jsonb)),
  :'hoje'::date - 170);
SELECT pg_temp.cap('parado', 'orgA', 'a1', 'aprovada', :'base'::jsonb, :'hoje'::date - 60);
SELECT pg_temp.cap('vende', 'orgA', 'a1', 'aprovada', :'base'::jsonb, :'hoje'::date - 60);
SELECT pg_temp.cap('semdado', 'orgA', 'a1', 'aprovada', :'base'::jsonb, :'hoje'::date - 60);
SELECT pg_temp.cap('arq', 'orgA', 'a1', 'devolvida', :'base'::jsonb, NULL);
UPDATE public.exclusive_captures SET archived_at = now() WHERE id = pg_temp.id('arq');
SELECT pg_temp.link('parado', '111111111-001'), pg_temp.link('vende', '111111111-002'), pg_temp.link('semdado', '111111111-003');
-- parado: acumulado 400 -> 420 views e 3 -> 3 contatos em 30 dias (ZAP) + last30 10 views/0 contatos (Imovelweb).
SELECT pg_temp.snap('orgA', 'zap', '111111111-001', 31, 'cumulative', 400, 3), pg_temp.snap('orgA', 'zap', '111111111-001', 1, 'cumulative', 420, 3),
       pg_temp.snap('orgA', 'imovelweb', '111111111-001', 1, 'last30', 10, 0);
-- vende: last30 com 2 contatos.
SELECT pg_temp.snap('orgA', 'zap', '111111111-002', 1, 'last30', 30, 2);
-- semdado: só um acumulado, sem coleta antiga para subtrair.
SELECT pg_temp.snap('orgA', 'zap', '111111111-003', 1, 'cumulative', 5, 0);
-- A2 (colega da mesma organização) e B (outra organização) com pendências próprias.
SELECT pg_temp.cap('colega', 'orgA', 'a2', 'devolvida', :'base'::jsonb, NULL);
SELECT pg_temp.cap('outra', 'orgB', 'b1', 'devolvida', :'base'::jsonb, NULL);
SELECT pg_temp.cap('outra_ap', 'orgB', 'b1', 'aprovada', :'base'::jsonb, :'hoje'::date - 175);

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
CREATE TEMP TABLE p1 AS SELECT * FROM public.minhas_pendencias();
CREATE TEMP TABLE m1 AS SELECT * FROM public.minhas_captacoes();
RESET ROLE;
-- 1) Pendências do próprio corretor
SELECT pg_temp.ok((SELECT detalhe LIKE '%RG e CPF ou CNH%' AND detalhe LIKE '%matrícula%' AND detalhe LIKE '%IPTU%'
  FROM p1 WHERE kind = 'documentos' AND capture_id = pg_temp.id('rasc')), 'rascunho normal: lista os documentos que faltam');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM p1 WHERE capture_id = pg_temp.id('manual')), 'cadastro manual não cobra documentos');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM p1 WHERE kind = 'devolvida' AND capture_id = pg_temp.id('dev'))
  AND NOT EXISTS (SELECT 1 FROM p1 WHERE kind = 'documentos' AND capture_id = pg_temp.id('dev')), 'devolvida com documentos completos: só "devolvida"');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM p1 WHERE kind = 'sem_anuncio' AND capture_id = pg_temp.id('velha')), 'aprovada sem anúncio aparece');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM p1 WHERE kind = 'sem_anuncio' AND capture_id = pg_temp.id('parado')), 'aprovada com anúncio não aparece como sem anúncio');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM p1 WHERE kind = 'atrasada' AND capture_id = pg_temp.id('velha') AND detalhe LIKE '%(Semana 1)'), 'ação do Plano atrasada aparece');
SELECT pg_temp.ok((SELECT dias FROM p1 WHERE kind = 'vencendo' AND capture_id = pg_temp.id('velha')) = 10, 'exclusividade vencendo em 10 dias');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM p1 WHERE kind = 'vencendo' AND capture_id = pg_temp.id('parado')), 'exclusividade longe do fim não aparece');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM p1 WHERE capture_id = pg_temp.id('arq')), 'arquivada não aparece');
-- 2) Isolamento: nada do colega nem da outra organização
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM p1 WHERE capture_id IN (pg_temp.id('colega'), pg_temp.id('outra'), pg_temp.id('outra_ap'))), 'pendências: nada do colega A2 nem da organização B');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM m1 WHERE capture_id IN (pg_temp.id('colega'), pg_temp.id('outra'), pg_temp.id('outra_ap'))), 'captações: nada do colega A2 nem da organização B');
-- 3) Minhas captações e regra de "parado"
SELECT pg_temp.ok((SELECT count(*) FROM m1) = 7, 'captações: 7 do próprio corretor (sem a arquivada)');
SELECT pg_temp.ok((SELECT views = 30 AND contacts = 0 AND parado FROM m1 WHERE capture_id = pg_temp.id('parado')), 'parado: 20 (acumulado) + 10 (last30) views, 0 contato');
SELECT pg_temp.ok((SELECT contacts = 2 AND NOT parado FROM m1 WHERE capture_id = pg_temp.id('vende')), 'com contato não é parado');
SELECT pg_temp.ok((SELECT parado IS NULL AND views IS NULL FROM m1 WHERE capture_id = pg_temp.id('semdado')), 'sem base de comparação: sem dado, não inventa');
SELECT pg_temp.ok((SELECT dias_restantes = 120 FROM m1 WHERE capture_id = pg_temp.id('parado')), 'vencimento calculado');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((SELECT NOT parado FROM public.minhas_captacoes(30, 20) WHERE capture_id = pg_temp.id('parado')), 'limite de views configurável (20)');
-- 4) Do lado do colega e da outra organização: só o que é dele
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
SELECT pg_temp.ok((SELECT array_agg(DISTINCT capture_id) FROM public.minhas_pendencias()) = ARRAY[pg_temp.id('colega')], 'colega A2 vê só a própria pendência');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.minhas_captacoes() WHERE capture_id NOT IN (pg_temp.id('outra'), pg_temp.id('outra_ap'))) = 0
  AND (SELECT count(*) FROM public.minhas_captacoes()) = 2, 'organização B vê só as 2 próprias');
-- 5) Sem login e anon
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.minhas_pendencias()') LIKE '42501%', 'sem login: recusa');
RESET ROLE;
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.minhas_pendencias()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.minhas_captacoes(integer,integer)', 'EXECUTE'), 'anon não executa');
-- 6) Módulo de captação desligado: nada
UPDATE public.organization_modules SET enabled = false WHERE organization_id = pg_temp.id('orgA') AND module = 'captacao_exclusiva';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.minhas_pendencias()) AND NOT EXISTS (SELECT 1 FROM public.minhas_captacoes()), 'módulo desligado: nada');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
