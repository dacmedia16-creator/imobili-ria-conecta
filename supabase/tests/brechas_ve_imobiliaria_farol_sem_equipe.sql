-- Suíte das 2 brechas antigas (migration 20261220120000, t_b03b2db1; Denis 22/11/2026, tópico 6238, item 4).
-- Transação revertida, banco local descartável ou homologação; nunca produção. Dados fictícios.
-- Papéis: admin da própria (admin), dono/super_admin (dono), "admin de outra imobiliária" (xadm: membro e corretor
-- na A, mas com papel admin gravado na B), admin da B (adb), super admin da plataforma em "Entrar como" (plat),
-- gestor COM equipe (gestor), gestor SEM equipe (gsem), TL (tl), corretor com equipe (c1), corretor sem equipe (c3).
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text, _sid text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           (json_build_object('sub', _uid, 'role', 'authenticated')::jsonb
            || CASE WHEN _sid IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('session_id', _sid) END)::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.pessoas(_j jsonb) RETURNS uuid[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg((x ->> 'user_id')::uuid ORDER BY x ->> 'user_id'), '{}') FROM jsonb_array_elements(_j -> 'pessoas') x $$;
-- funil90_equipe.ligacoes da pessoa _uid dentro do farol _j.
CREATE FUNCTION pg_temp.lig_eq(_j jsonb, _uid uuid) RETURNS integer LANGUAGE sql AS
  $$ SELECT (x -> 'funil90_equipe' ->> 'ligacoes')::integer FROM jsonb_array_elements(_j -> 'pessoas') x
      WHERE (x ->> 'user_id')::uuid = _uid $$;
