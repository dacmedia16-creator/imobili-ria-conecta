-- Suíte da migration 20261108160000 (Meta x atividades: V1/V2/Visita com comprador + visão do gestor/TL).
-- Roda DENTRO de transação revertida (run-meta-atividades-diario.sh). Dados fictícios só na transação.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0). Perfis: corretor A1 (UE Corretor, membro da
-- "Equipe UE"), corretor A2 (QA A Corretor Um), corretor A3 (QA A Corretor Tres), gestor A (UE Gestor),
-- admin A (QA A Admin), corretor B1 (QA B Corretor Um). TL fictício: A2 vira team_leader de uma equipe nova
-- só com A3.
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
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.as_user(text), pg_temp.id(text)
  TO authenticated;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('a2', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('a3', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('ga', '10000000-0000-4000-8000-000000000002'),
  ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'),
  ('eqUE', '1a000000-0000-4000-8000-000000000001');
CREATE TEMP TABLE d AS SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje,
  date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo')::date AS seg,
  date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date AS mes;
GRANT SELECT ON d TO authenticated;

-- Registros antigos de 'visita' (antes da mudança): não podem mudar.
INSERT INTO public.carreira_diario (organization_id, user_id, dia, tipo, quantidade)
VALUES (pg_temp.id('orgA'), pg_temp.id('a1'), (SELECT hoje FROM d), 'visita', 3);
CREATE TEMP TABLE antigos AS SELECT md5(string_agg(x::text, ',' ORDER BY x.id)) h, count(*) n
  FROM public.carreira_diario x WHERE x.tipo = 'visita';

-- Liga o Meu Plano 2027 só na imobiliária A (na transação).
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'meu_plano_2027', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
DELETE FROM public.organization_modules WHERE organization_id = pg_temp.id('orgB') AND module = 'meu_plano_2027';

-- TL fictício: A2 vira team_leader e lidera "Equipe TL Teste" só com A3 (contexto do admin A).
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('a2'), 'team_leader', pg_temp.id('orgA'));
INSERT INTO public.teams (id, organization_id, nome, lider_id)
VALUES ('3b000000-0000-4000-8000-0000000000e1', pg_temp.id('orgA'), 'Equipe TL Teste', pg_temp.id('a2'));
INSERT INTO ids VALUES ('eqTL', '3b000000-0000-4000-8000-0000000000e1');
DELETE FROM public.team_members WHERE membro_id = pg_temp.id('a3');
INSERT INTO public.team_members (team_id, membro_id, organization_id) VALUES (pg_temp.id('eqTL'), pg_temp.id('a3'), pg_temp.id('orgA'));

-- Plano de A1 com a cópia das metas (ms.*) e um gasto pessoal (op.0) que o TL não pode ver.
INSERT INTO public.carreira_plano (organization_id, user_id, ano, respostas)
VALUES (pg_temp.id('orgA'), pg_temp.id('a1'), 2027,
  '{"op.0":"3450","ms.lig":12,"ms.v1":4,"ms.v2":3,"ms.capt":2,"ms.ligMes":48,"ms.v1Mes":13,"ms.v2Mes":11}'),
  (pg_temp.id('orgA'), pg_temp.id('a3'), 2027,
  '{"op.0":"999","ms.lig":10,"ms.v1":3,"ms.v2":2,"ms.capt":1,"ms.ligMes":40,"ms.v1Mes":10,"ms.v2Mes":6}');

-- 1) Tipos novos e 'visita' antigo ---------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo, quantidade) VALUES (''ligacao'', 9)') IS NULL
  AND pg_temp.err('INSERT INTO public.carreira_diario (tipo, quantidade) VALUES (''v1'', 2)') IS NULL
  AND pg_temp.err('INSERT INTO public.carreira_diario (tipo, quantidade) VALUES (''v2'', 1)') IS NULL
  AND pg_temp.err('INSERT INTO public.carreira_diario (tipo, quantidade) VALUES (''acm'', 1)') IS NULL
  AND pg_temp.err('INSERT INTO public.carreira_diario (tipo, quantidade) VALUES (''visita_comprador'', 5)') IS NULL,
  'A1 registra ligação, V1, V2, ACM e Visita com comprador');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo) VALUES (''visita'')') LIKE '22023%V1, V2 ou Visita com comprador%',
  'novo registro "visita" é recusado onde o Meu Plano está ligado');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo) VALUES (''cafe'')') LIKE '23514%',
  'tipo desconhecido continua recusado');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_diario WHERE tipo = 'visita') = 1,
  'A1 continua lendo o registro antigo "visita"');

CREATE TEMP TABLE c1 AS SELECT * FROM public.meu_diario_contagens();
SELECT pg_temp.ok((SELECT array_agg(tipo ORDER BY tipo) FROM c1)
  = ARRAY['acm', 'captacao', 'ligacao', 'v1', 'v2', 'visita', 'visita_comprador'],
  'contagens trazem ligação, V1, V2, ACM, comprador, visita antiga e captação');
SELECT pg_temp.ok((SELECT semana FROM c1 WHERE tipo = 'ligacao') = 9 AND (SELECT semana FROM c1 WHERE tipo = 'v1') = 2
  AND (SELECT semana FROM c1 WHERE tipo = 'v2') = 1 AND (SELECT semana FROM c1 WHERE tipo = 'acm') = 1
  AND (SELECT semana FROM c1 WHERE tipo = 'visita_comprador') = 5,
  'semana de A1: 9 ligações, 2 V1, 1 V2, 1 ACM, 5 com comprador');
SELECT pg_temp.ok((SELECT semana FROM c1 WHERE tipo = 'visita') = 3
  AND (SELECT semana FROM c1 WHERE tipo = 'v1') + (SELECT semana FROM c1 WHERE tipo = 'v2') = 3,
  'visita antiga (3) aparece separada e não soma em V1/V2');
