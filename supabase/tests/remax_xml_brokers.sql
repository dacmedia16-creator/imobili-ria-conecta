-- Testes SQL da migration 20261016210000_remax_xml_brokers (t_e8265cce). Roda em BEGIN/ROLLBACK, dados 100% sintéticos.
-- Uso (container local com o schema de produção, NUNCA produção): junte as migrations 20261016200000 e
-- 20261016210000 sem BEGIN/COMMIT em /tmp/mig_body.sql e rode: psql -U supabase_admin -f supabase/tests/remax_xml_brokers.sql
-- Saída: linhas PASS/FAIL e TOTAL. Nenhum nome, e-mail ou telefone é impresso.
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
\i /tmp/mig_body.sql
RESET ROLE;

SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE u(k text PRIMARY KEY, id uuid, org text, role text, ativo boolean, remax text, email text, tel text);
INSERT INTO u VALUES
 ('a_admin', gen_random_uuid(), 'A', 'admin',      true,  NULL,        'adm@t.test',        NULL),
 ('a_gest',  gen_random_uuid(), 'A', 'gestor',     true,  NULL,        'gest@t.test',       NULL),
 ('a_fin',   gen_random_uuid(), 'A', 'financeiro', true,  NULL,        'fin@t.test',        NULL),
 ('a_cor',   gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'cor@t.test',        NULL),
 ('p_id',    gen_random_uuid(), 'A', 'corretor',   true,  '100000001', 'pid@t.test',        NULL),          -- 1: por ID
 ('p_mail',  gen_random_uuid(), 'A', 'corretor',   true,  NULL,        ' Mail.Ok@T.test ',  NULL),          -- 2: por e-mail
 ('p_tel',   gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'tel@t.test',        '(15) 3222-0003'), -- 3: telefone (9º díg./DDI)
 ('p_tel2',  gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'tel2@t.test',       '15 98111-0004'), -- 3: telefone fixo/DDI
 ('d_m1',    gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'dup@t.test',        NULL),          -- e-mail em 2 perfis
 ('d_m2',    gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'DUP@t.test',        NULL),
 ('d_t1',    gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'dt1@t.test',        '15 99777-0001'), -- telefone em 2 perfis
 ('d_t2',    gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'dt2@t.test',        '+55 15 9 9777-0001'),
 ('x_id',    gen_random_uuid(), 'A', 'corretor',   true,  '100000007', 'xid@t.test',        NULL),          -- ID ≠ e-mail
 ('x_mail',  gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'xmail@t.test',      NULL),
 ('o_id',    gen_random_uuid(), 'A', 'corretor',   true,  '100000099', 'oid@t.test',        NULL),          -- já tem outro ID
 ('s_mail',  gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'share@t.test',      NULL),          -- 2 corretores XML
 ('e_mail',  gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'etm@t.test',        NULL),          -- e-mail ≠ telefone
 ('e_tel',   gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'ett@t.test',        '15 3222-0011'),
 ('v_old',   gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'vold@t.test',       NULL),          -- vínculo já existe
 ('v_new',   gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'vnew@t.test',       NULL),
 ('inat',    gen_random_uuid(), 'A', 'corretor',   false, '100000014', 'inat@t.test',       NULL),          -- inativo não liga
 ('esc',     gen_random_uuid(), 'A', 'corretor',   true,  NULL,        'esc@t.test',        '15 4444-0000'), -- tel. do escritório
 ('b_admin', gen_random_uuid(), 'B', 'admin',      true,  NULL,        'badm@t.test',       NULL),
 ('b_gest',  gen_random_uuid(), 'B', 'gestor',     true,  NULL,        'bgest@t.test',      NULL),
 ('b_mail',  gen_random_uuid(), 'B', 'corretor',   true,  NULL,        'mail.ok@t.test',    NULL);          -- mesmo e-mail do A
CREATE TEMP TABLE o(k text PRIMARY KEY, id uuid);
INSERT INTO o VALUES ('A', gen_random_uuid()), ('B', gen_random_uuid());
INSERT INTO public.organizations (id, slug, nome, status) SELECT id, 'e826-' || lower(k), 'Teste ' || k, 'ativa' FROM o;
INSERT INTO auth.users (id, email) SELECT id, k || '@auth.e826.test' FROM u;
INSERT INTO public.profiles (id, nome, email, telefone, ativo, organization_id, remax_id)
  SELECT u.id, u.k, u.email, u.tel, u.ativo, o.id, u.remax FROM u JOIN o ON o.k = u.org;
