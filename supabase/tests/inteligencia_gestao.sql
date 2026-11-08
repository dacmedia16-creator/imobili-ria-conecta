-- Suíte da migration 20261108180000 (Inteligência de gestão 1/3). Roda DENTRO de transação revertida
-- (run-inteligencia-gestao.sh). Dados fictícios só na transação; nada fica gravado.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0). Perfis: A1 (UE Corretor, membro da "Equipe UE"
-- do UE Gestor), A2 (QA A Corretor Um) vira TL fictício de uma equipe nova só com A3 (QA A Corretor Tres),
-- C2 (QA A Corretor Dois, equipe do QA A Gestor, tem captações), gestor A (UE Gestor), admin A (QA A Admin),
-- B1 (QA B Corretor Um), admin B (QA B Admin).
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
  ('a3', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'),
  ('ga', '10000000-0000-4000-8000-000000000002'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'), ('admB', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536'),
  ('eqUE', '1a000000-0000-4000-8000-000000000001');
CREATE TEMP TABLE d AS SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje;
GRANT SELECT ON d TO authenticated;

-- pendencias_antes: minhas_pendencias() de C2 gravada pelo runner ANTES da migration (prova de saída idêntica).

-- 0) Módulo nasce desligado em todas -------------------------------------------------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE module = 'inteligencia_gestao'),
  'módulo nasce desligado (nenhuma linha criada)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok(public.inteligencia_gestao_enabled() = false, 'desligado: inteligencia_gestao_enabled() = false');
SELECT pg_temp.ok(pg_temp.err('SELECT public.gestao_farol_dados(2027)') LIKE '42501%', 'desligado: farol recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_salvar(%L, NULL, ''{}'', ''[]'')', pg_temp.id('a1'))) LIKE '42501%',
  'desligado: 1:1 não grava');
RESET ROLE;

-- Liga na A (e leads + reunião), deixa desligado na B. TL fictício: A2 lidera "Equipe TL Teste" só com A3.
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (pg_temp.id('orgA'), 'inteligencia_gestao', true), (pg_temp.id('orgA'), 'leads', true),
  (pg_temp.id('orgA'), 'avisos_exclusividade', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.lead_config (organization_id) VALUES (pg_temp.id('orgA')) ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('a2'), 'team_leader', pg_temp.id('orgA'))
  ON CONFLICT DO NOTHING;
INSERT INTO public.teams (id, organization_id, nome, lider_id)
VALUES ('3b000000-0000-4000-8000-0000000000e2', pg_temp.id('orgA'), 'Equipe TL Teste IG', pg_temp.id('a2'));
INSERT INTO ids VALUES ('eqTL', '3b000000-0000-4000-8000-0000000000e2');
DELETE FROM public.team_members WHERE membro_id = pg_temp.id('a3');
INSERT INTO public.team_members (team_id, membro_id, organization_id) VALUES (pg_temp.id('eqTL'), pg_temp.id('a3'), pg_temp.id('orgA'));
RESET ROLE;

-- Lead de A1 com o aceite vencido (atribuído há 2 dias; prazo padrão 24 h) e um de A3 em dia.
INSERT INTO public.leads (organization_id, nome, telefone, origem, responsavel_id, atribuido_em, simulado)
VALUES (pg_temp.id('orgA'), 'Lead Teste IG 1', '15900000001', 'manual', pg_temp.id('a1'), now() - interval '2 days', true),
       (pg_temp.id('orgA'), 'Lead Teste IG 2', '15900000002', 'manual', pg_temp.id('a3'), now() - interval '1 hour', true);
-- Diário de A1 nos últimos 90 dias (para o funil) + uma "visita" antiga que não pode contar. A "visita" entra
-- antes de ligar o Meu Plano 2027 (depois dele, o Diário só aceita V1/V2), como aconteceu na vida real.
DELETE FROM public.organization_modules WHERE organization_id = pg_temp.id('orgA') AND module = 'meu_plano_2027';
INSERT INTO public.carreira_diario (organization_id, user_id, dia, tipo, quantidade)
VALUES (pg_temp.id('orgA'), pg_temp.id('a1'), (SELECT hoje - 1 FROM d), 'visita', 9);
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'meu_plano_2027', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.carreira_diario (organization_id, user_id, dia, tipo, quantidade)
VALUES (pg_temp.id('orgA'), pg_temp.id('a1'), (SELECT hoje FROM d), 'ligacao', 20),
       (pg_temp.id('orgA'), pg_temp.id('a1'), (SELECT hoje FROM d), 'v1', 6),
       (pg_temp.id('orgA'), pg_temp.id('a1'), (SELECT hoje FROM d), 'v2', 1);