RESET ROLE;
SELECT pg_temp.ok((SELECT semana FROM c1 WHERE tipo = 'captacao') = (
  SELECT count(*) FROM public.exclusive_captures c
   WHERE c.organization_id = pg_temp.id('orgA') AND coalesce(c.captador_original_id, c.captor_id) = pg_temp.id('a1')
     AND c.status = 'aprovada' AND c.discarded_at IS NULL
     AND coalesce(c.signed_on, public.exclusive_aprovada_em(c.id)) BETWEEN (SELECT seg FROM d) AND (SELECT hoje FROM d)),
  'captações da semana = captações aprovadas de A1 assinadas na semana');

-- 2) Imobiliária sem o módulo: diário segue igual ----------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo) VALUES (''visita'')') IS NULL,
  'imobiliária B (sem Meu Plano) ainda registra "visita"');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.carreira_diario (tipo) VALUES (''v1'')') LIKE '22023%'
  AND pg_temp.err('INSERT INTO public.carreira_diario (tipo) VALUES (''visita_comprador'')') LIKE '22023%',
  'imobiliária B (sem Meu Plano) não grava os tipos novos (o gestor de lá não os veria)');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_diario_equipe_semana(2027)') LIKE '42501%',
  'imobiliária B (sem módulo) não abre a visão de metas da equipe');

-- 3) Corretor não vê a equipe ---------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_diario_equipe_semana(2027)') LIKE '42501%',
  'corretor não vê feito x meta da equipe');

-- 4) Gestor: a imobiliária inteira, com respostas -----------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
CREATE TEMP TABLE eg AS SELECT * FROM public.carreira_diario_equipe_semana(2027);
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM eg WHERE user_id = pg_temp.id('a1'))
  AND EXISTS (SELECT 1 FROM eg WHERE user_id = pg_temp.id('a3'))
  AND NOT EXISTS (SELECT 1 FROM eg WHERE user_id = pg_temp.id('b1'))
  AND NOT EXISTS (SELECT 1 FROM eg WHERE user_id = pg_temp.id('ga')),
  'gestor A vê corretores da imobiliária A (sem ele mesmo e sem a B)');
SELECT pg_temp.ok((SELECT lig_sem = 9 AND v1_sem = 2 AND v2_sem = 1 AND acm_sem = 1 AND comprador_sem = 5
                     AND antigas_mes = (CASE WHEN (SELECT hoje >= mes FROM d) THEN 3 ELSE 0 END)
                     AND (metas->>'ms.lig')::int = 12 AND (metas->>'ms.v2')::int = 3
                     AND respostas->>'op.0' = '3450' FROM eg WHERE user_id = pg_temp.id('a1')),
  'linha de A1 para o gestor: feito da semana, visita antiga à parte, metas e plano');
SELECT pg_temp.ok((SELECT metas IS NULL AND respostas IS NULL FROM eg WHERE user_id = pg_temp.id('a2')),
  'corretor sem plano vem com metas nulas (tela mostra "sem plano")');

-- 5) Team leader: só a própria equipe, sem respostas -------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
CREATE TEMP TABLE et AS SELECT * FROM public.carreira_diario_equipe_semana(2027);
SELECT pg_temp.ok((SELECT array_agg(user_id) FROM et) = ARRAY[pg_temp.id('a3')],
  'TL vê só a própria equipe (A3), não A1 da outra equipe');
SELECT pg_temp.ok((SELECT respostas IS NULL AND (metas->>'ms.lig')::int = 10 AND NOT metas ? 'op.0' FROM et),
  'TL recebe só a cópia das metas, nunca as respostas do plano');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_diario WHERE user_id = pg_temp.id('a1')) = 0,
  'TL não lê o diário de corretor de outra equipe pela tabela');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano WHERE user_id = pg_temp.id('a3')) = 0,
  'TL não lê o plano do membro pela tabela (RLS do plano inalterada)');

-- 6) Admin vê; outra imobiliária não ------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_diario_equipe_semana(2027) WHERE user_id IN (pg_temp.id('a1'), pg_temp.id('a3'))) = 2,
  'admin A vê os corretores da imobiliária A');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_diario_equipe_semana(1999)') LIKE '22023%',
  'ano inválido é recusado');

-- 7) Sem login / anon ----------------------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.carreira_diario_equipe_semana(2027)') LIKE '42501%', 'sem login: recusado');
RESET ROLE;
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.carreira_diario_equipe_semana(integer)', 'EXECUTE'),
  'anon não executa a visão da equipe');
SELECT pg_temp.ok((SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
  WHERE oid = 'public.carreira_diario_equipe_semana(integer)'::regprocedure), 'SECURITY DEFINER com search_path vazio');

-- 8) Registros antigos intactos; sem pontos ------------------------------------------------------------------
SELECT pg_temp.ok((SELECT h FROM antigos) = (SELECT md5(string_agg(x::text, ',' ORDER BY x.id))
  FROM public.carreira_diario x WHERE x.tipo = 'visita' AND x.organization_id = pg_temp.id('orgA'))
  OR (SELECT n FROM antigos) = (SELECT count(*) FROM public.carreira_diario x WHERE x.tipo = 'visita' AND x.organization_id = pg_temp.id('orgA')),
  'registros antigos "visita" não foram alterados');
SELECT pg_temp.ok(pg_get_function_result('public.carreira_ranking(date,date)'::regprocedure) NOT ILIKE '%diario%'
  AND pg_get_function_result('public.carreira_diario_equipe_semana(integer)'::regprocedure) NOT ILIKE '%ponto%',
  'sem pontos e ranking intacto');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