INSERT INTO public.organization_members (organization_id, user_id, ativo) SELECT o.id, u.id, true FROM u JOIN o ON o.k = u.org;
INSERT INTO public.user_roles (user_id, role, organization_id) SELECT u.id, u.role::public.app_role, o.id FROM u JOIN o ON o.k = u.org;
SET LOCAL session_replication_role = origin;

-- Feed sintético org A: agente -> (e-mail, telefone) do XML; 1 anúncio de venda cada (2 para o 100000001).
CREATE TEMP TABLE ag(a text, email text, tel text);
INSERT INTO ag VALUES
 ('100000001', 'outro@t.test',     NULL),               -- ID (e-mail não bate com ninguém: segue por ID)
 ('100000002', 'MAIL.OK@t.test',   NULL),               -- e-mail normalizado
 ('100000003', NULL,               '+55 (15) 3222-0003'), -- telefone com DDI
 ('100000004', NULL,               '1581110004'),       -- telefone sem o 9º dígito
 ('100000005', 'dup@t.test',       NULL),               -- conflito: e-mail em 2 perfis
 ('100000006', NULL,               '15997770001'),      -- conflito: telefone em 2 perfis
 ('100000007', 'xmail@t.test',     NULL),               -- conflito: ID e e-mail em perfis diferentes
 ('100000008', 'oid@t.test',       NULL),               -- conflito: perfil já tem outro ID RE/MAX
 ('100000009', 'share@t.test',     NULL),               -- conflito: mesmo perfil para 2 corretores do XML
 ('100000010', 'share@t.test',     NULL),
 ('100000011', 'etm@t.test',       '1532220011'),       -- conflito: e-mail e telefone em perfis diferentes
 ('100000012', 'vnew@t.test',      NULL),               -- já vinculado a v_old: mantém, só aviso
 ('100000013', NULL,               '1530000013'),       -- sem cadastro
 ('100000014', NULL,               NULL),               -- só perfil inativo: sem cadastro
 ('100000015', NULL,               '1544440000'),       -- telefone do escritório (2 corretores XML): não liga
 ('100000016', NULL,               '1544440000');
CREATE TEMP TABLE fa AS
SELECT jsonb_agg(jsonb_build_object('code', a || '-' || n, 'tipo', 'casa', 'lat', -23.5, 'lon', -47.4,
  'corretor_nome', 'Nome ' || a, 'corretor_email', email, 'corretor_telefone', tel)) AS j
  FROM ag, LATERAL generate_series(1, CASE WHEN a = '100000001' THEN 2 ELSE 1 END) n;
CREATE TEMP TABLE fb AS
SELECT jsonb_agg(jsonb_build_object('code', '200000001-' || n, 'corretor_email', 'mail.ok@t.test')) AS j
  FROM generate_series(1, 3) n;
