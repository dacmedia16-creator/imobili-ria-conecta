-- Testes SQL da migration 20261016200000_remax_xml_feed (t_698be0d2). Roda em BEGIN/ROLLBACK.
-- Dados 100% sintéticos. Saída: linhas PASS/FAIL.
-- Uso (container local com o schema de produção, NUNCA produção): copie a migration sem BEGIN/COMMIT para /tmp/mig_body.sql
-- e rode: psql -U supabase_admin -f supabase/tests/remax_xml_feed.sql. Resultado esperado: TOTAL 38/38.
-- Fallback coberto: XML vazio, < 50% da última coleta boa e falha de download mantêm a última versão boa (dados_antigos_mantidos).
\set ON_ERROR_STOP 1
BEGIN;
-- padrão Supabase: tabelas/funções novas no public ganham grant para anon/authenticated (assim o REVOKE é testado de verdade)
SET LOCAL ROLE postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
\i /tmp/mig_body.sql
RESET ROLE;

SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE u(k text PRIMARY KEY, id uuid, org text, role text, ativo boolean, remax text, email text, tel text);
INSERT INTO u VALUES
 ('a_admin', gen_random_uuid(), 'A', 'admin', true, NULL, 'aadmin@t.test', NULL),
 ('a_c1',    gen_random_uuid(), 'A', 'corretor', true, '111111111', 'c1@t.test', '15990000001'),
 ('a_c2',    gen_random_uuid(), 'A', 'corretor', true, '222222222', 'c2@t.test', NULL),
 ('a_c3',    gen_random_uuid(), 'A', 'corretor', true, NULL, 'c3@remax.test', NULL),          -- liga por e-mail (444)
 ('a_c4',    gen_random_uuid(), 'A', 'corretor', true, NULL, 'c4@t.test', '(15) 99000-0004'), -- liga por telefone (555)
 ('a_d1',    gen_random_uuid(), 'A', 'corretor', true, NULL, 'dup@remax.test', NULL),         -- conflito (666)
 ('a_d2',    gen_random_uuid(), 'A', 'corretor', true, NULL, 'DUP@remax.test', NULL),
 ('a_lead',  gen_random_uuid(), 'A', 'gestor', true, NULL, 'lead@t.test', NULL),
 ('a_inat',  gen_random_uuid(), 'A', 'corretor', false, '888888888', 'inat@t.test', NULL),
 ('b_admin', gen_random_uuid(), 'B', 'admin', true, NULL, 'badmin@t.test', NULL),
 ('b_c1',    gen_random_uuid(), 'B', 'corretor', true, '999999999', 'b1@t.test', NULL),
 ('b_mail',  gen_random_uuid(), 'B', 'corretor', true, NULL, 'c3@remax.test', NULL);           -- mesmo e-mail do 444, mas org B
CREATE TEMP TABLE o(k text PRIMARY KEY, id uuid);
INSERT INTO o VALUES ('A', gen_random_uuid()), ('B', gen_random_uuid());
INSERT INTO public.organizations (id, slug, nome, status) SELECT id, 't698-' || lower(k), 'Teste ' || k, 'ativa' FROM o;
INSERT INTO auth.users (id, email) SELECT id, k || '@auth.t698.test' FROM u;
INSERT INTO public.profiles (id, nome, email, telefone, ativo, organization_id, remax_id)
  SELECT u.id, u.k, u.email, u.tel, u.ativo, o.id, u.remax FROM u JOIN o ON o.k = u.org;
INSERT INTO public.organization_members (organization_id, user_id, ativo) SELECT o.id, u.id, true FROM u JOIN o ON o.k = u.org;
INSERT INTO public.user_roles (user_id, role, organization_id) SELECT u.id, u.role::public.app_role, o.id FROM u JOIN o ON o.k = u.org;
INSERT INTO public.organization_modules (organization_id, module, enabled)
  SELECT o.id, m, true FROM o, unnest(ARRAY['feedback_proprietario', 'captacao_exclusiva']) m;
-- equipe: a_lead lidera a_c2
INSERT INTO public.teams (id, lider_id, nome, organization_id)
  SELECT '00000000-0000-0000-0000-0000000000a1', (SELECT id FROM u WHERE k = 'a_lead'), 'Equipe T', (SELECT id FROM o WHERE k = 'A');
INSERT INTO public.team_members (membro_id, team_id, organization_id, tipo)
  SELECT (SELECT id FROM u WHERE k = 'a_c2'), '00000000-0000-0000-0000-0000000000a1', (SELECT id FROM o WHERE k = 'A'), 'corretor';
SET LOCAL session_replication_role = origin;

