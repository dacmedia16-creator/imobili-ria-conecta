-- Suíte: só assina com a meta oficial calculada (migration 20261228120000, t_3d55d20c).
-- Transação revertida (homologação ou banco descartável; nunca produção). Dados fictícios.
-- Espera a variável psql :casos com o conteúdo de src/lib/meu-plano-2027/meta-calculavel.casos.json
-- (os MESMOS casos do vitest assinar-exige-meta.test.ts).
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.plano(_uid uuid, _r jsonb, _assinado boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.carreira_plano (organization_id, user_id, ano, respostas, assinado_corretor_em)
  VALUES ('a0000000-0000-4000-8000-0000000000b0', _uid, 2027, _r, CASE WHEN _assinado THEN now() - interval '2 days' END)
  ON CONFLICT (organization_id, user_id, ano) DO UPDATE SET respostas = EXCLUDED.respostas,
    assinado_corretor_em = EXCLUDED.assinado_corretor_em $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a0000000-0000-4000-8000-0000000000b0'
\set c1 'a0000000-0000-4000-8000-0000000000b1'
\set c2 'a0000000-0000-4000-8000-0000000000b2'
\set c3 'a0000000-0000-4000-8000-0000000000b3'
\set c4 'a0000000-0000-4000-8000-0000000000b4'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES (:'org_a', 'teste-exige-meta', 'Imobiliaria Exemplo Meta', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'c1', :'c2', :'c3', :'c4']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'c1', 'Ana Meta', 'b1@exemplo.test', true, :'org_a'),
  (:'c2', 'Bruno Meta', 'b2@exemplo.test', true, :'org_a'),
  (:'c3', 'Carla Meta', 'b3@exemplo.test', true, :'org_a'),
  (:'c4', 'Davi Meta', 'b4@exemplo.test', true, :'org_a');
INSERT INTO public.organization_members (organization_id, user_id, ativo)
  SELECT :'org_a', u, true FROM unnest(ARRAY[:'c1', :'c2', :'c3', :'c4']::uuid[]) u;
INSERT INTO public.user_roles (user_id, role, organization_id)
  SELECT u, 'corretor', :'org_a' FROM unnest(ARRAY[:'c1', :'c2', :'c3', :'c4']::uuid[]) u;
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (:'org_a', 'meu_plano_2027', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
SET LOCAL session_replication_role = origin;

-- 1) Função auxiliar: só uso interno ----------------------------------------------------------------------------
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.carreira_plano_falta_meta(jsonb)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.carreira_plano_falta_meta(jsonb)', 'EXECUTE'),
  'falta_meta() nao e chamavel por authenticated/anon');

-- 2) Mesma regra da tela: casos compartilhados com o vitest ----------------------------------------------------
INSERT INTO r
SELECT public.carreira_plano_falta_meta(c->'r') IS NOT DISTINCT FROM nullif(array_to_string(ARRAY(
         SELECT CASE f WHEN 'mt.tCapt' THEN 'transações de captação' ELSE 'comissão média por transação' END
           FROM jsonb_array_elements_text(c->'falta') WITH ORDINALITY x(f, i) ORDER BY i), ' e '), ''),
       'caso: ' || (c->>'nome') || ' -> ' || coalesce(public.carreira_plano_falta_meta(c->'r'), 'calculada')
  FROM jsonb_array_elements(:'casos'::jsonb) c;
SELECT pg_temp.ok(jsonb_array_length(:'casos'::jsonb) >= 20, 'casos compartilhados carregados (>= 20)');

-- 2b) Brecha da trava (Denis 23/11, item 1): sugestão e VGC pela sugestão, mesmos casos da tela (conferirPlano)
INSERT INTO r
SELECT (pg_temp.err(format('SELECT public.carreira_plano_trava(%L::jsonb)', c->'r')) IS NULL)
       AND (public.carreira_plano_trava(c->'r') IS NOT NULL) = (c->>'bloqueia')::boolean
       AND (c->>'msg' IS NULL OR public.carreira_plano_trava(c->'r') LIKE '%' || (c->>'msg') || '%'),
       'trava: ' || (c->>'nome') || ' -> ' || coalesce(public.carreira_plano_trava(c->'r'), 'passa')
  FROM jsonb_array_elements(:'trava_casos'::jsonb) c;
