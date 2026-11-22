-- Suíte "gestor só na própria equipe" (migrations 20261219120000 e 20261219130000, t_82b66d41; Denis 22/11/2026).
-- Transação revertida, banco local descartável ou homologação; nunca produção. Dados fictícios.
-- Papéis: admin, dono (super_admin), gestor COM equipe (eqg + equipe-filha eqf), gestor SEM equipe (gsem),
-- TL (eqt), corretor (c1) e outra imobiliária (gb, cb).
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
-- Pessoas / equipes devolvidas por metas_equipe_planos; pessoas do farol.
CREATE FUNCTION pg_temp.pessoas(_j jsonb) RETURNS uuid[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg((x ->> 'user_id')::uuid ORDER BY x ->> 'user_id'), '{}') FROM jsonb_array_elements(_j -> 'pessoas') x $$;
CREATE FUNCTION pg_temp.equipes(_j jsonb) RETURNS uuid[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg((x ->> 'id')::uuid ORDER BY x ->> 'id'), '{}') FROM jsonb_array_elements(_j -> 'equipes') x $$;
CREATE FUNCTION pg_temp.arr(_ids uuid[]) RETURNS uuid[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg(x ORDER BY x::text), '{}') FROM unnest(_ids) x $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a3000000-0000-4000-8000-0000000000a0'
\set org_b 'b3000000-0000-4000-8000-0000000000b0'
\set admin 'a3000000-0000-4000-8000-000000000001'
\set gestor 'a3000000-0000-4000-8000-000000000002'
\set tl 'a3000000-0000-4000-8000-000000000003'
\set gsem 'a3000000-0000-4000-8000-000000000008'
\set dono 'a3000000-0000-4000-8000-000000000009'
\set c1 'a3000000-0000-4000-8000-000000000005'
\set c2 'a3000000-0000-4000-8000-000000000006'
\set c3 'a3000000-0000-4000-8000-000000000007'
\set c4 'a3000000-0000-4000-8000-00000000000a'
\set gb 'b3000000-0000-4000-8000-000000000001'
\set cb 'b3000000-0000-4000-8000-000000000003'
\set eqg 'a3000000-0000-4000-8000-00000000e001'
\set eqt 'a3000000-0000-4000-8000-00000000e002'
\set eqf 'a3000000-0000-4000-8000-00000000e003'
\set eqb 'b3000000-0000-4000-8000-00000000e001'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:'org_a', 'teste-gsq-a', 'Imobiliaria GSQ A', 'ativa'),
  (:'org_b', 'teste-gsq-b', 'Imobiliaria GSQ B', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'gsem', :'tl', :'dono', :'c1', :'c2', :'c3', :'c4', :'gb', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Adm GSQ', 'adm@gsq.test', true, :'org_a'),
  (:'gestor', 'Gestor GSQ', 'gestor@gsq.test', true, :'org_a'),
  (:'gsem', 'Gestor Sem Equipe GSQ', 'gsem@gsq.test', true, :'org_a'),
  (:'tl', 'TL GSQ', 'tl@gsq.test', true, :'org_a'),
  (:'dono', 'Dono GSQ', 'dono@gsq.test', true, :'org_a'),
  (:'c1', 'Ana Do Gestor', 'c1@gsq.test', true, :'org_a'),
  (:'c2', 'Bia Do TL', 'c2@gsq.test', true, :'org_a'),
  (:'c3', 'Caio Sem Equipe', 'c3@gsq.test', true, :'org_a'),
  (:'c4', 'Duda Equipe Filha', 'c4@gsq.test', true, :'org_a'),
  (:'gb', 'Gestor B', 'gb@gsq.test', true, :'org_b'),
  (:'cb', 'Corretor B', 'cb@gsq.test', true, :'org_b');
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
  (:'eqg', 'Equipe do Gestor GSQ', :'org_a', :'gestor', NULL),
  (:'eqt', 'Equipe do TL GSQ', :'org_a', :'tl', NULL),
  (:'eqf', 'Equipe Filha GSQ', :'org_a', :'admin', :'eqg'),
  (:'eqb', 'Equipe B GSQ', :'org_b', :'gb', NULL);
INSERT INTO public.team_members (team_id, membro_id, organization_id) VALUES
  (:'eqg', :'c1', :'org_a'), (:'eqt', :'c2', :'org_a'), (:'eqt', :'tl', :'org_a'),
  (:'eqf', :'c4', :'org_a'), (:'eqb', :'cb', :'org_b');
-- Histórico (o gatilho fica desligado em modo replica): equipe vigente de cada membro.
INSERT INTO public.team_membership_history (membro_id, team_id, vigente_de, origem, organization_id) VALUES
  (:'c1', :'eqg', now() - interval '30 days', 'team_members', :'org_a'),
  (:'c2', :'eqt', now() - interval '30 days', 'team_members', :'org_a'),
  (:'tl', :'eqt', now() - interval '30 days', 'team_members', :'org_a'),
  (:'c4', :'eqf', now() - interval '30 days', 'team_members', :'org_a'),
  (:'cb', :'eqb', now() - interval '30 days', 'team_members', :'org_b');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'meu_plano_2027', true), (:'org_b', 'meu_plano_2027', true),
  (:'org_a', 'inteligencia_gestao', true), (:'org_b', 'inteligencia_gestao', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
-- Planos assinados pelo corretor (prontos para o broker assinar ou para reabrir).
INSERT INTO public.carreira_plano (organization_id, user_id, ano, trilha, respostas, assinado_corretor_em) VALUES
  (:'org_a', :'c1', 2027, 'planejamento', '{"pq.frase":"da Ana"}', now()),
  (:'org_a', :'c2', 2027, 'ativacao', '{"pq.frase":"da Bia"}', now()),
  (:'org_a', :'c3', 2027, 'ativacao', '{"pq.frase":"do Caio"}', now()),
  (:'org_a', :'c4', 2027, 'ativacao', '{"pq.frase":"da Duda"}', now()),
  (:'org_b', :'cb', 2027, 'planejamento', '{"pq.frase":"de B"}', now());
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
\set assina 'SELECT public.carreira_plano_assinar_broker(%L, 2027)'
\set reabre 'SELECT public.carreira_plano_reabrir(%L, 2027, ''Motivo de teste GSQ'')'
\set um 'SELECT public.gestao_1a1_salvar(%L, NULL, ''{}'', ''[]'')'

-- ============ 3) Metas 2027 · Equipes =========================================================================
SELECT pg_temp.as_user(:'admin');
CREATE TEMP TABLE m_adm AS SELECT public.metas_equipe_planos(2027) j;
SELECT pg_temp.ok((SELECT (j ->> 'todas')::boolean FROM m_adm)
  AND pg_temp.pessoas((SELECT j FROM m_adm)) @> ARRAY[:'c1', :'c2', :'c3', :'c4', :'tl']::uuid[]
  AND pg_temp.equipes((SELECT j FROM m_adm)) = pg_temp.arr(ARRAY[:'eqg', :'eqt', :'eqf']::uuid[]),
  'metas: admin ve a imobiliaria toda (todas=true, 3 equipes, inclui sem equipe)');