-- feed sintético: org A 40 vendas (20 do 111, 10 do 222, 4 do 444, 3 do 555, 2 do 666, 1 do 777 sem cadastro)
CREATE TEMP TABLE fa AS
SELECT jsonb_agg(jsonb_build_object('code', a || '-' || n, 'tipo', 'apartamento', 'bairro', 'Centro', 'cidade', 'Sorocaba',
  'lat', CASE WHEN n = 1 AND a = '111111111' THEN NULL ELSE -23.5 END, 'lon', CASE WHEN n = 1 AND a = '111111111' THEN NULL ELSE -47.4 END,
  'preco', 500000, 'url', 'https://www.remax.com.br/imoveis/x', 'corretor_nome', 'Nome ' || a,
  'corretor_email', CASE a WHEN '444444444' THEN 'C3@remax.test' WHEN '666666666' THEN 'dup@remax.test' ELSE a || '@remax.test' END,
  'corretor_telefone', CASE a WHEN '555555555' THEN '+55 15 99000-0004' WHEN '111111111' THEN '1500009999' WHEN '222222222' THEN '1500009999' ELSE NULL END)) AS j
FROM (SELECT '111111111' a, generate_series(1, 20) n UNION ALL SELECT '222222222', generate_series(1, 10)
      UNION ALL SELECT '444444444', generate_series(1, 4) UNION ALL SELECT '555555555', generate_series(1, 3)
      UNION ALL SELECT '666666666', generate_series(1, 2) UNION ALL SELECT '777777777', 1) s;
CREATE TEMP TABLE fb AS
SELECT jsonb_agg(jsonb_build_object('code', '999999999-' || n, 'lat', -23.1, 'lon', -47.1, 'corretor_email', 'c3@remax.test')) AS j
FROM generate_series(1, 5) n;
GRANT SELECT ON u, o, fa, fb TO anon, authenticated, service_role;

CREATE TEMP TABLE res(t text, ok boolean, info text);
GRANT ALL ON res TO anon, authenticated, service_role;

-- helper de sessão
CREATE OR REPLACE FUNCTION pg_temp.as_user(_k text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _id uuid := (SELECT id FROM u WHERE k = _k);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_id::text, ''), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _id, 'role', 'authenticated')::text, true);
  PERFORM set_config('mt.ctx', '', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO anon, authenticated, service_role;

-- 1) authenticated NÃO chama ingest / mark_failed; anon também não
SET LOCAL ROLE authenticated; SELECT pg_temp.as_user('a_admin');
DO $$ BEGIN
  BEGIN PERFORM public.remax_xml_ingest((SELECT id FROM o WHERE k='A'), (SELECT j FROM fa), 40, now());
    INSERT INTO res VALUES ('authenticated_nao_ingest', false, 'executou');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('authenticated_nao_ingest', true, SQLERRM); END;
  BEGIN PERFORM public.remax_xml_mark_failed((SELECT id FROM o WHERE k='A'), 'x', now());
    INSERT INTO res VALUES ('authenticated_nao_mark_failed', false, 'executou');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('authenticated_nao_mark_failed', true, SQLERRM); END;
  BEGIN PERFORM 1 FROM public.remax_xml_listings LIMIT 1; INSERT INTO res VALUES ('authenticated_sem_select_direto', false, 'leu');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('authenticated_sem_select_direto', true, SQLERRM); END;
  BEGIN PERFORM 1 FROM public.remax_xml_runs LIMIT 1; INSERT INTO res VALUES ('authenticated_sem_select_runs', false, 'leu');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('authenticated_sem_select_runs', true, SQLERRM); END;
  BEGIN PERFORM * FROM public.remax_xml_broker_match((SELECT id FROM o WHERE k='A'));
    INSERT INTO res VALUES ('authenticated_nao_broker_match', false, 'executou');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('authenticated_nao_broker_match', true, SQLERRM); END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon; SELECT pg_temp.as_user('nao-existe');
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['remax_xml_status', 'feedback_xml_base', 'remax_xml_broker_links', 'mapa_anuncios_xml'] LOOP
    BEGIN EXECUTE format('SELECT * FROM public.%I()', f); INSERT INTO res VALUES ('anon_negado_' || f, false, 'executou');
    EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('anon_negado_' || f, true, SQLERRM); END;
  END LOOP;
  BEGIN PERFORM public.remax_xml_ingest(gen_random_uuid(), '[]', 0, now()); INSERT INTO res VALUES ('anon_nao_ingest', false, 'executou');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('anon_nao_ingest', true, SQLERRM); END;
END $$;
RESET ROLE;

