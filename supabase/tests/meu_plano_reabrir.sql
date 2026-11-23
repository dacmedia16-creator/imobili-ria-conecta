-- Suíte "Reabrir plano" (migration 20261209130000, t_495e4305): quem reabre, o que muda e o que NÃO muda.
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a2000000-0000-4000-8000-0000000000a0'
\set org_b 'b2000000-0000-4000-8000-0000000000b0'
\set admin 'a2000000-0000-4000-8000-000000000001'
\set gestor 'a2000000-0000-4000-8000-000000000002'
\set tl 'a2000000-0000-4000-8000-000000000003'
\set tl2 'a2000000-0000-4000-8000-000000000004'
\set c1 'a2000000-0000-4000-8000-000000000005'
\set c2 'a2000000-0000-4000-8000-000000000006'
\set c3 'a2000000-0000-4000-8000-000000000007'
\set c4 'a2000000-0000-4000-8000-000000000008'
\set ab 'b2000000-0000-4000-8000-000000000001'
\set cb 'b2000000-0000-4000-8000-000000000003'
\set eq1 'a2000000-0000-4000-8000-00000000e001'
\set eq2 'a2000000-0000-4000-8000-00000000e002'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:'org_a', 'teste-reabrir-a', 'Imobiliaria Reabrir A', 'ativa'),
  (:'org_b', 'teste-reabrir-b', 'Imobiliaria Reabrir B', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'tl', :'tl2', :'c1', :'c2', :'c3', :'c4', :'ab', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Dona Reabrir', 'dona@reabrir.test', true, :'org_a'),
  (:'gestor', 'Gil Reabrir', 'gestor@reabrir.test', true, :'org_a'),
  (:'tl', 'Lia Lider', 'tl@reabrir.test', true, :'org_a'),
  (:'tl2', 'Leo Lider', 'tl2@reabrir.test', true, :'org_a'),
  (:'c1', 'Ana Equipe1', 'c1@reabrir.test', true, :'org_a'),
  (:'c2', 'Bia Equipe2', 'c2@reabrir.test', true, :'org_a'),
  (:'c3', 'Caio Sem Equipe', 'c3@reabrir.test', true, :'org_a'),
  (:'c4', 'Duda Rascunho', 'c4@reabrir.test', true, :'org_a'),
  (:'ab', 'Admin B', 'ab@reabrir.test', true, :'org_b'),
  (:'cb', 'Corretor B', 'cb@reabrir.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo)
  SELECT :'org_a'::uuid, unnest(ARRAY[:'admin', :'gestor', :'tl', :'tl2', :'c1', :'c2', :'c3', :'c4']::uuid[]), true
  UNION ALL SELECT :'org_b'::uuid, unnest(ARRAY[:'ab', :'cb']::uuid[]), true;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'gestor', 'gestor', :'org_a'),
  (:'tl', 'team_leader', :'org_a'), (:'tl', 'corretor', :'org_a'), (:'tl2', 'team_leader', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'),
  (:'c4', 'corretor', :'org_a'), (:'ab', 'admin', :'org_b'), (:'cb', 'corretor', :'org_b');
INSERT INTO public.teams (id, nome, organization_id, lider_id) VALUES
  (:'eq1', 'Equipe Reabrir 1', :'org_a', :'tl'), (:'eq2', 'Equipe Reabrir 2', :'org_a', :'tl2');
INSERT INTO public.team_members (team_id, membro_id, organization_id) VALUES
  (:'eq1', :'c1', :'org_a'), (:'eq1', :'tl', :'org_a'), (:'eq2', :'c2', :'org_a');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'meu_plano_2027', true), (:'org_b', 'meu_plano_2027', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
-- Planos assinados (c1, c2, c3, tl, cb), um com broker (c2) e um em preenchimento (c4).
INSERT INTO public.carreira_plano (organization_id, user_id, ano, trilha, respostas, assinado_corretor_em,
                                   assinado_broker_em, assinado_broker_por, meta_oficial, meta_oficial_em) VALUES
  (:'org_a', :'c1', 2027, 'planejamento', '{"mt.tCapt":"12","mt.tVenda":"10","mt.comMedia":"15.000,00","pq.frase":"da Ana"}',
   '2026-11-18 19:31:00+00', NULL, NULL, '{"meta_comissao":165000}', '2026-11-18 19:31:05+00'),
  (:'org_a', :'c2', 2027, 'ativacao', '{"mt.tCapt":"8","mt.comMedia":"12000","pq.frase":"da Bia"}',
   '2026-11-19 12:42:00+00', '2026-11-19 15:00:00+00', :'gestor', NULL, NULL),
  (:'org_a', :'c3', 2027, 'ativacao', '{"pq.frase":"do Caio"}', '2026-11-19 10:00:00+00', NULL, NULL, NULL, NULL),
  (:'org_a', :'tl', 2027, 'ativacao', '{"pq.frase":"da Lia"}', '2026-11-19 11:00:00+00', NULL, NULL, NULL, NULL),
  (:'org_a', :'c4', 2027, 'ativacao', '{"pq.frase":"da Duda"}', NULL, NULL, NULL, NULL, NULL),
  (:'org_b', :'cb', 2027, 'ativacao', '{"pq.frase":"de B"}', '2026-11-19 09:00:00+00', NULL, NULL, NULL, NULL);
INSERT INTO public.minhas_metas (organization_id, user_id, periodo, inicio, meta_comissao)
  VALUES (:'org_a', :'c1', 'ano', '2027-01-01', 165000);
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE antes AS
  SELECT user_id, md5(respostas::text) AS resp, md5(coalesce(meta_oficial::text, '')) AS meta, meta_oficial_em,
         trilha, ativacao_inicio
    FROM public.carreira_plano WHERE organization_id IN (:'org_a', :'org_b');
CREATE TEMP TABLE metas_antes AS SELECT md5(string_agg(to_jsonb(m)::text, ',' ORDER BY m.id)) AS h
  FROM public.minhas_metas m WHERE m.organization_id = :'org_a';
GRANT SELECT ON antes, metas_antes TO authenticated;

SET LOCAL ROLE authenticated;
\set reab 'SELECT public.carreira_plano_reabrir(%L, 2027, %L)'

-- 1) Bloqueados ---------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c1', 'quero mudar meus números')) LIKE '42501%', 'corretor NAO reabre o proprio plano');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c2', 'reabrir colega')) LIKE '42501%', 'corretor NAO reabre plano de colega');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c2', 'outra equipe')) LIKE '42501%', 'TL NAO reabre plano de OUTRA equipe');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c3', 'sem equipe')) LIKE '42501%', 'TL NAO reabre plano de quem esta sem equipe');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'tl', 'o meu mesmo')) LIKE '42501%', 'TL NAO reabre o proprio plano');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'cb', 'outra imobiliaria')) IS NOT NULL, 'TL NAO reabre plano de outra imobiliaria');
SELECT pg_temp.as_user(:'ab');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c1', 'admin de fora')) IS NOT NULL, 'admin de OUTRA imobiliaria NAO reabre plano de A');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'cb', 'plano de B')) LIKE 'P0002%', 'admin de A NAO alcanca plano de B (nao encontrado)');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c1', '')) LIKE '22023%', 'motivo vazio e recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c1', 'abc')) LIKE '22023%', 'motivo curto (<5) e recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c1', repeat('x', 301))) LIKE '22023%', 'motivo longo (>300) e recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c1', E'\t\n  \u00a0\u200b\u00a0  \n')) LIKE '22023%', 'motivo so de espacos/tabs/invisiveis e recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c1', '.....!!!')) LIKE '22023%', 'motivo sem nenhuma letra/numero e recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.carreira_plano_reabrir(%L, 2027, NULL)', :'c1')) LIKE '22023%', 'motivo NULL e recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c4', 'ainda em preenchimento')) LIKE '22023%', 'plano NAO assinado: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.carreira_plano_reabrir(%L, 1999, %L)', :'c1', 'ano errado')) LIKE '22023%', 'ano invalido recusado');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano WHERE assinado_corretor_em IS NULL AND user_id <> :'c4') = 0,
  'nenhuma tentativa recusada mexeu em assinatura');