-- Esperado (contado sem RLS): exclusividades aprovadas, assinadas e em aberto de C2.
CREATE TEMP TABLE caps_c2 AS SELECT count(*)::int AS n FROM public.exclusive_captures c
 WHERE c.organization_id = pg_temp.id('orgA') AND c.captor_id = pg_temp.id('c2')
   AND c.status = 'aprovada' AND c.archived_at IS NULL AND c.discarded_at IS NULL AND c.signed_on IS NOT NULL;
GRANT SELECT ON caps_c2 TO authenticated;

-- 1) Gestor: farol da imobiliária inteira -----------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok(public.inteligencia_gestao_enabled(), 'ligado na A: inteligencia_gestao_enabled() = true');
CREATE TEMP TABLE fg AS SELECT p FROM jsonb_array_elements(public.gestao_farol_dados(2027)->'pessoas') p;
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM fg WHERE (p->>'user_id')::uuid = pg_temp.id('a1'))
  AND EXISTS (SELECT 1 FROM fg WHERE (p->>'user_id')::uuid = pg_temp.id('a3'))
  AND EXISTS (SELECT 1 FROM fg WHERE (p->>'user_id')::uuid = pg_temp.id('c2'))
  AND NOT EXISTS (SELECT 1 FROM fg WHERE (p->>'user_id')::uuid IN (pg_temp.id('b1'), pg_temp.id('ga'))),
  'gestor A vê os corretores da A (não ele mesmo, nenhum da B)');
SELECT pg_temp.ok((SELECT jsonb_array_length(p->'leads') = 1 FROM fg WHERE (p->>'user_id')::uuid = pg_temp.id('a1')),
  'leads em aberto de A1 vêm para a regra de prazo (1)');
SELECT pg_temp.ok((SELECT (p->'funil90'->>'ligacoes')::int = 20 AND (p->'funil90'->>'v1')::int = 6
                     AND (p->'funil90'->>'v2')::int = 1 FROM fg WHERE (p->>'user_id')::uuid = pg_temp.id('a1')),
  'funil 90 dias de A1: 20 ligações, 6 V1, 1 V2 ("Visita (antiga)" fora)');
SELECT pg_temp.ok((SELECT (p->'funil90_equipe'->>'v1')::int >= 6 FROM fg WHERE (p->>'user_id')::uuid = pg_temp.id('a1')),
  'funil da equipe somado vem junto (sem nomes)');
SELECT pg_temp.ok((SELECT jsonb_array_length(p->'captacoes') = (SELECT n FROM caps_c2)
   FROM fg WHERE (p->>'user_id')::uuid = pg_temp.id('c2')),
  'exclusividades assinadas de C2 vêm para o sinal de gestões (só id, status, assinatura, prazo; sem proprietário)');
SELECT pg_temp.ok((SELECT n FROM caps_c2) > 0, 'C2 tem exclusividades assinadas (a comparação não é vazia)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM fg, jsonb_array_elements(p->'captacoes') c
                               WHERE c ?| ARRAY['form_data', 'owner', 'proprietario', 'telefone']),
  'nenhum dado de proprietário sai no farol');
SELECT pg_temp.ok((SELECT p->'entrou_em' IS NOT NULL AND p->>'entrou_em' <> 'null' FROM fg WHERE (p->>'user_id')::uuid = pg_temp.id('a3')),
  'data de entrada na equipe vem (regra do "novo" < 60 dias)');
SELECT pg_temp.ok((SELECT (p->>'entrou_em')::date = (SELECT hoje FROM d) FROM fg WHERE (p->>'user_id')::uuid = pg_temp.id('a3')),
  'A3 entrou hoje na equipe do TL → entra como novo');

-- 2) 1:1: gestor salva; próxima em 14 dias por padrão; editável ----------------------------------------------
CREATE TEMP TABLE c1 AS SELECT public.gestao_1a1_salvar(pg_temp.id('a1'), NULL,
  '{"versao":1,"sinais":[{"chave":"leads","cor":"vermelho","texto":"1 lead sem resposta"}]}',
  '[{"texto":"Ligar para 20 proprietários","feito":null}]') AS id;
GRANT SELECT ON c1 TO authenticated;
SELECT pg_temp.ok((SELECT proxima_data = data + 14 AND data = (SELECT hoje FROM d) AND conduzido_por = pg_temp.id('ga')
                     AND team_id = pg_temp.id('eqUE') AND organization_id = pg_temp.id('orgA')
                   FROM public.gestao_conversas_1a1 WHERE id = (SELECT id FROM c1)),
  '1:1 salva: data hoje, próxima = +14 dias, conduzida pelo gestor, equipe e imobiliária preenchidas');
