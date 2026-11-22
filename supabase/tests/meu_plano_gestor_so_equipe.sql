-- Suíte "gestor vê só a própria equipe" (migration 20261218120000, t_889fb3c1/t_48670ed3).
-- Transação revertida, banco local descartável ou homologação; nunca produção. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.le(_ids uuid[]) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.carreira_plano WHERE ano = 2027 AND user_id = ANY(_ids) $$;
CREATE FUNCTION pg_temp.lista() RETURNS uuid[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(user_id ORDER BY user_id), '{}') FROM public.carreira_plano_equipe(2027) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a2000000-0000-4000-8000-0000000000a0'
\set org_b 'b2000000-0000-4000-8000-0000000000b0'
\set admin 'a2000000-0000-4000-8000-000000000001'
\set gestor 'a2000000-0000-4000-8000-000000000002'
\set gsem 'a2000000-0000-4000-8000-000000000008'
\set tl 'a2000000-0000-4000-8000-000000000003'
\set dono 'a2000000-0000-4000-8000-000000000009'
\set c1 'a2000000-0000-4000-8000-000000000005'
\set c2 'a2000000-0000-4000-8000-000000000006'
\set c3 'a2000000-0000-4000-8000-000000000007'
\set c4 'a2000000-0000-4000-8000-00000000000a'
\set gb 'b2000000-0000-4000-8000-000000000001'
\set cb 'b2000000-0000-4000-8000-000000000003'
\set eqg 'a2000000-0000-4000-8000-00000000e001'
\set eqt 'a2000000-0000-4000-8000-00000000e002'
\set eqf 'a2000000-0000-4000-8000-00000000e003'
\set eqb 'b2000000-0000-4000-8000-00000000e001'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:'org_a', 'teste-gse-a', 'Imobiliaria GSE A', 'ativa'),
  (:'org_b', 'teste-gse-b', 'Imobiliaria GSE B', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'gsem', :'tl', :'dono', :'c1', :'c2', :'c3', :'c4', :'gb', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Adm GSE', 'adm@gse.test', true, :'org_a'),
  (:'gestor', 'Gestor GSE', 'gestor@gse.test', true, :'org_a'),
  (:'gsem', 'Gestor Sem Equipe', 'gsem@gse.test', true, :'org_a'),
  (:'tl', 'TL GSE', 'tl@gse.test', true, :'org_a'),
  (:'dono', 'Dono GSE', 'dono@gse.test', true, :'org_a'),
  (:'c1', 'Ana Do Gestor', 'c1@gse.test', true, :'org_a'),
  (:'c2', 'Bia Do TL', 'c2@gse.test', true, :'org_a'),
  (:'c3', 'Caio Sem Equipe', 'c3@gse.test', true, :'org_a'),
  (:'c4', 'Duda Equipe Filha', 'c4@gse.test', true, :'org_a'),
  (:'gb', 'Gestor B', 'gb@gse.test', true, :'org_b'),
  (:'cb', 'Corretor B', 'cb@gse.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo)
  SELECT :'org_a'::uuid, unnest(ARRAY[:'admin', :'gestor', :'gsem', :'tl', :'dono', :'c1', :'c2', :'c3', :'c4']::uuid[]), true
  UNION ALL SELECT :'org_b'::uuid, unnest(ARRAY[:'gb', :'cb']::uuid[]), true;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'dono', 'super_admin', :'org_a'),
  (:'gestor', 'gestor', :'org_a'), (:'gsem', 'gestor', :'org_a'),
  (:'tl', 'team_leader', :'org_a'), (:'tl', 'corretor', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'),
  (:'c4', 'corretor', :'org_a'), (:'gb', 'gestor', :'org_b'), (:'cb', 'corretor', :'org_b');
-- Equipe do gestor (eqg) tem uma equipe-filha (eqf) com a Duda: o gestor vê pela equipe-mãe.
INSERT INTO public.teams (id, nome, organization_id, lider_id, parent_team_id) VALUES
  (:'eqg', 'Equipe do Gestor', :'org_a', :'gestor', NULL),
  (:'eqt', 'Equipe do TL', :'org_a', :'tl', NULL),
  (:'eqf', 'Equipe Filha', :'org_a', :'admin', :'eqg'),
  (:'eqb', 'Equipe B', :'org_b', :'gb', NULL);
INSERT INTO public.team_members (team_id, membro_id, organization_id) VALUES
  (:'eqg', :'c1', :'org_a'), (:'eqt', :'c2', :'org_a'), (:'eqt', :'tl', :'org_a'),
  (:'eqf', :'c4', :'org_a'), (:'eqb', :'cb', :'org_b');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'meu_plano_2027', true), (:'org_b', 'meu_plano_2027', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.carreira_plano (organization_id, user_id, ano, trilha, respostas, assinado_corretor_em) VALUES
  (:'org_a', :'tl', 2027, 'ativacao', '{"pq.frase":"do TL"}', NULL),
  (:'org_a', :'c1', 2027, 'planejamento', '{"pq.frase":"da Ana"}', now()),
  (:'org_a', :'c2', 2027, 'ativacao', '{"pq.frase":"da Bia"}', now()),
  (:'org_a', :'c3', 2027, 'ativacao', '{"pq.frase":"do Caio"}', NULL),
  (:'org_a', :'c4', 2027, 'ativacao', '{"pq.frase":"da Duda"}', NULL),
  (:'org_b', :'cb', 2027, 'planejamento', '{"pq.frase":"de B"}', NULL);
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
\set todos_a 'ARRAY[''a2000000-0000-4000-8000-000000000003'',''a2000000-0000-4000-8000-000000000005'',''a2000000-0000-4000-8000-000000000006'',''a2000000-0000-4000-8000-000000000007'',''a2000000-0000-4000-8000-00000000000a'']::uuid[]'

-- 1) Admin e administrador principal: a imobiliária toda ------------------------------------------------------
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.le(:todos_a) = 5, 'admin le os 5 planos da imobiliaria');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'cb']::uuid[]) = 0, 'admin NAO le plano de outra imobiliaria');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano_equipe(2027) WHERE user_id = ANY(:todos_a)) = 5,
  'lista do admin = imobiliaria toda (inclui sem equipe)');