-- 2) TL da própria equipe reabre ------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok((public.carreira_plano_reabrir(:'c1', 2027, '  Corrigir número de transações  ')->>'status') = 'reaberto',
  'TL reabre plano do membro da propria equipe');
SELECT pg_temp.ok((SELECT assinado_corretor_em IS NULL FROM public.carreira_plano_equipe(2027) WHERE user_id = :'c1'),
  'lista do TL mostra o plano como nao assinado na hora');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c1', 'de novo')) LIKE '22023%', 'reabrir de novo (ja aberto) e recusado');

-- 3) Gestor reabre (plano com assinatura do broker) ------------------------------------------------------------
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok((public.carreira_plano_reabrir(:'c2', 2027, 'Comissão média digitada errada')->>'assinado_broker_em_anterior') IS NOT NULL,
  'gestor reabre e recebe a data anterior do broker');
SELECT pg_temp.ok((SELECT count(*) FILTER (WHERE assinado_corretor_em IS NOT NULL) FROM public.carreira_plano_equipe(2027)
                    WHERE user_id IN (:'c1', :'c2', :'c3', :'tl', :'c4')) = 2,
  'contagem de assinados na lista do gestor caiu de 4 para 2 na hora');

-- 4) Admin reabre --------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok((public.carreira_plano_reabrir(:'c3', 2027, 'Pedido do corretor')->>'status') = 'reaberto', 'admin reabre plano da imobiliaria');

