-- Suíte da migration 20261230120000 (t_a897136b): líder sem equipe vigente cai na equipe que lidera no painel
-- Metas 2027 · Equipes. Transação revertida (run-metas-lider-sem-equipe.sh), homologação; nunca produção.
-- Dados fictícios. Pessoas:
--   lsem = gestor (sem team_leader) que lidera eqL, equipe SEM membros e SEM histórico (caso da Aline);
--   tl   = team_leader de eqT (com c1 e tl como membros e histórico);
--   gdup = gestor que lidera eqX mas JÁ tem equipe vigente eqT pelo histórico (a vigente tem de continuar valendo);
--   c3   = corretor sem equipe e sem liderar nada (continua "Sem equipe");
--   eqB  = equipe de OUTRA imobiliária liderada pela lsem (não pode ser usada na imobiliária A).
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
-- team_id (texto; '' = sem equipe) da pessoa no JSON de metas_equipe_planos; quantas vezes ela aparece.
CREATE FUNCTION pg_temp.eq(_j jsonb, _u uuid) RETURNS text LANGUAGE sql AS
  $$ SELECT coalesce(min(coalesce(x ->> 'team_id', '')), 'AUSENTE') FROM jsonb_array_elements(_j -> 'pessoas') x
      WHERE (x ->> 'user_id')::uuid = _u $$;
CREATE FUNCTION pg_temp.vezes(_j jsonb, _u uuid) RETURNS int LANGUAGE sql AS
  $$ SELECT count(*)::int FROM jsonb_array_elements(_j -> 'pessoas') x WHERE (x ->> 'user_id')::uuid = _u $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a4000000-0000-4000-8000-0000000000a0'
\set org_b 'b4000000-0000-4000-8000-0000000000b0'
\set admin 'a4000000-0000-4000-8000-000000000001'
\set lsem 'a4000000-0000-4000-8000-000000000002'
\set tl 'a4000000-0000-4000-8000-000000000003'
\set gdup 'a4000000-0000-4000-8000-000000000004'
\set c1 'a4000000-0000-4000-8000-000000000005'
\set c3 'a4000000-0000-4000-8000-000000000006'
\set gb 'b4000000-0000-4000-8000-000000000001'
\set eql 'a4000000-0000-4000-8000-00000000e001'
\set eqt 'a4000000-0000-4000-8000-00000000e002'
\set eqx 'a4000000-0000-4000-8000-00000000e003'
\set eqb 'b4000000-0000-4000-8000-00000000e001'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:'org_a', 'teste-lse-a', 'Imobiliaria LSE A', 'ativa'),
  (:'org_b', 'teste-lse-b', 'Imobiliaria LSE B', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'lsem', :'tl', :'gdup', :'c1', :'c3', :'gb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Adm LSE', 'adm@lse.test', true, :'org_a'),
  (:'lsem', 'Lider Sem Equipe LSE', 'lsem@lse.test', true, :'org_a'),
  (:'tl', 'TL LSE', 'tl@lse.test', true, :'org_a'),
  (:'gdup', 'Gestor Com Vigente LSE', 'gdup@lse.test', true, :'org_a'),
  (:'c1', 'Ana Do TL LSE', 'c1@lse.test', true, :'org_a'),
  (:'c3', 'Caio Sem Equipe LSE', 'c3@lse.test', true, :'org_a'),
  (:'gb', 'Gestor B LSE', 'gb@lse.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo)
  SELECT :'org_a'::uuid, unnest(ARRAY[:'admin', :'lsem', :'tl', :'gdup', :'c1', :'c3']::uuid[]), true
  UNION ALL SELECT :'org_b'::uuid, :'gb'::uuid, true;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'lsem', 'gestor', :'org_a'),
  (:'tl', 'team_leader', :'org_a'), (:'tl', 'corretor', :'org_a'),
  (:'gdup', 'gestor', :'org_a'), (:'c1', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'),
  (:'gb', 'gestor', :'org_b');
-- eqB (outra imobiliária) é a MAIS ANTIGA liderada pela lsem: não pode ser escolhida na imobiliária A.
INSERT INTO public.teams (id, nome, organization_id, lider_id, created_at) VALUES
  (:'eqb', 'Equipe B LSE', :'org_b', :'lsem', now() - interval '90 days'),
  (:'eql', 'Equipe Lider Sem Equipe LSE', :'org_a', :'lsem', now() - interval '60 days'),
  (:'eqt', 'Equipe TL LSE', :'org_a', :'tl', now() - interval '60 days'),
  (:'eqx', 'Equipe X LSE', :'org_a', :'gdup', now() - interval '60 days');
INSERT INTO public.team_members (team_id, membro_id, organization_id) VALUES
  (:'eqt', :'c1', :'org_a'), (:'eqt', :'tl', :'org_a'), (:'eqt', :'gdup', :'org_a');
INSERT INTO public.team_membership_history (membro_id, team_id, vigente_de, origem, organization_id) VALUES
  (:'c1', :'eqt', now() - interval '30 days', 'team_members', :'org_a'),
  (:'tl', :'eqt', now() - interval '30 days', 'team_members', :'org_a'),
  (:'gdup', :'eqt', now() - interval '30 days', 'team_members', :'org_a');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'meu_plano_2027', true) ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