CREATE FUNCTION pg_temp.arr(_ids uuid[]) RETURNS uuid[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg(x ORDER BY x::text), '{}') FROM unnest(_ids) x $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a4000000-0000-4000-8000-0000000000a0'
\set org_b 'b4000000-0000-4000-8000-0000000000b0'
\set admin 'a4000000-0000-4000-8000-000000000001'
\set gestor 'a4000000-0000-4000-8000-000000000002'
\set tl 'a4000000-0000-4000-8000-000000000003'
\set xadm 'a4000000-0000-4000-8000-000000000004'
\set c1 'a4000000-0000-4000-8000-000000000005'
\set c2 'a4000000-0000-4000-8000-000000000006'
\set c3 'a4000000-0000-4000-8000-000000000007'
\set gsem 'a4000000-0000-4000-8000-000000000008'
\set dono 'a4000000-0000-4000-8000-000000000009'
\set plat 'a4000000-0000-4000-8000-0000000000ff'
\set psid 'a4000000-0000-4000-8000-00000000f5f5'
\set adb 'b4000000-0000-4000-8000-000000000001'
\set cb 'b4000000-0000-4000-8000-000000000003'
\set eqg 'a4000000-0000-4000-8000-00000000e001'
\set eqt 'a4000000-0000-4000-8000-00000000e002'
\set eqb 'b4000000-0000-4000-8000-00000000e001'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:'org_a', 'teste-bvf-a', 'Imobiliaria BVF A', 'ativa'),
  (:'org_b', 'teste-bvf-b', 'Imobiliaria BVF B', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'tl', :'xadm', :'c1', :'c2', :'c3', :'gsem', :'dono',
  :'plat', :'adb', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Adm BVF', 'adm@bvf.test', true, :'org_a'),
  (:'gestor', 'Gestor BVF', 'gestor@bvf.test', true, :'org_a'),
  (:'tl', 'TL BVF', 'tl@bvf.test', true, :'org_a'),
  (:'xadm', 'Ex Admin De B', 'xadm@bvf.test', true, :'org_a'),
  (:'c1', 'Ana Do Gestor', 'c1@bvf.test', true, :'org_a'),
  (:'c2', 'Bia Do TL', 'c2@bvf.test', true, :'org_a'),
  (:'c3', 'Caio Sem Equipe', 'c3@bvf.test', true, :'org_a'),
  (:'gsem', 'Gestor Sem Equipe BVF', 'gsem@bvf.test', true, :'org_a'),
  (:'dono', 'Dono BVF', 'dono@bvf.test', true, :'org_a'),
  (:'plat', 'Plataforma BVF', 'plat@bvf.test', true, :'org_b'),
  (:'adb', 'Admin B', 'adb@bvf.test', true, :'org_b'),
  (:'cb', 'Corretor B', 'cb@bvf.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo)
  SELECT :'org_a'::uuid, unnest(ARRAY[:'admin', :'gestor', :'tl', :'xadm', :'c1', :'c2', :'c3', :'gsem', :'dono']::uuid[]), true
  UNION ALL SELECT :'org_b'::uuid, unnest(ARRAY[:'adb', :'cb']::uuid[]), true;
-- xadm: mudou da B para a A e ficou com o papel admin antigo gravado na B (é isso que a brecha (a) aproveitava).
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'dono', 'super_admin', :'org_a'),
  (:'gestor', 'gestor', :'org_a'), (:'gsem', 'gestor', :'org_a'),
  (:'tl', 'team_leader', :'org_a'), (:'tl', 'corretor', :'org_a'),
  (:'xadm', 'corretor', :'org_a'), (:'xadm', 'admin', :'org_b'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'),
  (:'adb', 'admin', :'org_b'), (:'cb', 'corretor', :'org_b');
INSERT INTO public.teams (id, nome, organization_id, lider_id, parent_team_id) VALUES
  (:'eqg', 'Equipe do Gestor BVF', :'org_a', :'gestor', NULL),
  (:'eqt', 'Equipe do TL BVF', :'org_a', :'tl', NULL),
  (:'eqb', 'Equipe B BVF', :'org_b', :'adb', NULL);
INSERT INTO public.team_members (team_id, membro_id, organization_id) VALUES
  (:'eqg', :'c1', :'org_a'), (:'eqt', :'c2', :'org_a'), (:'eqt', :'tl', :'org_a'), (:'eqb', :'cb', :'org_b');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'meu_plano_2027', true), (:'org_b', 'meu_plano_2027', true),
  (:'org_a', 'inteligencia_gestao', true), (:'org_b', 'inteligencia_gestao', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.carreira_plano (organization_id, user_id, ano, trilha, respostas) VALUES
  (:'org_a', :'c1', 2027, 'planejamento', '{"pq.frase":"da Ana"}'),
  (:'org_a', :'c2', 2027, 'ativacao', '{"pq.frase":"da Bia"}'),
  (:'org_a', :'c3', 2027, 'ativacao', '{"pq.frase":"do Caio"}');
-- Diário dos últimos dias: ligações por pessoa (c1 100, c2 50, c3 7, gsem 3, xadm 0). Imobiliária A = 160.
INSERT INTO public.carreira_diario (organization_id, user_id, dia, tipo, quantidade) VALUES
  (:'org_a', :'c1', current_date - 3, 'ligacao', 100),
  (:'org_a', :'c2', current_date - 3, 'ligacao', 50),
  (:'org_a', :'c3', current_date - 3, 'ligacao', 7),
  (:'org_a', :'gsem', current_date - 3, 'ligacao', 3),
  (:'org_b', :'cb', current_date - 3, 'ligacao', 199);
-- Super admin da plataforma em "Entrar como" na A (sessão de contexto válida).
INSERT INTO public.platform_admins (user_id) VALUES (:'plat');
INSERT INTO auth.sessions (id, user_id) VALUES (:'psid', :'plat');
INSERT INTO public.platform_org_context_sessions (actor_user_id, auth_session_id, organization_id, expires_at)
  VALUES (:'plat', :'psid', :'org_a', now() + interval '1 hour');
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
\set eq 'SELECT coalesce(array_agg(user_id ORDER BY user_id::text), ''{}'') FROM public.carreira_plano_equipe(2027)'

-- ============ (a) meu_plano_ve_imobiliaria confere a imobiliária do papel =======================================
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(public.meu_plano_ve_imobiliaria(:'admin'), '(a) admin da propria imobiliaria tem a visao ampla');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano WHERE organization_id = :'org_a') = 3,
  '(a) admin le os 3 planos da imobiliaria (RLS carreira_plano_ler)');