SELECT pg_temp.ok(public.gestao_1a1_remarcar((SELECT id FROM c1), (SELECT hoje + 21 FROM d)) = (SELECT hoje + 21 FROM d),
  'próxima 1:1 editável (remarcada para +21)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_remarcar(%L, %L)', (SELECT id FROM c1), (SELECT hoje - 1 FROM d))) LIKE '22023%',
  'próxima antes da conversa é recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_salvar(%L, NULL, ''{}'', ''[{"texto":""}]'')', pg_temp.id('a1'))) LIKE '22023%'
  AND pg_temp.err(format('SELECT public.gestao_1a1_salvar(%L, NULL, ''{}'', ''[{"texto":"x","extra":1}]'')', pg_temp.id('a1'))) LIKE '22023%'
  AND pg_temp.err(format('SELECT public.gestao_1a1_salvar(%L, %L, ''{}'', ''[]'')', pg_temp.id('a1'), (SELECT hoje + 1 FROM d))) LIKE '22023%',
  'combinado vazio, campo estranho e data futura são recusados');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_salvar(%L, NULL, ''{}'', ''[]'')', pg_temp.id('ga'))) LIKE '42501%',
  'ninguém faz 1:1 consigo mesmo');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_salvar(%L, NULL, ''{}'', ''[]'')', pg_temp.id('b1'))) LIKE '42501%',
  'gestor A não faz 1:1 com corretor da B');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.gestao_conversas_1a1 (corretor_id) VALUES (' || quote_literal(pg_temp.id('a1')) || ')') LIKE '42501%',
  'escrita direta na tabela bloqueada (só pela RPC)');
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_pendencias_corretor(pg_temp.id('c2'))) >= 0,
  'gestor lê o "O que fazer hoje" de C2 para a pauta');

-- 3) Team leader: só a própria equipe ----------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a2')::text);
CREATE TEMP TABLE ft AS SELECT p FROM jsonb_array_elements(public.gestao_farol_dados(2027)->'pessoas') p;
SELECT pg_temp.ok((SELECT array_agg((p->>'user_id')::uuid) FROM ft) = ARRAY[pg_temp.id('a3')],
  'TL vê no farol só a própria equipe (A3)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_farol_dados(2027, %L)', pg_temp.id('a1'))) LIKE '42501%',
  'TL não pede o termômetro de corretor de outra equipe');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_salvar(%L, NULL, ''{}'', ''[]'')', pg_temp.id('a1'))) LIKE '42501%',
  'TL não faz 1:1 com corretor de outra equipe');
SELECT pg_temp.ok(pg_temp.err(format('SELECT * FROM public.gestao_pendencias_corretor(%L)', pg_temp.id('a1'))) LIKE '42501%',
  'TL não lê pendências de corretor de outra equipe');
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_conversas_1a1 WHERE corretor_id = pg_temp.id('a1')) = 0,
  'TL não lê pela tabela a 1:1 de corretor de outra equipe');
CREATE TEMP TABLE c2t AS SELECT public.gestao_1a1_salvar(pg_temp.id('a3'), NULL, '{}', '[]', (SELECT hoje + 7 FROM d)) AS id;
GRANT SELECT ON c2t TO authenticated;
SELECT pg_temp.ok((SELECT proxima_data = (SELECT hoje + 7 FROM d) AND team_id = pg_temp.id('eqTL')
                   FROM public.gestao_conversas_1a1 WHERE id = (SELECT id FROM c2t)),
  'TL faz 1:1 com A3 (próxima informada = +7), equipe gravada');
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_conversas_1a1) = 1, 'TL lê só a 1:1 da própria equipe');

-- 4) Corretor: só o próprio termômetro e as próprias 1:1 (tudo, sem campo oculto) --------------------------------
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.gestao_farol_dados(2027)') LIKE '42501%', 'corretor não abre o farol da equipe');
SELECT pg_temp.ok((SELECT jsonb_array_length(public.gestao_farol_dados(2027, pg_temp.id('a1'))->'pessoas')) = 1,
  'corretor lê o próprio termômetro');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_farol_dados(2027, %L)', pg_temp.id('a3'))) LIKE '42501%',
  'corretor não lê o termômetro de colega');
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_conversas_1a1) = 1
  AND (SELECT pauta ? 'sinais' AND jsonb_array_length(combinados) = 1 AND proxima_data = (SELECT hoje + 21 FROM d)
         FROM public.gestao_conversas_1a1),
  'corretor lê a própria 1:1 inteira (pauta, combinados, próxima) e só ela');
SELECT pg_temp.ok((SELECT ultima_1a1->>'com' IS NOT NULL FROM (SELECT p->'ultima_1a1' AS ultima_1a1
                   FROM jsonb_array_elements(public.gestao_farol_dados(2027, pg_temp.id('a1'))->'pessoas') p) x),
  '"Minha próxima 1:1": data e com quem vêm no termômetro');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_salvar(%L, NULL, ''{}'', ''[]'')', pg_temp.id('a3'))) LIKE '42501%',
  'corretor não conduz 1:1');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_remarcar(%L, %L)', (SELECT id FROM c1), (SELECT hoje + 30 FROM d))) LIKE '42501%',
  'corretor não remarca a própria 1:1');