-- 2) service_role: ingest vazio rejeitado (sem coleta boa anterior)
SET LOCAL ROLE service_role;
INSERT INTO res SELECT 'ingest_vazio_rejeitado', r->>'status' = 'rejeitado', r::text
  FROM (SELECT public.remax_xml_ingest((SELECT id FROM o WHERE k='A'), '[]'::jsonb, 0, now()) r) x;
INSERT INTO res SELECT 'ingest_ok_A', r->>'status' = 'ok' AND (r->>'venda')::int = 40 AND (r->>'com_coord')::int = 39, r::text
  FROM (SELECT public.remax_xml_ingest((SELECT id FROM o WHERE k='A'), (SELECT j FROM fa), 45, now()) r) x;
INSERT INTO res SELECT 'ingest_ok_B', r->>'status' = 'ok' AND (r->>'venda')::int = 5, r::text
  FROM (SELECT public.remax_xml_ingest((SELECT id FROM o WHERE k='B'), (SELECT j FROM fb), 5, now()) r) x;
-- feed com 15 (< 50% de 40) rejeitado, dados antigos mantidos
INSERT INTO res SELECT 'ingest_menos_50pct_rejeitado', r->>'status' = 'rejeitado', r::text
  FROM (SELECT public.remax_xml_ingest((SELECT id FROM o WHERE k='A'),
    (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements((SELECT j FROM fa)) e LIMIT 15) z), 15, now()) r) x;
INSERT INTO res SELECT 'ingest_vazio_rejeitado_com_anterior', r->>'status' = 'rejeitado', r::text
  FROM (SELECT public.remax_xml_ingest((SELECT id FROM o WHERE k='A'), '[]'::jsonb, 0, now()) r) x;
SELECT public.remax_xml_mark_failed((SELECT id FROM o WHERE k='A'), 'timeout', now());
INSERT INTO res SELECT 'dados_antigos_mantidos', n = 40, n::text FROM (
  SELECT count(*) n FROM public.remax_xml_listings l
   WHERE l.organization_id = (SELECT id FROM o WHERE k='A') AND l.last_run = (public.remax_xml_last_ok((SELECT id FROM o WHERE k='A'))).id) z;
RESET ROLE;

-- 3) status: A mostra aviso (última tentativa falhou) com última boa = 40; B sem aviso
SET LOCAL ROLE authenticated; SELECT pg_temp.as_user('a_c1');
INSERT INTO res SELECT 'status_A_aviso_ultima_boa', s.venda = 40 AND s.ultimo_status IN ('failed', 'rejeitado') AND s.aviso IS NOT NULL, row_to_json(s)::text
  FROM public.remax_xml_status() s;
SELECT pg_temp.as_user('b_c1');
INSERT INTO res SELECT 'status_B_isolado', s.venda = 5 AND s.aviso IS NULL, row_to_json(s)::text FROM public.remax_xml_status() s;

-- 4) feedback_xml_base: corretor vê só os seus; gestor vê os da equipe; admin vê todos; org isolada
SELECT pg_temp.as_user('a_c1');
INSERT INTO res SELECT 'feedback_corretor_so_proprios', count(*) = 20 AND bool_and(agent_id = '111111111'), count(*)::text
  FROM public.feedback_xml_base();
SELECT pg_temp.as_user('a_c3');
INSERT INTO res SELECT 'feedback_corretor_via_email', count(*) = 4 AND bool_and(agent_id = '444444444'), count(*)::text
  FROM public.feedback_xml_base();
SELECT pg_temp.as_user('a_c4');
INSERT INTO res SELECT 'feedback_corretor_via_telefone', count(*) = 3 AND bool_and(agent_id = '555555555'), count(*)::text
  FROM public.feedback_xml_base();
SELECT pg_temp.as_user('a_d1');
INSERT INTO res SELECT 'feedback_conflito_nao_liga', count(*) = 0, count(*)::text FROM public.feedback_xml_base();
SELECT pg_temp.as_user('a_lead');
INSERT INTO res SELECT 'feedback_gestor_so_equipe', count(*) = 10 AND bool_and(agent_id = '222222222'), count(*)::text
  FROM public.feedback_xml_base();
SELECT pg_temp.as_user('a_admin');
INSERT INTO res SELECT 'feedback_admin_A_todos', count(*) = 40 AND bool_and(left(code, 9) <> '999999999'), count(*)::text
  FROM public.feedback_xml_base();
SELECT pg_temp.as_user('b_admin');
INSERT INTO res SELECT 'feedback_admin_B_isolado', count(*) = 5 AND bool_and(agent_id = '999999999'), count(*)::text
  FROM public.feedback_xml_base();