SELECT pg_temp.as_user(:'dono');
SELECT pg_temp.ok(public.meu_plano_ve_imobiliaria(:'dono'), '(a) super_admin (dono) da propria imobiliaria tem a visao ampla');

SELECT pg_temp.as_user(:'xadm');
SELECT pg_temp.ok(NOT public.meu_plano_ve_imobiliaria(:'xadm'),
  '(a) admin de OUTRA imobiliaria NAO tem a visao ampla aqui');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano WHERE organization_id = :'org_a') = 0,
  '(a) admin de outra imobiliaria NAO le os planos daqui (RLS)');
-- Recusa (42501) OU lista vazia: o que importa é não receber ninguém daqui. (meu_plano_eh_broker também não confere a
-- imobiliária do papel, então ele entra como "gestor sem equipe" e recebe lista vazia; registrado no PR.)
SELECT pg_temp.ok(pg_temp.err(:'eq') LIKE '42501%'
  OR (SELECT count(*) FROM public.carreira_plano_equipe(2027)) = 0,
  '(a) admin de outra imobiliaria NAO ve ninguem nos Planos 2027 da equipe');
SELECT pg_temp.ok(pg_temp.err('SELECT public.carreira_diario_equipe_semana(2027)') LIKE '42501%'
  OR (SELECT count(*) FROM public.carreira_diario_equipe_semana(2027)) = 0,
  '(a) admin de outra imobiliaria NAO ve ninguem no Diario da equipe');
SELECT pg_temp.ok(NOT public.gestao_pode_ver(:'c1') AND NOT public.gestao_pode_ver(:'c3'),
  '(a) admin de outra imobiliaria NAO ve corretores na Inteligencia de gestao');
SELECT pg_temp.ok(pg_temp.err('SELECT public.gestao_farol_dados(2027)') LIKE '42501%'
  OR cardinality(pg_temp.pessoas(public.gestao_farol_dados(2027))) = 0,
  '(a) admin de outra imobiliaria NAO ve ninguem no farol da imobiliaria');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.carreira_plano_assinar_broker(%L, 2027)', :'c3')) LIKE '42501%',
  '(a) admin de outra imobiliaria NAO assina o pacto daqui');

SELECT pg_temp.as_user(:'adb');
SELECT pg_temp.ok(public.meu_plano_ve_imobiliaria(:'adb'), '(a) admin da B continua com a visao ampla na B');
SELECT pg_temp.ok(pg_temp.err(:'eq') IS NULL, '(a) admin da B abre os Planos 2027 da B');

SELECT pg_temp.as_user(:'plat', :'psid');
SELECT pg_temp.ok(public.meu_plano_ve_imobiliaria(:'plat'),
  '(a) super admin da plataforma em "Entrar como" continua com a visao ampla');

SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(NOT public.meu_plano_ve_imobiliaria(:'gestor'), '(a) gestor com equipe NAO tem a visao ampla');
SELECT pg_temp.ok(pg_temp.err(:'eq') IS NULL, '(a) gestor com equipe abre os Planos 2027');
SELECT pg_temp.as_user(:'gsem');
SELECT pg_temp.ok(NOT public.meu_plano_ve_imobiliaria(:'gsem'), '(a) gestor sem equipe NAO tem a visao ampla');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(NOT public.meu_plano_ve_imobiliaria(:'tl'), '(a) TL NAO tem a visao ampla');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(NOT public.meu_plano_ve_imobiliaria(:'c1')
  AND (SELECT count(*) FROM public.carreira_plano WHERE organization_id = :'org_a') = 1,
  '(a) corretor NAO tem a visao ampla e le so o proprio plano');