SELECT pg_temp.ok(NOT (pg_temp.pessoas((SELECT j FROM m_adm)) && ARRAY[:'cb']::uuid[]), 'metas: admin NAO ve outra imobiliaria');
SELECT pg_temp.as_user(:'dono');
SELECT pg_temp.ok((public.metas_equipe_planos(2027) ->> 'todas')::boolean, 'metas: super_admin ve a imobiliaria toda');

SELECT pg_temp.as_user(:'gestor');
CREATE TEMP TABLE m_g AS SELECT public.metas_equipe_planos(2027) j;
SELECT pg_temp.ok(NOT (SELECT (j ->> 'todas')::boolean FROM m_g), 'metas: gestor NAO tem "todas as equipes" (todas=false)');
SELECT pg_temp.ok(pg_temp.equipes((SELECT j FROM m_g)) = pg_temp.arr(ARRAY[:'eqg', :'eqf']::uuid[]),
  'metas: gestor ve so as equipes que lidera (e a equipe-filha)');
SELECT pg_temp.ok(pg_temp.pessoas((SELECT j FROM m_g)) @> ARRAY[:'c1', :'c4']::uuid[]
  AND NOT (pg_temp.pessoas((SELECT j FROM m_g)) && ARRAY[:'c2', :'c3', :'tl', :'cb']::uuid[]),
  'metas: gestor ve so as pessoas da equipe dele (sem TL, sem "sem equipe", sem B)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.metas_equipe_planos(2027, %L)', :'eqt')) LIKE '42501%',
  'metas: gestor pedindo a equipe do TL: recusado (42501)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.metas_equipe_realizado(current_date - 30, current_date, %L)', :'eqt')) LIKE '42501%',
  'metas: realizado da equipe do TL recusado para o gestor');
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_equipe_realizado(current_date - 30, current_date)') IS NULL,
  'metas: realizado da propria equipe abre sem erro');