SET LOCAL session_replication_role = origin;

-- Pré-condição: o caso existe (equipe_vigente NULL para lsem; papéis e equipes intactos).
SELECT pg_temp.ok(public.equipe_vigente(:'lsem', now()) IS NULL, 'pre: equipe_vigente da lsem e NULL (caso da Aline)');
SELECT pg_temp.ok(public.equipe_vigente(:'gdup', now()) = :'eqt', 'pre: gdup tem equipe vigente eqT pelo historico');

SET LOCAL ROLE authenticated;

-- ============ admin (vê a imobiliária toda) ====================================================================
SELECT pg_temp.as_user(:'admin');
CREATE TEMP TABLE m_adm AS SELECT public.metas_equipe_planos(2027) j;
SELECT pg_temp.ok(pg_temp.eq((SELECT j FROM m_adm), :'lsem') = :'eql',
  'admin: lider sem equipe vigente cai na equipe que lidera (eqL)');
SELECT pg_temp.ok(pg_temp.vezes((SELECT j FROM m_adm), :'lsem') = 1, 'admin: lider aparece 1 vez so (Todas nao duplica)');
SELECT pg_temp.ok(pg_temp.eq((SELECT j FROM m_adm), :'gdup') = :'eqt',
  'admin: quem ja tem equipe vigente continua nela (gdup em eqT, nao na eqX que lidera)');
SELECT pg_temp.ok(pg_temp.eq((SELECT j FROM m_adm), :'c3') = '', 'admin: corretor sem equipe continua em Sem equipe');
SELECT pg_temp.ok(pg_temp.eq((SELECT j FROM m_adm), :'c1') = :'eqt', 'admin: corretor da equipe do TL continua em eqT');
-- 5 = lsem, tl, gdup, c1, c3 (o admin não tem papel de venda e não entra no painel, antes e depois).
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements((SELECT j FROM m_adm) -> 'pessoas')) = 5,
  'admin: mesmas 5 pessoas no total (ninguem entra nem sai)');
SELECT pg_temp.ok((SELECT jsonb_agg(x ->> 'user_id') FROM jsonb_array_elements(public.metas_equipe_planos(2027, :'eql') -> 'pessoas') x)
  = jsonb_build_array(:'lsem'), 'admin: aba da eqL mostra o lider');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.metas_equipe_planos(2027, :'eqx') -> 'pessoas') x
  WHERE (x ->> 'user_id')::uuid = :'gdup'), 'admin: aba da eqX NAO puxa o gdup (vigente manda)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.metas_equipe_realizado(current_date - 30, current_date, %L)', :'eql')) IS NULL,
  'admin: realizado da eqL abre sem erro');

-- ============ a própria líder (gestor sem team_leader) ==========================================================
SELECT pg_temp.as_user(:'lsem');
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_equipe_planos(2027)') IS NULL, 'lider: painel abre sem erro');
SELECT pg_temp.ok(pg_temp.eq(public.metas_equipe_planos(2027), :'lsem') = :'eql', 'lider: se ve na propria equipe');
SELECT pg_temp.ok(pg_temp.eq(public.metas_equipe_planos(2027), :'c1') = 'AUSENTE', 'lider: NAO ve a equipe do TL');

-- ============ TL de outra equipe: nada muda =====================================================================
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.eq(public.metas_equipe_planos(2027), :'lsem') = 'AUSENTE', 'tl: NAO ve a lider da eqL');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.metas_equipe_planos(2027, %L)', :'eql')) LIKE '42501%',
  'tl: pedir a eqL e recusado (42501)');

-- ============ outra imobiliária =================================================================================
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.eq(public.metas_equipe_planos(2027), :'lsem') = 'AUSENTE', 'outra imobiliaria: NAO ve a lider');

RESET ROLE;
-- Nada de papel/equipe mudou.
SELECT pg_temp.ok((SELECT array_agg(role::text) FROM public.user_roles WHERE user_id = :'lsem') = ARRAY['gestor'],
  'dados: papeis da lider intactos');
SELECT pg_temp.ok((SELECT count(*) FROM public.teams WHERE lider_id = :'lsem') = 2
  AND (SELECT count(*) FROM public.team_members WHERE team_id = :'eql') = 0, 'dados: equipes intactas');
SELECT pg_temp.ok(public.equipe_vigente(:'lsem', now()) IS NULL, 'nao mexido: equipe_vigente da lider continua NULL');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