-- 5) Plano reaberto pode ser assinado de novo pelo dono ----------------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) > '2026-11-18 19:31:00+00', 'corretor assina de novo (data nova)');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok((SELECT count(*) FILTER (WHERE assinado_corretor_em IS NOT NULL) FROM public.carreira_plano_equipe(2027)
                    WHERE user_id IN (:'c1', :'c2', :'c3', :'tl', :'c4')) = 2,
  'contagem volta a refletir a nova assinatura (tl + c1)');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) IS NOT NULL, 'plano com broker reaberto: corretor assina de novo');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(public.carreira_plano_assinar_broker(:'c2', 2027) > '2026-11-19 15:00:00+00', 'broker assina de novo depois do corretor');

-- 6) Módulo desligado bloqueia ------------------------------------------------------------------------------
RESET ROLE;
UPDATE public.organization_modules SET enabled = false WHERE organization_id = :'org_a' AND module = 'meu_plano_2027';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'tl', 'modulo desligado')) LIKE '42501%', 'modulo desligado: admin nao reabre');
RESET ROLE;
UPDATE public.organization_modules SET enabled = true WHERE organization_id = :'org_a' AND module = 'meu_plano_2027';

-- 7) anon sem acesso -----------------------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err(format(:'reab', :'c1', 'anonimo tenta')) LIKE '42501%', 'anon NAO executa a funcao');
RESET ROLE;

-- 8) Conferências como postgres: valores intactos e histórico ----------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano p JOIN antes a USING (user_id)
                    WHERE md5(p.respostas::text) = a.resp AND md5(coalesce(p.meta_oficial::text, '')) = a.meta
                      AND p.meta_oficial_em IS NOT DISTINCT FROM a.meta_oficial_em
                      AND p.trilha IS NOT DISTINCT FROM a.trilha
                      AND p.ativacao_inicio IS NOT DISTINCT FROM a.ativacao_inicio) = (SELECT count(*) FROM antes),
  'respostas, meta oficial, trilha e inicio IDENTICOS antes e depois (todos os planos)');
SELECT pg_temp.ok((SELECT h FROM metas_antes) = (SELECT md5(string_agg(to_jsonb(m)::text, ',' ORDER BY m.id))
                    FROM public.minhas_metas m WHERE m.organization_id = :'org_a'), 'minhas_metas intacta');
SELECT pg_temp.ok((SELECT assinado_corretor_em FROM public.carreira_plano WHERE user_id = :'cb') = '2026-11-19 09:00:00+00',
  'plano de outra imobiliaria continua assinado');
SELECT pg_temp.ok((SELECT assinado_corretor_em IS NULL AND assinado_broker_em IS NULL FROM public.carreira_plano WHERE user_id = :'c3'),
  'plano reaberto pelo admin ficou em preenchimento');
SELECT pg_temp.ok((SELECT count(*) FROM public.activity_logs WHERE acao = 'meu_plano_reaberto' AND organization_id = :'org_a') = 3,
  'historico: 3 reaberturas gravadas (nenhuma das recusadas)');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.activity_logs WHERE acao = 'meu_plano_reaberto' AND autor_id = :'tl'
                    AND payload->>'corretor_id' = :'c1' AND payload->>'motivo' = 'Corrigir número de transações'
                    AND payload->>'papel' = 'team_leader'
                    AND (payload->>'assinado_corretor_em_anterior')::timestamptz = '2026-11-18 19:31:00+00'
                    AND payload->>'assinado_broker_em_anterior' IS NULL AND sale_id IS NULL AND created_at IS NOT NULL),
  'historico do TL: quem, motivo (sem espacos), papel, data anterior');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.activity_logs WHERE acao = 'meu_plano_reaberto' AND autor_id = :'gestor'
                    AND payload->>'corretor_id' = :'c2' AND payload->>'papel' = 'gestor'
                    AND (payload->>'assinado_broker_em_anterior')::timestamptz = '2026-11-19 15:00:00+00'
                    AND payload->>'assinado_broker_por_anterior' = :'gestor'),
  'historico do gestor guarda a assinatura anterior do broker');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.activity_logs WHERE acao = 'meu_plano_reaberto' AND autor_id = :'admin'
                    AND payload->>'papel' = 'admin'), 'historico do admin');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