SELECT pg_temp.as_user(:'gsem');
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_equipe_planos(2027)') IS NULL, 'metas: gestor sem equipe abre sem erro');
CREATE TEMP TABLE m_gs AS SELECT public.metas_equipe_planos(2027) j;
SELECT pg_temp.ok(NOT (SELECT (j ->> 'todas')::boolean FROM m_gs)
  AND cardinality(pg_temp.pessoas((SELECT j FROM m_gs))) = 0 AND cardinality(pg_temp.equipes((SELECT j FROM m_gs))) = 0,
  'metas: gestor sem equipe ve painel vazio');
SELECT pg_temp.ok((SELECT jsonb_array_length(public.metas_equipe_realizado(current_date - 30, current_date) -> 'vendas')) = 0,
  'metas: gestor sem equipe nao recebe vendas');

SELECT pg_temp.as_user(:'tl');
CREATE TEMP TABLE m_tl AS SELECT public.metas_equipe_planos(2027) j;
SELECT pg_temp.ok(NOT (SELECT (j ->> 'todas')::boolean FROM m_tl)
  AND pg_temp.equipes((SELECT j FROM m_tl)) = ARRAY[:'eqt']::uuid[]
  AND pg_temp.pessoas((SELECT j FROM m_tl)) @> ARRAY[:'c2']::uuid[]
  AND NOT (pg_temp.pessoas((SELECT j FROM m_tl)) && ARRAY[:'c1', :'c3', :'c4']::uuid[]),
  'metas: TL ve so a propria equipe (sem mudanca)');

SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_equipe_planos(2027)') LIKE '42501%', 'metas: corretor recusado (42501)');

SELECT pg_temp.as_user(:'gb');
CREATE TEMP TABLE m_b AS SELECT public.metas_equipe_planos(2027) j;
SELECT pg_temp.ok(pg_temp.pessoas((SELECT j FROM m_b)) @> ARRAY[:'cb']::uuid[]
  AND NOT (pg_temp.pessoas((SELECT j FROM m_b)) && ARRAY[:'c1', :'c2', :'c3', :'c4']::uuid[])
  AND pg_temp.err(format('SELECT public.metas_equipe_planos(2027, %L)', :'eqg')) LIKE '42501%',
  'metas: gestor de outra imobiliaria ve so a dele e nao abre equipe da A');

-- ============ 3b) Metas 2027 · Imobiliária: só admin/super_admin ===============================================
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_imobiliaria_estoque()') LIKE '42501%'
  AND pg_temp.err('SELECT public.metas_comissao_quebra(current_date - 30, current_date)') LIKE '42501%',
  'imobiliaria: gestor NAO ve estoque nem comissao bruta (42501)');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_imobiliaria_estoque()') LIKE '42501%', 'imobiliaria: TL continua recusado');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_imobiliaria_estoque()') IS NULL
  AND coalesce(pg_temp.err('SELECT public.metas_comissao_quebra(current_date - 30, current_date)'), '') NOT LIKE '42501%',
  'imobiliaria: admin continua vendo (estoque abre; bruta nao e recusada por permissao)');
SELECT pg_temp.as_user(:'dono');
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_imobiliaria_estoque()') IS NULL, 'imobiliaria: super_admin continua vendo');