SELECT pg_temp.ok(jsonb_array_length(:'trava_casos'::jsonb) >= 10, 'casos da trava carregados (>= 10)');
SELECT pg_temp.ok(public.carreira_plano_falta_meta(NULL) = 'transações de captação e comissão média por transação',
  'NULL = falta tudo');

SET LOCAL ROLE authenticated;

-- 3) Sem captação e sem comissão média: recusa, com o que falta -------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.creFim":"20","pq.frase":"Familia","m.conv":"22"}') IS NOT NULL,
  'rascunho sem meta e salvo normalmente');
SELECT pg_temp.ok(pg_temp.err('SELECT public.carreira_plano_assinar(2027)')
  = '22023 Plano sem meta calculada: falta transações de captação e comissão média por transação. Complete na tela Metas antes de assinar.',
  'assinar sem meta recusa (22023) dizendo o que falta');
SELECT pg_temp.ok((SELECT assinado_corretor_em IS NULL FROM public.carreira_plano WHERE user_id = :'c1'), 'continua sem assinatura');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.carreira_plano_salvar(2027, '{"mt.tCapt":"12","mt.tVenda":"8"}')$q$) IS NULL, 'salva so a captacao');
SELECT pg_temp.ok(pg_temp.err('SELECT public.carreira_plano_assinar(2027)') LIKE '22023 Plano sem meta calculada: falta comissão média por transação.%',
  'so com captacao: falta a comissao media');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.carreira_plano_salvar(2027, '{"mt.comMedia":"15.000"}')$q$) IS NULL, 'salva a comissao media');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) IS NOT NULL, 'com a meta calculada: assina normalmente');
SELECT pg_temp.ok((SELECT assinado_corretor_em IS NOT NULL FROM public.carreira_plano WHERE user_id = :'c1'), 'ficou assinado');

-- 4) Meta pela sugestão (estilo de vida ÷ faixa ÷ ticket × %), sem digitar captação nem comissão ---------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027,
  '{"op.0":"5000","es.aliq":"15","m.faixa":"45","m.ticket":"700000","m.pct":"3"}') IS NOT NULL, 'salva so o caminho sugerido');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) IS NOT NULL, 'meta sugerida (sem digitar captacao/comissao) assina');

-- 5) Trava de valores em vermelho continua valendo (e vem antes) ------------------------------------------------
SELECT pg_temp.as_user(:'c3');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.tCapt":"42.000,00","mt.comMedia":"8100"}') IS NOT NULL,
  'rascunho com valor absurdo e salvo');
SELECT pg_temp.ok(pg_temp.err('SELECT public.carreira_plano_assinar(2027)') LIKE '22023 Plano com valor fora do limite:%',
  'valor em vermelho continua recusado');

-- 6) Quem JÁ assinou sem meta continua assinado; nada muda ----------------------------------------------------
RESET ROLE;
SELECT pg_temp.plano(:'c4'::uuid, '{"mt.creFim":"20"}', true);
CREATE TEMP TABLE antes AS SELECT md5(row(respostas, assinado_corretor_em, meta_oficial)::text) h
  FROM public.carreira_plano WHERE user_id = :'c4';
GRANT ALL ON antes TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c4');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) IS NOT NULL, 'ja assinado sem meta: assinar de novo nao da erro (nao reabre)');
SELECT pg_temp.ok((SELECT md5(row(respostas, assinado_corretor_em, meta_oficial)::text) FROM public.carreira_plano WHERE user_id = :'c4')
  = (SELECT h FROM antes), 'ja assinado sem meta: respostas, data e meta intactas');

-- 7) Sem plano nenhum: mensagem antiga ---------------------------------------------------------------------------
RESET ROLE;
DELETE FROM public.carreira_plano WHERE user_id = :'c3';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c3');
SELECT pg_temp.ok(pg_temp.err('SELECT public.carreira_plano_assinar(2027)') LIKE 'P0002 Preencha o pacto%', 'sem plano: Preencha o pacto (P0002)');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