SELECT pg_temp.as_user('b_mail');  -- mesmo e-mail do 444 da org A: não pode ver nada da A
INSERT INTO res SELECT 'feedback_email_outra_org_nao_liga', count(*) = 0, count(*)::text FROM public.feedback_xml_base();
-- inativo negado
SELECT pg_temp.as_user('a_inat');
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['remax_xml_status', 'feedback_xml_base', 'remax_xml_broker_links', 'mapa_anuncios_xml'] LOOP
    BEGIN EXECUTE format('SELECT * FROM public.%I()', f); INSERT INTO res VALUES ('inativo_negado_' || f, false, 'executou');
    EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('inativo_negado_' || f, true, SQLERRM); END;
  END LOOP;
END $$;

-- 5) broker_links só admin, e por org
SELECT pg_temp.as_user('a_c1');
DO $$ BEGIN
  BEGIN PERFORM * FROM public.remax_xml_broker_links(); INSERT INTO res VALUES ('broker_links_corretor_negado', false, 'executou');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('broker_links_corretor_negado', true, SQLERRM); END;
END $$;
SELECT pg_temp.as_user('a_lead');
DO $$ BEGIN
  BEGIN PERFORM * FROM public.remax_xml_broker_links(); INSERT INTO res VALUES ('broker_links_gestor_negado', false, 'executou');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('broker_links_gestor_negado', true, SQLERRM); END;
END $$;
SELECT pg_temp.as_user('a_admin');
INSERT INTO res SELECT 'broker_links_admin_A',
  string_agg(agent_id || '=' || via, ',' ORDER BY agent_id) =
  '111111111=id,222222222=id,444444444=email,555555555=telefone,666666666=conflito,777777777=sem_cadastro',
  string_agg(agent_id || '=' || via || '/' || candidatos, ',' ORDER BY agent_id) FROM public.remax_xml_broker_links();
SELECT pg_temp.as_user('b_admin');
-- com 20261016210000 (t_e8265cce): ID aponta para b_c1 e o e-mail do XML para b_mail -> conflito, não liga
INSERT INTO res SELECT 'broker_links_admin_B_isolado', count(*) = 1 AND min(agent_id) = '999999999'
  AND min(via) = CASE WHEN to_regclass('public.remax_xml_broker_vinculos') IS NULL THEN 'id' ELSE 'conflito' END,
  string_agg(agent_id || '=' || via, ',') FROM public.remax_xml_broker_links();

-- 6) mapa_anuncios_xml por org, incluindo o sem coordenada
SELECT pg_temp.as_user('a_c2');
INSERT INTO res SELECT 'mapa_A', count(*) = 40 AND count(*) FILTER (WHERE lat IS NULL) = 1 AND bool_and(transacao = 'venda'),
  count(*) || '/' || count(*) FILTER (WHERE lat IS NULL) FROM public.mapa_anuncios_xml();
SELECT pg_temp.as_user('b_c1');
INSERT INTO res SELECT 'mapa_B_isolado', count(*) = 5 AND bool_and(left(code, 9) = '999999999'), count(*)::text FROM public.mapa_anuncios_xml();
RESET ROLE;

-- 7) DELETE de 60 dias restrito à org
SET LOCAL session_replication_role = replica;
UPDATE public.remax_xml_listings SET last_seen = current_date - 90
 WHERE organization_id = (SELECT id FROM o WHERE k='B');
INSERT INTO public.remax_xml_listings (organization_id, code, agent_id, first_seen, last_seen, last_run)
  SELECT (SELECT id FROM o WHERE k='A'), '111111111-500', '111111111', current_date - 120, current_date - 90, gen_random_uuid();
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE service_role;
SELECT public.remax_xml_ingest((SELECT id FROM o WHERE k='A'), (SELECT j FROM fa), 45, now());
RESET ROLE;
INSERT INTO res SELECT 'delete_60d_apaga_antigo_A', NOT EXISTS (SELECT 1 FROM public.remax_xml_listings
  WHERE organization_id = (SELECT id FROM o WHERE k='A') AND code = '111111111-500'), '';
INSERT INTO res SELECT 'delete_60d_preserva_B', n = 5, n::text FROM (SELECT count(*) n FROM public.remax_xml_listings
  WHERE organization_id = (SELECT id FROM o WHERE k='B')) z;

SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || t || CASE WHEN ok THEN '' ELSE ' -> ' || coalesce(info, '') END FROM res;
SELECT 'TOTAL ' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM res;
ROLLBACK;
SELECT 'apos_rollback_tabela_existe=' || (to_regclass('public.remax_xml_listings') IS NOT NULL);