-- ============ 4a) Assinar o pacto como broker ===================================================================
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err(format(:'assina', :'c1')) IS NULL, 'assinar: gestor assina o pacto de quem e da equipe dele');
SELECT pg_temp.ok(pg_temp.err(format(:'assina', :'c4')) IS NULL, 'assinar: gestor assina o pacto da equipe-filha');
SELECT pg_temp.ok(pg_temp.err(format(:'assina', :'c2')) LIKE '42501%', 'assinar: gestor NAO assina o pacto da equipe do TL');
SELECT pg_temp.ok(pg_temp.err(format(:'assina', :'c3')) LIKE '42501%', 'assinar: gestor NAO assina o pacto de corretor sem equipe');
SELECT pg_temp.as_user(:'gsem');
SELECT pg_temp.ok(pg_temp.err(format(:'assina', :'c2')) LIKE '42501%', 'assinar: gestor sem equipe NAO assina');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.err(format(:'assina', :'c2')) LIKE '42501%', 'assinar: TL continua sem assinar como broker');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err(format(:'assina', :'c2')) LIKE '42501%', 'assinar: corretor recusado');
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.err(format(:'assina', :'c3')) IS NOT NULL, 'assinar: gestor de outra imobiliaria nao assina plano da A');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err(format(:'assina', :'c2')) IS NULL, 'assinar: admin assina em qualquer equipe');
SELECT pg_temp.as_user(:'dono');
SELECT pg_temp.ok(pg_temp.err(format(:'assina', :'c3')) IS NULL, 'assinar: super_admin assina corretor sem equipe');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano WHERE organization_id = :'org_a' AND assinado_broker_em IS NOT NULL) = 4
  AND (SELECT assinado_broker_por FROM public.carreira_plano WHERE user_id = :'c2' AND ano = 2027) = :'admin',
  'assinar: so as 4 assinaturas permitidas foram gravadas (c2 pelo admin)');
SET LOCAL ROLE authenticated;

-- ============ 4b) Reabrir o plano ===============================================================================
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err(format(:'reabre', :'c2')) LIKE '42501%', 'reabrir: gestor NAO reabre plano da equipe do TL');
SELECT pg_temp.ok(pg_temp.err(format(:'reabre', :'c3')) LIKE '42501%', 'reabrir: gestor NAO reabre plano de corretor sem equipe');
SELECT pg_temp.ok(pg_temp.err(format(:'reabre', :'c1')) IS NULL, 'reabrir: gestor reabre plano da propria equipe');
SELECT pg_temp.as_user(:'gsem');
SELECT pg_temp.ok(pg_temp.err(format(:'reabre', :'c4')) LIKE '42501%', 'reabrir: gestor sem equipe NAO reabre');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err(format(:'reabre', :'c4')) LIKE '42501%', 'reabrir: corretor recusado');
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.err(format(:'reabre', :'c4')) IS NOT NULL, 'reabrir: gestor de outra imobiliaria recusado');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.err(format(:'reabre', :'c2')) IS NULL, 'reabrir: TL reabre plano da propria equipe (sem mudanca)');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err(format(:'reabre', :'c3')) IS NULL, 'reabrir: admin reabre em qualquer equipe');
SELECT pg_temp.as_user(:'dono');
SELECT pg_temp.ok(pg_temp.err(format(:'reabre', :'c4')) IS NULL, 'reabrir: super_admin reabre em qualquer equipe');

-- ============ 4c) Inteligência de gestão (gestao_pode_ver → 1:1, pendências, farol) ============================
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(public.gestao_pode_ver(:'c1') AND public.gestao_pode_ver(:'c4')
  AND NOT public.gestao_pode_ver(:'c2') AND NOT public.gestao_pode_ver(:'c3') AND NOT public.gestao_pode_ver(:'cb'),
  'gestao: gestor so ve a propria equipe (e a equipe-filha)');
SELECT pg_temp.ok(pg_temp.err(format(:'um', :'c1')) IS NULL, '1:1: gestor faz 1:1 com corretor da propria equipe');
SELECT pg_temp.ok(pg_temp.err(format(:'um', :'c2')) LIKE '42501%', '1:1: gestor NAO faz 1:1 com corretor da equipe do TL');
SELECT pg_temp.ok(pg_temp.err(format(:'um', :'c3')) LIKE '42501%', '1:1: gestor NAO faz 1:1 com corretor sem equipe');
SELECT pg_temp.ok(pg_temp.err(format('SELECT * FROM public.gestao_pendencias_corretor(%L)', :'c2')) LIKE '42501%',
  'pendencias: gestor NAO le pendencias de fora da equipe');
SELECT pg_temp.ok(pg_temp.err(format('SELECT * FROM public.gestao_pendencias_corretor(%L)', :'c1')) IS NULL,
  'pendencias: gestor le pendencias da propria equipe');