GRANT SELECT ON u, o, fa, fb, ag TO anon, authenticated, service_role;
CREATE TEMP TABLE res(t text, ok boolean, info text);
GRANT ALL ON res TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.as_user(_k text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _id uuid := (SELECT id FROM u WHERE k = _k);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_id::text, ''), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _id, 'role', 'authenticated')::text, true);
  PERFORM set_config('mt.ctx', '', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION pg_temp.uk(_id uuid) RETURNS text LANGUAGE sql AS $$ SELECT k FROM u WHERE id = _id $$;
GRANT EXECUTE ON FUNCTION pg_temp.uk(uuid) TO anon, authenticated, service_role;

-- Normalização
INSERT INTO res SELECT 'email_key', public.remax_email_key(' Mail.Ok@T.test ') = 'mail.ok@t.test', '';
INSERT INTO res SELECT 'tel_key_ddi_9digito',
  public.remax_tel_key('+55 (15) 99000-0004') = '1590000004' AND public.remax_tel_key('15 9000-0004') = '1590000004'
  AND public.remax_tel_key('5515990000004') = '1590000004' AND public.remax_tel_key('015 3222-0003') = '1532220003', '';
INSERT INTO res SELECT 'tel_key_invalido_nulo', public.remax_tel_key('99000-0004') IS NULL AND public.remax_tel_key('') IS NULL, '';

-- Vínculo pré-existente (admin) e retrato de profiles para provar que nada é sobrescrito
INSERT INTO public.remax_xml_broker_vinculos (organization_id, agent_id, profile_id, origem)
  SELECT (SELECT id FROM o WHERE k='A'), '100000012', (SELECT id FROM u WHERE k='v_old'), 'admin';
CREATE TEMP TABLE snap AS SELECT md5(string_agg(p::text, '|' ORDER BY p.id)) h FROM public.profiles p
  WHERE p.organization_id IN (SELECT id FROM o);

-- Coleta (servidor). O gatilho em remax_xml_runs faz o cruzamento na mesma transação.
SET LOCAL ROLE service_role;
SELECT public.remax_xml_ingest((SELECT id FROM o WHERE k='A'), (SELECT j FROM fa), 17, now()) IS NOT NULL AS ingest_a;
SELECT public.remax_xml_ingest((SELECT id FROM o WHERE k='B'), (SELECT j FROM fb), 3, now()) IS NOT NULL AS ingest_b;
RESET ROLE;

CREATE TEMP TABLE m AS SELECT * FROM public.remax_xml_broker_match((SELECT id FROM o WHERE k='A'));
CREATE OR REPLACE FUNCTION pg_temp.chk(_t text, _a text, _via text, _pk text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO res SELECT _t, coalesce(bool_and(via = _via AND pg_temp.uk(profile_id) IS NOT DISTINCT FROM _pk), false),
    coalesce(string_agg(via || '/' || coalesce(pg_temp.uk(profile_id), '-'), ','), 'ausente') FROM m WHERE agent_id = _a
$$;
SELECT pg_temp.chk('nivel1_id',               '100000001', 'id',           'p_id');
SELECT pg_temp.chk('nivel2_email_normalizado','100000002', 'email',        'p_mail');
SELECT pg_temp.chk('nivel3_tel_ddi',          '100000003', 'telefone',     'p_tel');
SELECT pg_temp.chk('nivel3_tel_9digito',      '100000004', 'telefone',     'p_tel2');
SELECT pg_temp.chk('conflito_email_2_perfis', '100000005', 'conflito',     NULL);
SELECT pg_temp.chk('conflito_tel_2_perfis',   '100000006', 'conflito',     NULL);
SELECT pg_temp.chk('conflito_id_x_email',     '100000007', 'conflito',     NULL);
SELECT pg_temp.chk('conflito_perfil_outro_id','100000008', 'conflito',     NULL);
SELECT pg_temp.chk('conflito_perfil_2_xml_a', '100000009', 'conflito',     NULL);
SELECT pg_temp.chk('conflito_perfil_2_xml_b', '100000010', 'conflito',     NULL);
SELECT pg_temp.chk('conflito_email_x_tel',    '100000011', 'conflito',     NULL);
SELECT pg_temp.chk('vinculo_existente_mantido','100000012','admin',        'v_old');
SELECT pg_temp.chk('sem_cadastro',            '100000013', 'sem_cadastro', NULL);
SELECT pg_temp.chk('inativo_nao_liga',        '100000014', 'sem_cadastro', NULL);
SELECT pg_temp.chk('tel_escritorio_nao_liga_a','100000015','sem_cadastro', NULL);
SELECT pg_temp.chk('tel_escritorio_nao_liga_b','100000016','sem_cadastro', NULL);

-- Persistência: vínculos novos com origem; revisão com motivo; nada sobrescrito
INSERT INTO res SELECT 'vinculos_novos_com_origem',
  string_agg(agent_id || '=' || origem || '/' || pg_temp.uk(profile_id), ',' ORDER BY agent_id) =
  '100000001=id/p_id,100000002=email/p_mail,100000003=telefone/p_tel,100000004=telefone/p_tel2,100000012=admin/v_old',
  string_agg(agent_id || '=' || origem, ',' ORDER BY agent_id)
  FROM public.remax_xml_broker_vinculos WHERE organization_id = (SELECT id FROM o WHERE k='A') AND encerrado_em IS NULL;
INSERT INTO res SELECT 'revisao_motivos',
  string_agg(agent_id || '=' || motivo, ',' ORDER BY agent_id) =
  '100000005=email_varios_perfis,100000006=telefone_varios_perfis,100000007=id_diverge_contato,'
  '100000008=perfil_com_outro_id,100000009=perfil_em_outro_corretor,100000010=perfil_em_outro_corretor,'
  '100000011=email_telefone_divergem,100000012=vinculo_diverge',
  string_agg(agent_id || '=' || motivo, ',' ORDER BY agent_id)
  FROM public.remax_xml_broker_revisao WHERE organization_id = (SELECT id FROM o WHERE k='A') AND status = 'pendente';
INSERT INTO res SELECT 'profiles_intactos', (SELECT h FROM snap) = md5(string_agg(p::text, '|' ORDER BY p.id)), ''
  FROM public.profiles p WHERE p.organization_id IN (SELECT id FROM o);
INSERT INTO res SELECT 'cadastro_xml_guardado', count(*) = 16 AND count(*) FILTER (WHERE email IS NOT NULL) = 9
  AND bool_and(nome IS NOT NULL), count(*)::text
  FROM public.remax_xml_brokers WHERE organization_id = (SELECT id FROM o WHERE k='A');
INSERT INTO res SELECT 'org_B_isolada_no_cruzamento', count(*) = 1 AND bool_and(via = 'email' AND pg_temp.uk(profile_id) = 'b_mail'),
  string_agg(via, ',') FROM public.remax_xml_broker_match((SELECT id FROM o WHERE k='B'));

-- 2ª coleta igual: idempotente (sem vínculo duplicado, revisão não duplica)
SET LOCAL ROLE service_role;
SELECT public.remax_xml_ingest((SELECT id FROM o WHERE k='A'), (SELECT j FROM fa), 17, now()) IS NOT NULL AS ingest_a2;
RESET ROLE;
INSERT INTO res SELECT 'reexecucao_idempotente',
  (SELECT count(*) FROM public.remax_xml_broker_vinculos WHERE organization_id = (SELECT id FROM o WHERE k='A')) = 5
  AND (SELECT count(*) FROM public.remax_xml_broker_revisao WHERE organization_id = (SELECT id FROM o WHERE k='A')) = 8, '';

-- Coleta seguinte sem o e-mail do 100000002: vínculo continua (não apaga)
SET LOCAL ROLE service_role;
SELECT public.remax_xml_ingest((SELECT id FROM o WHERE k='A'),
  (SELECT jsonb_agg(CASE WHEN e->>'code' LIKE '100000002-%' THEN e - 'corretor_email' ELSE e END) FROM fa, jsonb_array_elements(fa.j) e),
  17, now()) IS NOT NULL AS ingest_a3;
RESET ROLE;
INSERT INTO res SELECT 'vinculo_nao_apagado', EXISTS (SELECT 1 FROM public.remax_xml_broker_vinculos
  WHERE agent_id = '100000002' AND profile_id = (SELECT id FROM u WHERE k='p_mail') AND encerrado_em IS NULL), '';

-- RLS / permissões
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a_gest');
INSERT INTO res SELECT 'rls_gestor_A_ve_A', count(*) = 16 AND count(DISTINCT organization_id) = 1
  AND min(organization_id::text) = (SELECT id::text FROM o WHERE k='A'), count(*)::text FROM public.remax_xml_brokers;
INSERT INTO res SELECT 'rls_gestor_A_vinculos_A', count(*) = 5, count(*)::text FROM public.remax_xml_broker_vinculos;
INSERT INTO res SELECT 'rls_gestor_A_revisao_A', count(*) = 8, count(*)::text FROM public.remax_xml_broker_revisao;
SELECT pg_temp.as_user('a_fin');
INSERT INTO res SELECT 'rls_financeiro_A_ve_A', count(*) = 16, count(*)::text FROM public.remax_xml_brokers;
SELECT pg_temp.as_user('a_cor');
INSERT INTO res SELECT 'rls_corretor_nao_ve', count(*) = 0, count(*)::text FROM public.remax_xml_brokers;
SELECT pg_temp.as_user('b_gest');
INSERT INTO res SELECT 'rls_gestor_B_so_B', count(*) = 1 AND bool_and(agent_id = '200000001'), count(*)::text FROM public.remax_xml_brokers;
INSERT INTO res SELECT 'rls_gestor_B_nao_ve_vinculos_A', count(*) = 1, count(*)::text FROM public.remax_xml_broker_vinculos;
INSERT INTO res SELECT 'rls_gestor_B_nao_ve_revisao_A', count(*) = 0, count(*)::text FROM public.remax_xml_broker_revisao;
SELECT pg_temp.as_user('a_admin');
DO $$ BEGIN
  BEGIN INSERT INTO public.remax_xml_broker_vinculos (organization_id, agent_id, profile_id, origem)
    VALUES ((SELECT id FROM o WHERE k='A'), '100000013', (SELECT id FROM u WHERE k='a_cor'), 'admin');
    INSERT INTO res VALUES ('admin_nao_escreve_direto', false, 'inseriu');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('admin_nao_escreve_direto', true, ''); END;
  BEGIN UPDATE public.remax_xml_brokers SET nome = 'x';
    INSERT INTO res VALUES ('admin_nao_altera_cadastro', false, 'alterou');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('admin_nao_altera_cadastro', true, ''); END;
  BEGIN PERFORM public.remax_xml_broker_sync((SELECT id FROM o WHERE k='A'), gen_random_uuid());
    INSERT INTO res VALUES ('authenticated_nao_sync', false, 'executou');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('authenticated_nao_sync', true, ''); END;
  BEGIN PERFORM * FROM public.remax_xml_broker_eval((SELECT id FROM o WHERE k='A'), gen_random_uuid());
    INSERT INTO res VALUES ('authenticated_nao_eval', false, 'executou');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('authenticated_nao_eval', true, ''); END;
END $$;
-- Resolver revisão: gestor negado; admin confirma o ID (100000007 -> x_id) e encerra outro
SELECT pg_temp.as_user('a_gest');
DO $$ BEGIN
  BEGIN PERFORM public.remax_xml_revisao_resolver((SELECT id FROM public.remax_xml_broker_revisao LIMIT 1), 'encerrar');
    INSERT INTO res VALUES ('resolver_gestor_negado', false, 'executou');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('resolver_gestor_negado', true, ''); END;
END $$;
SELECT pg_temp.as_user('a_admin');
SELECT public.remax_xml_revisao_resolver((SELECT id FROM public.remax_xml_broker_revisao
  WHERE agent_id = '100000007' AND status = 'pendente'), 'confirmar_id') AS r1;
SELECT pg_temp.as_user('b_admin');
DO $$ BEGIN
  BEGIN PERFORM public.remax_xml_revisao_resolver((SELECT r.id FROM public.remax_xml_broker_revisao r
      JOIN public.organizations g ON g.id = r.organization_id WHERE g.slug = 'e826-a' LIMIT 1), 'encerrar');
    INSERT INTO res VALUES ('resolver_outra_org_negado', false, 'executou');
  EXCEPTION WHEN no_data_found THEN INSERT INTO res VALUES ('resolver_outra_org_negado', true, ''); END;
END $$;
RESET ROLE;
INSERT INTO res SELECT 'resolver_confirma_id', EXISTS (SELECT 1 FROM public.remax_xml_broker_vinculos WHERE agent_id = '100000007'
  AND origem = 'admin' AND profile_id = (SELECT id FROM u WHERE k='x_id') AND encerrado_em IS NULL)
  AND (SELECT status FROM public.remax_xml_broker_revisao WHERE agent_id = '100000007' ORDER BY first_seen LIMIT 1) = 'resolvido', '';
INSERT INTO res SELECT 'apos_resolver_liga_pelo_vinculo', via = 'admin' AND pg_temp.uk(profile_id) = 'x_id', via
  FROM public.remax_xml_broker_match((SELECT id FROM o WHERE k='A')) WHERE agent_id = '100000007';
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.remax_xml_brokers LIMIT 1; INSERT INTO res VALUES ('anon_sem_acesso', false, 'leu');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO res VALUES ('anon_sem_acesso', true, ''); END;
END $$;
RESET ROLE;

SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || t || CASE WHEN ok THEN '' ELSE ' -> ' || coalesce(info, '') END FROM res;
SELECT 'TOTAL ' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM res;
ROLLBACK;
SELECT 'apos_rollback_tabela_existe=' || (to_regclass('public.remax_xml_brokers') IS NOT NULL);
