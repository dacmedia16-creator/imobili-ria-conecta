-- Suíte "Baixar meu plano em PDF" (migration 20261119120000, t_65edd0b0): quem consegue LER cada plano.
-- O PDF é montado no navegador só com o que a RLS devolve; então provar a leitura = provar quem baixa.
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
-- Quantos planos 2027 a pessoa logada consegue ler, entre os ids informados.
CREATE FUNCTION pg_temp.le(_ids uuid[]) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.carreira_plano WHERE ano = 2027 AND user_id = ANY(_ids) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a1000000-0000-4000-8000-0000000000a0'
\set org_b 'b1000000-0000-4000-8000-0000000000b0'
\set admin 'a1000000-0000-4000-8000-000000000001'
\set gestor 'a1000000-0000-4000-8000-000000000002'
\set tl 'a1000000-0000-4000-8000-000000000003'
\set tl2 'a1000000-0000-4000-8000-000000000004'
\set c1 'a1000000-0000-4000-8000-000000000005'
\set c2 'a1000000-0000-4000-8000-000000000006'
\set c3 'a1000000-0000-4000-8000-000000000007'
\set gb 'b1000000-0000-4000-8000-000000000001'
\set tlb 'b1000000-0000-4000-8000-000000000002'
\set cb 'b1000000-0000-4000-8000-000000000003'
\set eq1 'a1000000-0000-4000-8000-00000000e001'
\set eq2 'a1000000-0000-4000-8000-00000000e002'
\set eqb 'b1000000-0000-4000-8000-00000000e001'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:'org_a', 'teste-pdf-a', 'Imobiliaria PDF A', 'ativa'),
  (:'org_b', 'teste-pdf-b', 'Imobiliaria PDF B', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'tl', :'tl2', :'c1', :'c2', :'c3', :'gb', :'tlb', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Dona PDF', 'dona@pdf.test', true, :'org_a'),
  (:'gestor', 'Gil PDF', 'gestor@pdf.test', true, :'org_a'),
  (:'tl', 'Lia Lider', 'tl@pdf.test', true, :'org_a'),
  (:'tl2', 'Leo Lider', 'tl2@pdf.test', true, :'org_a'),
  (:'c1', 'Ana Equipe1', 'c1@pdf.test', true, :'org_a'),
  (:'c2', 'Bia Equipe2', 'c2@pdf.test', true, :'org_a'),
  (:'c3', 'Caio Sem Equipe', 'c3@pdf.test', true, :'org_a'),
  (:'gb', 'Gestor B', 'gb@pdf.test', true, :'org_b'),
  (:'tlb', 'Lider B', 'tlb@pdf.test', true, :'org_b'),
  (:'cb', 'Corretor B', 'cb@pdf.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo)
  SELECT :'org_a'::uuid, unnest(ARRAY[:'admin', :'gestor', :'tl', :'tl2', :'c1', :'c2', :'c3']::uuid[]), true
  UNION ALL SELECT :'org_b'::uuid, unnest(ARRAY[:'gb', :'tlb', :'cb']::uuid[]), true;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'gestor', 'gestor', :'org_a'),
  (:'tl', 'team_leader', :'org_a'), (:'tl', 'corretor', :'org_a'),
  (:'tl2', 'team_leader', :'org_a'), (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'),
  (:'c3', 'corretor', :'org_a'), (:'gb', 'gestor', :'org_b'), (:'tlb', 'team_leader', :'org_b'),
  (:'cb', 'corretor', :'org_b');
INSERT INTO public.teams (id, nome, organization_id, lider_id) VALUES
  (:'eq1', 'Equipe PDF 1', :'org_a', :'tl'), (:'eq2', 'Equipe PDF 2', :'org_a', :'tl2'),
  (:'eqb', 'Equipe PDF B', :'org_b', :'tlb');
INSERT INTO public.team_members (team_id, membro_id, organization_id) VALUES
  (:'eq1', :'c1', :'org_a'), (:'eq1', :'tl', :'org_a'), (:'eq2', :'c2', :'org_a'), (:'eqb', :'cb', :'org_b');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'meu_plano_2027', true), (:'org_b', 'meu_plano_2027', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.carreira_plano (organization_id, user_id, ano, trilha, respostas) VALUES
  (:'org_a', :'tl', 2027, 'ativacao', '{"pq.frase":"do lider"}'),
  (:'org_a', :'c1', 2027, 'planejamento', '{"pq.frase":"da Ana"}'),
  (:'org_a', :'c2', 2027, 'ativacao', '{"pq.frase":"da Bia"}'),
  (:'org_a', :'c3', 2027, 'ativacao', '{"pq.frase":"do Caio"}'),
  (:'org_b', :'cb', 2027, 'planejamento', '{"pq.frase":"de B"}');
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;

-- 1) Corretor: só o próprio --------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c1']::uuid[]) = 1, 'corretor le o proprio plano');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c2', :'c3', :'tl', :'cb']::uuid[]) = 0, 'corretor NAO le plano de colega, do lider nem de outra imobiliaria');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_plano_equipe(2027)') LIKE '42501%', 'corretor NAO abre a lista da equipe');