-- ============ (b) farol de quem está sem equipe: sem totais da imobiliária =======================================
SELECT pg_temp.as_user(:'c3');
SELECT pg_temp.ok(pg_temp.lig_eq(public.gestao_farol_dados(2027, :'c3'), :'c3') = 7,
  '(b) corretor sem equipe: comparacao = so os proprios numeros (7), nao a soma da imobiliaria (160)');
SELECT pg_temp.ok(pg_temp.pessoas(public.gestao_farol_dados(2027, :'c3')) = ARRAY[:'c3']::uuid[],
  '(b) corretor sem equipe: o proprio farol traz so ele');
SELECT pg_temp.ok(pg_temp.err('SELECT public.gestao_farol_dados(2027)') LIKE '42501%',
  '(b) corretor sem equipe continua sem o farol da equipe');

SELECT pg_temp.as_user(:'gsem');
SELECT pg_temp.ok(pg_temp.lig_eq(public.gestao_farol_dados(2027, :'gsem'), :'gsem') = 3,
  '(b) gestor sem equipe: proprio farol compara so com ele mesmo (3)');
SELECT pg_temp.ok(cardinality(pg_temp.pessoas(public.gestao_farol_dados(2027))) = 0,
  '(b) gestor sem equipe: farol da equipe continua vazio, sem erro');

SELECT pg_temp.as_user(:'xadm');
SELECT pg_temp.ok(pg_temp.lig_eq(public.gestao_farol_dados(2027, :'xadm'), :'xadm') = 0,
  '(b) admin de outra imobiliaria, sem equipe aqui: nao recebe a soma da imobiliaria');

SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.lig_eq(public.gestao_farol_dados(2027, :'c1'), :'c1') = 100,
  '(b) corretor com equipe: comparacao = a equipe (sem mudanca)');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.lig_eq(public.gestao_farol_dados(2027, :'tl'), :'tl') = 50,
  '(b) TL: comparacao = a propria equipe (sem mudanca)');
SELECT pg_temp.ok(pg_temp.pessoas(public.gestao_farol_dados(2027)) = ARRAY[:'c2']::uuid[],
  '(b) TL: farol da equipe so com a equipe dele (sem mudanca)');
SELECT pg_temp.as_user(:'gestor');
-- O gestor lidera a eqg mas não é membro dela: no próprio farol compara com a equipe que lidera (100), não com a
-- imobiliária (160) nem só consigo (0). Regra gestor/TL = leads_team_or_parent.
SELECT pg_temp.ok(pg_temp.lig_eq(public.gestao_farol_dados(2027, :'gestor'), :'gestor') = 100,
  '(b) gestor que lidera sem ser membro: proprio farol compara com a equipe que lidera (100)');
SELECT pg_temp.ok(pg_temp.pessoas(public.gestao_farol_dados(2027)) = ARRAY[:'c1']::uuid[]
  AND pg_temp.lig_eq(public.gestao_farol_dados(2027), :'c1') = 100,
  '(b) gestor com equipe: farol so da equipe dele (sem mudanca)');

SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.lig_eq(public.gestao_farol_dados(2027), :'c3') = 160,
  '(b) admin: corretor sem equipe continua comparado com a imobiliaria (160)');
SELECT pg_temp.ok(pg_temp.lig_eq(public.gestao_farol_dados(2027, :'c3'), :'c3') = 160,
  '(b) admin abrindo o farol do corretor sem equipe: soma da imobiliaria (sem mudanca)');
SELECT pg_temp.ok(pg_temp.pessoas(public.gestao_farol_dados(2027)) @> ARRAY[:'c1', :'c2', :'c3']::uuid[],
  '(b) admin ve a imobiliaria toda no farol (sem mudanca)');
SELECT pg_temp.as_user(:'dono');
SELECT pg_temp.ok(pg_temp.lig_eq(public.gestao_farol_dados(2027), :'c3') = 160,
  '(b) super_admin (dono): mesma visao do admin');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