SELECT pg_temp.ok(pg_temp.err(format('SELECT * FROM public.gestao_pendencias_corretor(%L)', pg_temp.id('c2'))) LIKE '42501%',
  'corretor não lê pendências de colega');
SELECT pg_temp.ok(pg_temp.err('UPDATE public.gestao_conversas_1a1 SET combinados = ''[]''') LIKE '42501%'
  AND pg_temp.err('DELETE FROM public.gestao_conversas_1a1') LIKE '42501%',
  'corretor não altera nem apaga a 1:1');

-- 5) Isolamento entre imobiliárias ------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_conversas_1a1) = 0, 'admin B não vê 1:1 da A');
SELECT pg_temp.ok(pg_temp.err('SELECT public.gestao_farol_dados(2027)') LIKE '42501%', 'B (módulo desligado) não abre o farol');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_farol_dados(2027, %L)', pg_temp.id('a1'))) LIKE '42501%',
  'admin B não lê termômetro de corretor da A');
RESET ROLE;
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgB'), 'inteligencia_gestao', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_conversas_1a1) = 0
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.gestao_farol_dados(2027)->'pessoas') p
                   WHERE (p->>'user_id')::uuid IN (pg_temp.id('a1'), pg_temp.id('a3'), pg_temp.id('c2'))),
  'com o módulo ligado na B: admin B continua sem ver nada da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_salvar(%L, NULL, ''{}'', ''[]'')', pg_temp.id('a1'))) LIKE '42501%',
  'admin B não faz 1:1 com corretor da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.gestao_1a1_remarcar(%L, %L)', (SELECT id FROM c1), (SELECT hoje + 30 FROM d))) LIKE '42501%',
  'admin B não remarca 1:1 da A');
RESET ROLE;

-- 6) Desligar esconde; dados preservados; religar volta ---------------------------------------------------------
UPDATE public.organization_modules SET enabled = false WHERE organization_id = pg_temp.id('orgA') AND module = 'inteligencia_gestao';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_conversas_1a1) = 0, 'desligado: gestor lê 0 conversas');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_conversas_1a1) = 0, 'desligado: corretor lê 0 conversas');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_conversas_1a1 WHERE organization_id = pg_temp.id('orgA')) = 2,
  'desligar não apaga as conversas (2 continuam)');
UPDATE public.organization_modules SET enabled = true WHERE organization_id = pg_temp.id('orgA') AND module = 'inteligencia_gestao';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.gestao_conversas_1a1) = 2, 'religado: gestor volta a ver as 2');
RESET ROLE;

-- 7) "O que fazer hoje" do corretor igual ao de antes -----------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
CREATE TEMP TABLE pn AS SELECT * FROM public.minhas_pendencias();
RESET ROLE;
SELECT pg_temp.ok((SELECT coalesce(md5(string_agg(x::text, ',' ORDER BY x::text)), '') FROM pn x)
                = (SELECT coalesce(md5(string_agg(x::text, ',' ORDER BY x::text)), '') FROM pendencias_antes x)
  AND (SELECT count(*) FROM pn) = (SELECT count(*) FROM pendencias_antes),
  'minhas_pendencias() de C2 idêntica à de antes da migration');
SELECT pg_temp.ok((SELECT count(*) FROM pn) > 0, 'C2 tem pendências (a comparação não é vazia)');

-- 8) Segurança das funções --------------------------------------------------------------------------------------
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.inteligencia_gestao_modulo_ligado(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.carreira_pendencias_de(uuid)', 'EXECUTE'),
  'authenticated não executa as funções internas');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.gestao_farol_dados(integer,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.gestao_1a1_salvar(uuid,date,jsonb,jsonb,date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.gestao_pendencias_corretor(uuid)', 'EXECUTE'),
  'anon não executa as RPCs');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
    AND proname IN ('gestao_farol_dados', 'gestao_1a1_salvar', 'gestao_1a1_remarcar', 'gestao_pode_ver',
                    'gestao_pode_conduzir', 'gestao_pendencias_corretor', 'carreira_pendencias_de', 'minhas_pendencias',
                    'inteligencia_gestao_enabled', 'inteligencia_gestao_modulo_ligado')
    AND coalesce(proconfig, '{}') <> ARRAY['search_path=""']),
  'todas as SECURITY DEFINER com search_path vazio');
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.gestao_conversas_1a1'::regclass)
  AND NOT has_table_privilege('authenticated', 'public.gestao_conversas_1a1', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.gestao_conversas_1a1', 'SELECT'),
  'tabela com RLS; authenticated só lê; anon nada');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err('SELECT public.gestao_farol_dados(2027)') LIKE '42501%', 'sem login: recusado');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