-- 2) Team leader: só a própria equipe ------------------------------------------------------------------------
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c1']::uuid[]) = 1, 'TL le o plano do corretor da propria equipe');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'tl']::uuid[]) = 1, 'TL le o proprio plano');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c2']::uuid[]) = 0, 'TL NAO le corretor de OUTRA equipe');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c3']::uuid[]) = 0, 'TL NAO le corretor sem equipe');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'cb']::uuid[]) = 0, 'TL NAO le plano de outra imobiliaria');
SELECT pg_temp.ok((SELECT array_agg(user_id ORDER BY user_id) FROM public.carreira_plano_equipe(2027)) = ARRAY[:'c1']::uuid[],
  'lista da equipe do TL = so os membros da equipe dele (sem ele mesmo)');
SELECT pg_temp.ok((SELECT respostas->>'pq.frase' FROM public.carreira_plano_equipe(2027)) = 'da Ana', 'lista do TL traz as respostas do membro');
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.carreira_plano SET respostas = %L WHERE user_id = %L', '{}', :'c1')) LIKE '42501%',
  'TL NAO grava no plano do membro (sem UPDATE)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.carreira_plano_assinar_broker(%L, 2027)', :'c1')) LIKE '42501%',
  'TL NAO assina o pacto como broker');
SELECT pg_temp.as_user(:'tl2');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c2']::uuid[]) = 1 AND pg_temp.le(ARRAY[:'c1', :'tl']::uuid[]) = 0,
  'TL2 le so a equipe 2 (nao a equipe 1 nem o TL1)');

-- 3) Gestor e admin: a imobiliária toda, nada de fora -------------------------------------------------------
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'tl', :'c1', :'c2', :'c3']::uuid[]) = 4, 'gestor le todos os planos da imobiliaria');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'cb']::uuid[]) = 0, 'gestor NAO le plano de outra imobiliaria');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano_equipe(2027) WHERE user_id IN (:'c1', :'c2', :'c3', :'tl')) = 4,
  'lista do gestor continua com a imobiliaria toda');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'tl', :'c1', :'c2', :'c3']::uuid[]) = 4, 'admin le todos os planos da imobiliaria');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'cb']::uuid[]) = 0, 'admin NAO le plano de outra imobiliaria');

-- 4) Outra imobiliária: gestor e TL de B não alcançam A ------------------------------------------------------
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'cb']::uuid[]) = 1, 'gestor B le o plano de B');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'tl', :'c1', :'c2', :'c3']::uuid[]) = 0, 'gestor B NAO le nenhum plano de A');
SELECT pg_temp.as_user(:'tlb');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'cb']::uuid[]) = 1, 'TL B le o membro da equipe B');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'tl', :'c1', :'c2', :'c3']::uuid[]) = 0, 'TL B NAO le nenhum plano de A');
SELECT pg_temp.ok(public.meu_plano_lider_ve(:'c1') = false, 'meu_plano_lider_ve: TL B x corretor de A = false');

-- 5) Travas: módulo desligado e líder inativo ----------------------------------------------------------------
RESET ROLE;
UPDATE public.organization_modules SET enabled = false WHERE organization_id = :'org_a' AND module = 'meu_plano_2027';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c1']::uuid[]) = 0, 'modulo desligado: TL nao le nada');
RESET ROLE;
UPDATE public.organization_modules SET enabled = true WHERE organization_id = :'org_a' AND module = 'meu_plano_2027';
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET ativo = false WHERE id = :'tl';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.le(ARRAY[:'c1']::uuid[]) = 0, 'TL inativo nao le o plano da equipe');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(public.meu_plano_lider_ve(:'c1') = false, 'corretor comum: meu_plano_lider_ve = false');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