CREATE TEMP TABLE f_g AS SELECT public.gestao_farol_dados(2027) j;
SELECT pg_temp.ok(pg_temp.pessoas((SELECT j FROM f_g)) = pg_temp.arr(ARRAY[:'c1', :'c4']::uuid[]),
  'farol: gestor ve so a propria equipe');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_farol_dados(2027, %L)', :'c2')) LIKE '42501%',
  'farol: gestor NAO abre corretor de fora da equipe');

SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(public.gestao_pode_ver(:'c2') AND public.gestao_pode_ver(:'c3') AND NOT public.gestao_pode_ver(:'cb'),
  'gestao: admin ve a imobiliaria toda (sem outra imobiliaria)');
CREATE TEMP TABLE c_adm AS SELECT public.gestao_1a1_salvar(:'c3', NULL, '{}', '[]') AS id;
GRANT SELECT ON c_adm TO authenticated;
SELECT pg_temp.ok((SELECT id FROM c_adm) IS NOT NULL, '1:1: admin faz 1:1 com corretor sem equipe');
SELECT pg_temp.ok(pg_temp.pessoas(public.gestao_farol_dados(2027)) @> ARRAY[:'c1', :'c2', :'c3', :'c4']::uuid[],
  'farol: admin ve a imobiliaria toda');
SELECT pg_temp.as_user(:'dono');
SELECT pg_temp.ok(public.gestao_pode_ver(:'c3'), 'gestao: super_admin ve a imobiliaria toda');

SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_remarcar(%L, current_date + 20)', (SELECT id FROM c_adm))) LIKE '42501%',
  'remarcar: gestor NAO remarca 1:1 de corretor de fora da equipe');
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_conversas_1a1 WHERE corretor_id = :'c3') = 0,
  'leitura 1:1 (RLS): gestor NAO le conversa de fora da equipe');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_remarcar(%L, current_date + 20)',
  (SELECT id FROM public.gestao_conversas_1a1 WHERE corretor_id = :'c1' LIMIT 1))) IS NULL,
  'remarcar: gestor remarca 1:1 da propria equipe');

SELECT pg_temp.as_user(:'gsem');
SELECT pg_temp.ok(NOT public.gestao_pode_ver(:'c1') AND NOT public.gestao_pode_ver(:'c3'), 'gestao: gestor sem equipe nao ve ninguem');
SELECT pg_temp.ok(pg_temp.err(format(:'um', :'c1')) LIKE '42501%', '1:1: gestor sem equipe NAO faz 1:1');
SELECT pg_temp.ok(pg_temp.err('SELECT public.gestao_farol_dados(2027)') IS NULL
  AND cardinality(pg_temp.pessoas(public.gestao_farol_dados(2027))) = 0,
  'farol: gestor sem equipe abre vazio, sem erro');

SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(public.gestao_pode_ver(:'c2') AND NOT public.gestao_pode_ver(:'c1')
  AND pg_temp.pessoas(public.gestao_farol_dados(2027)) = ARRAY[:'c2']::uuid[]
  AND pg_temp.err(format(:'um', :'c2')) IS NULL,
  'gestao: TL so a propria equipe, faz 1:1 com ela (sem mudanca)');

SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(NOT public.gestao_pode_ver(:'c2') AND public.gestao_pode_ver(:'c1')
  AND pg_temp.err('SELECT public.gestao_farol_dados(2027)') LIKE '42501%'
  AND pg_temp.err(format(:'um', :'c2')) LIKE '42501%',
  'gestao: corretor so ve a si mesmo; sem farol e sem 1:1');

SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(NOT public.gestao_pode_ver(:'c1') AND public.gestao_pode_ver(:'cb')
  AND pg_temp.pessoas(public.gestao_farol_dados(2027)) = ARRAY[:'cb']::uuid[],
  'gestao: gestor de outra imobiliaria so ve a dele');

-- ============ Fica como estava (regressão) ======================================================================
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(public.meu_plano_eh_broker(:'gestor') = true, 'nao mexido: meu_plano_eh_broker do gestor continua true');
SELECT pg_temp.ok((SELECT coalesce(array_agg(user_id ORDER BY user_id::text), '{}') FROM public.carreira_plano_equipe(2027))
  = pg_temp.arr(ARRAY[:'c1', :'c4']::uuid[]), 'nao mexido: lista dos Planos 2027 do gestor = so a equipe dele');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