SELECT pg_temp.as_user(:'dono');
SELECT pg_temp.ok(pg_temp.le(:todos_a) = 5, 'super_admin le os 5 planos da imobiliaria');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano_equipe(2027) WHERE user_id = ANY(:todos_a)) = 5,
  'lista do super_admin = imobiliaria toda');

-- 2) Gestor: só a própria equipe (inclui equipe-filha), igual ao Painel da Equipe -----------------------------
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c1', :'c4']::uuid[]) = 2, 'gestor le os membros da propria equipe (e da equipe-filha)');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c2', :'tl']::uuid[]) = 0, 'gestor NAO le a equipe do TL');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c3']::uuid[]) = 0, 'gestor NAO le corretor sem equipe');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'cb']::uuid[]) = 0, 'gestor NAO le outra imobiliaria');
SELECT pg_temp.ok(pg_temp.lista() = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[:'c1', :'c4']::uuid[]) x),
  'lista do gestor = so a equipe dele');
SELECT pg_temp.ok(public.meu_plano_eh_broker(:'gestor') = true, 'meu_plano_eh_broker do gestor continua true (nao mexido)');
SELECT pg_temp.ok(public.meu_plano_ve_imobiliaria(:'gestor') = false, 'gestor NAO tem a visao ampla');

-- 3) Gestor sem equipe: lista vazia, sem erro ----------------------------------------------------------------
SELECT pg_temp.as_user(:'gsem');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_plano_equipe(2027)') IS NULL, 'gestor sem equipe abre a lista sem erro');
SELECT pg_temp.ok(cardinality(pg_temp.lista()) = 0, 'gestor sem equipe ve lista vazia');
SELECT pg_temp.ok(pg_temp.le(:todos_a) = 0, 'gestor sem equipe NAO le nenhum plano');

-- 4) TL: só a própria equipe (sem mudança) ---------------------------------------------------------------------
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c2']::uuid[]) = 1, 'TL le o membro da propria equipe');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c1', :'c3', :'c4']::uuid[]) = 0, 'TL NAO le outra equipe nem sem equipe');
SELECT pg_temp.ok(pg_temp.lista() = ARRAY[:'c2']::uuid[], 'lista do TL = so a equipe dele (sem ele mesmo)');

-- 5) Corretor: só o próprio, sem lista -------------------------------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c1']::uuid[]) = 1, 'corretor le o proprio plano');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c2', :'c3', :'c4', :'tl']::uuid[]) = 0, 'corretor NAO le plano de colega');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_plano_equipe(2027)') LIKE '42501%', 'corretor NAO abre a lista (42501)');

-- 6) Outra imobiliária ---------------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'cb']::uuid[]) = 1, 'gestor B le o membro da equipe B');
SELECT pg_temp.ok(pg_temp.le(:todos_a) = 0, 'gestor B NAO le nenhum plano de A');

-- 7) Fica como estava (registro para Denis): assinatura do pacto pelo gestor fora da equipe -------------------
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.carreira_plano_assinar_broker(%L, 2027)', :'c2')) IS NULL,
  'NAO MEXIDO: gestor ainda assina como broker o pacto de corretor de FORA da equipe (meu_plano_eh_broker)');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
