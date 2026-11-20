-- Suíte da migration 20261210120000 (Minha imobiliária, t_f7f1b3e4). Roda DENTRO de transação revertida
-- (run-minha-imobiliaria.sh). Dados fictícios só nesta transação; nada fica gravado.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0).
--   a1 = corretor da A; tl = Team Leader da A; go = gestor da A; adm = admin da A; fin = financeiro da A;
--   b1 = corretor da B; badm = admin da B.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE j(k text PRIMARY KEY, v jsonb);
GRANT ALL ON r, ids, j TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM j WHERE k = _k $$;
CREATE FUNCTION pg_temp.guarda(_k text, _v jsonb) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO j VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v $$;
-- número no caminho do JSON (null = 0)
CREATE FUNCTION pg_temp.n(_v jsonb, VARIADIC _p text[]) RETURNS numeric LANGUAGE sql AS
  $$ SELECT coalesce((_v #>> _p)::numeric, 0) $$;
-- linha de uma pessoa numa lista do JSON
CREATE FUNCTION pg_temp.de(_v jsonb, _lista text, _uid uuid) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT x FROM jsonb_array_elements(_v -> _lista) x WHERE (x ->> 'user_id')::uuid = _uid $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.as_user(text), pg_temp.id(text),
  pg_temp.j(text), pg_temp.guarda(text, jsonb), pg_temp.n(jsonb, text[]), pg_temp.de(jsonb, text, uuid) TO authenticated;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('tl', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('go', 'cab7391a-463f-4d97-b99b-ced6e4696796'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('fin', 'b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'),
  ('badm', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
CREATE TEMP TABLE d AS SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje;
GRANT SELECT ON d TO authenticated;

SELECT pg_temp.ok(
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = pg_temp.id('adm') AND role = 'admin' AND organization_id = pg_temp.id('orgA'))
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = pg_temp.id('go') AND role = 'gestor' AND organization_id = pg_temp.id('orgA'))
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = pg_temp.id('badm') AND role = 'admin' AND organization_id = pg_temp.id('orgB'))
  AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = pg_temp.id('a1') AND role IN ('admin', 'gestor', 'team_leader', 'super_admin')),
  'pré: papéis da homologação (admin/gestor/TL da A, admin da B, A1 só corretor)');

-- 0) Estrutura: aditiva, protegida e só leitura ----------------------------------------------------------------
SELECT pg_temp.ok((SELECT bool_and(prosecdef AND proconfig = ARRAY['search_path=""'] AND provolatile = 's') FROM pg_proc
  WHERE oid IN ('public.minha_imobiliaria_resumo()'::regprocedure, 'public.minha_imobiliaria_atividades(integer)'::regprocedure,
                'public.minha_imobiliaria_org()'::regprocedure)),
  'RPCs SECURITY DEFINER, search_path vazio e STABLE (só leitura)');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.minha_imobiliaria_resumo()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.minha_imobiliaria_atividades(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.minha_imobiliaria_org()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.minha_imobiliaria_respostas_funil(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.minha_imobiliaria_resumo()', 'EXECUTE'),
  'anon não executa; funções internas sem EXECUTE para usuários');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
  WHERE p.proname LIKE 'minha_imobiliaria%' AND p.pronamespace = 'public'::regnamespace AND x.grantee = 0), 'PUBLIC sem EXECUTE');
SELECT pg_temp.ok(public.minha_imobiliaria_respostas_funil(
    '{"op.0":"6.000","op.1":"2000","on.2":"1500","so.1.v":"30000","fu.v2cre":"50","m.conv":"25","d.obs":"x","mt.tCapt":"9"}')
  = '{"op.0":8000,"on.0":1500,"so.0.v":30000,"fu.v2cre":"50","m.conv":"25"}'::jsonb,
  'recorte do funil: só taxas do funil e as SOMAS das despesas (nada item a item, nada de fora)');

-- Fotografia ANTES dos dados de teste (como admin da A e da B) --------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.guarda('rA0', public.minha_imobiliaria_resumo());
SELECT pg_temp.as_user(pg_temp.id('badm')::text);
SELECT pg_temp.guarda('rB0', public.minha_imobiliaria_resumo());
RESET ROLE;

-- Dados fictícios na A (sem gatilhos; só nesta transação) -------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO ids VALUES ('capV', gen_random_uuid()), ('capN', gen_random_uuid()), ('capX', gen_random_uuid()),
  ('sP', gen_random_uuid()), ('sOk', gen_random_uuid()), ('lead1', gen_random_uuid()), ('lead2', gen_random_uuid()),
  ('lead3', gen_random_uuid()), ('cob', gen_random_uuid());
-- capV: assinada há 170 dias com prazo 180 → vence em 10 dias; capN: aprovada HOJE (histórico) → nova no mês;
-- capX: aprovada hoje mas DESCARTADA → não conta.
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, status, form_data, organization_id, signed_on, discarded_at)
VALUES
  (pg_temp.id('capV'), pg_temp.id('a1'), pg_temp.id('a1'), 'campolim', 'aprovada',
   '{"imovel":{"endereco":"Rua QA Minha Imob, 1"},"condicoes":{"prazo_dias_numero":"180"}}', pg_temp.id('orgA'),
   (SELECT hoje - 170 FROM d), NULL),
  (pg_temp.id('capN'), pg_temp.id('a1'), pg_temp.id('a1'), 'campolim', 'aprovada', '{}', pg_temp.id('orgA'), NULL, NULL),
  (pg_temp.id('capX'), pg_temp.id('a1'), pg_temp.id('a1'), 'campolim', 'aprovada', '{}', pg_temp.id('orgA'), NULL, now());
INSERT INTO public.exclusive_history (capture_id, action, created_at, organization_id, actor_id)
VALUES (pg_temp.id('capN'), 'aprovar', now(), pg_temp.id('orgA'), pg_temp.id('go')),
       (pg_temp.id('capX'), 'aprovar', now(), pg_temp.id('orgA'), pg_temp.id('go'));
-- Venda parada há 10 dias (sem histórico) e venda andando (mudou de etapa hoje).
INSERT INTO public.sales (id, corretor_id, organization_id, status, created_at) VALUES
  (pg_temp.id('sP'), pg_temp.id('a1'), pg_temp.id('orgA'), 'aguardando_assinatura', now() - interval '10 days'),
  (pg_temp.id('sOk'), pg_temp.id('a1'), pg_temp.id('orgA'), 'enviada_juridico', now() - interval '10 days');
INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
VALUES (pg_temp.id('sOk'), pg_temp.id('orgA'), 'enviada_juridico', now());
-- Leads (módulo ligado só nesta transação): 1 esperando há 30h; 1 aceito em 10 min; 1 aceito em 60 min (prazo 30).
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'leads', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.lead_config (organization_id, prazo_aceite_min) VALUES (pg_temp.id('orgA'), 30)
  ON CONFLICT (organization_id) DO UPDATE SET prazo_aceite_min = 30;
INSERT INTO public.leads (id, organization_id, nome, telefone, origem, etapa, responsavel_id, atribuido_em, aceito_em, created_at)
VALUES
  (pg_temp.id('lead1'), pg_temp.id('orgA'), 'Lead QA 1', '15900000101', 'olx', 'novo', pg_temp.id('a1'),
   now() - interval '30 hours', NULL, now() - interval '30 hours'),
  (pg_temp.id('lead2'), pg_temp.id('orgA'), 'Lead QA 2', '15900000102', 'site', 'em_atendimento', pg_temp.id('a1'),
   now() - interval '3 hours', now() - interval '3 hours' + interval '10 minutes', now() - interval '3 hours'),
  (pg_temp.id('lead3'), pg_temp.id('orgA'), 'Lead QA 3', '15900000103', 'site', 'em_atendimento', pg_temp.id('a1'),
   now() - interval '3 hours', now() - interval '2 hours', now() - interval '3 hours');
-- Aluguel em atraso (R$ 1.000, venceu há 12 dias).
INSERT INTO public.locacao_cobrancas (id, organization_id, contrato_id, competencia, vencimento, aluguel, taxa_adm, valor, status)
VALUES (pg_temp.id('cob'), pg_temp.id('orgA'), gen_random_uuid(), date_trunc('month', (SELECT hoje FROM d))::date,
        (SELECT hoje - 12 FROM d), 1000, 10, 1000, 'aberta');
-- Diário: V1 = 3 e V2 = 2 do A1 hoje; V1 = 99 no mês passado (não conta).
INSERT INTO public.carreira_diario (organization_id, user_id, dia, tipo, quantidade) VALUES
  (pg_temp.id('orgA'), pg_temp.id('a1'), (SELECT hoje FROM d), 'v1', 3),
  (pg_temp.id('orgA'), pg_temp.id('a1'), (SELECT hoje FROM d), 'v2', 2),
  (pg_temp.id('orgA'), pg_temp.id('a1'), (SELECT (date_trunc('month', hoje) - interval '1 day')::date FROM d), 'v1', 99);
-- Plano 2027 do A1 com despesas item a item (só a soma pode sair).
DELETE FROM public.carreira_plano WHERE organization_id = pg_temp.id('orgA') AND user_id = pg_temp.id('a1') AND ano = 2027;
INSERT INTO public.carreira_plano (organization_id, user_id, ano, respostas)
VALUES (pg_temp.id('orgA'), pg_temp.id('a1'), 2027,
        '{"op.0":"4000","op.3":"1000","fu.v2cre":"40","m.conv":"20","d.segredo":"nao sai"}');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'meu_plano_2027', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
SET LOCAL session_replication_role = origin;

-- 1) Acesso: só dono/admin DESTA imobiliária --------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.minha_imobiliaria_resumo()') IS NULL
  AND pg_temp.err('SELECT public.minha_imobiliaria_atividades(2027)') IS NULL, 'admin da A: lê resumo e atividades');
SELECT pg_temp.as_user(pg_temp.id('go')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.minha_imobiliaria_resumo()') LIKE '42501%'
  AND pg_temp.err('SELECT public.minha_imobiliaria_atividades(2027)') LIKE '42501%', 'gestor: recusado (42501)');
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.minha_imobiliaria_resumo()') LIKE '42501%'
  AND pg_temp.err('SELECT public.minha_imobiliaria_atividades(2027)') LIKE '42501%', 'Team Leader: recusado');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.minha_imobiliaria_resumo()') LIKE '42501%'
  AND pg_temp.err('SELECT public.minha_imobiliaria_atividades(2027)') LIKE '42501%', 'corretor: recusado');
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.minha_imobiliaria_resumo()') LIKE '42501%', 'financeiro: recusado');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT public.minha_imobiliaria_resumo()') LIKE '42501%', 'sem login: recusado');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.err('SET LOCAL ROLE anon; SELECT public.minha_imobiliaria_resumo()') LIKE '42501%', 'anon: sem permissão');
RESET ROLE;
-- Papel admin da B numa pessoa da A: has_any_role enxerga, mas o papel tem de ser DESTA imobiliária.
SET LOCAL session_replication_role = replica;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('a1'), 'admin', pg_temp.id('orgB'));
-- Dono (super_admin) da A: o financeiro vira Administrador principal só nesta transação.
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('fin'), 'super_admin', pg_temp.id('orgA'));
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.minha_imobiliaria_resumo()') LIKE '42501%'
  AND pg_temp.err('SELECT public.minha_imobiliaria_atividades(2027)') LIKE '42501%',
  'corretor da A com papel admin na B: continua recusado na A');
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.minha_imobiliaria_resumo()') IS NULL, 'Administrador principal (dono) da A: lê');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.minha_imobiliaria_atividades(1999)') LIKE '22023%'
  AND pg_temp.err('SELECT public.minha_imobiliaria_atividades(NULL)') LIKE '22023%', 'ano inválido: recusado');

-- 2) Números da A (diferença em relação à fotografia) ------------------------------------------------------------
SELECT pg_temp.guarda('rA', public.minha_imobiliaria_resumo());
SELECT pg_temp.guarda('aA', public.minha_imobiliaria_atividades(2027));
SELECT pg_temp.ok((SELECT pg_temp.j('rA') ->> 'hoje' = hoje::text FROM d)
  AND pg_temp.j('rA') -> 'modulos' = '{"captacao":true,"leads":true,"locacao":true}', 'resumo: hoje (SP) e módulos');
SELECT pg_temp.ok(pg_temp.n(pg_temp.j('rA'), 'exclusivas', 'vencendo') - pg_temp.n(pg_temp.j('rA0'), 'exclusivas', 'vencendo') = 1
  AND pg_temp.j('rA') #>> '{exclusivas,vencendo_primeira_imovel}' IS NOT NULL,
  'exclusivas: vencendo em 15 dias pela data de assinatura + prazo');
SELECT pg_temp.ok(pg_temp.n(pg_temp.j('rA'), 'exclusivas', 'novas_mes') - pg_temp.n(pg_temp.j('rA0'), 'exclusivas', 'novas_mes') = 1,
  'exclusivas: nova no mês pela DATA DE APROVAÇÃO; descartada não conta');
SELECT pg_temp.ok(pg_temp.n(pg_temp.j('rA'), 'exclusivas', 'ativas') - pg_temp.n(pg_temp.j('rA0'), 'exclusivas', 'ativas') = 2,
  'exclusivas: ativas = aprovadas, não arquivadas nem descartadas');
SELECT pg_temp.ok(pg_temp.n(pg_temp.j('rA'), 'leads', 'sem_atendimento') = 1
  AND pg_temp.n(pg_temp.j('rA'), 'leads', 'mais_antigo_horas') BETWEEN 29 AND 30
  AND pg_temp.j('rA') #>> '{leads,mais_antigo_origem}' = 'olx',
  'leads: 1 sem atendimento há mais de 24h (o mais antigo e a origem)');
SELECT pg_temp.ok(pg_temp.n(pg_temp.j('rA'), 'leads', 'prazo_aceite_min') = 30
  AND pg_temp.n(pg_temp.j('rA'), 'leads', 'elegiveis_mes') >= 3 AND pg_temp.n(pg_temp.j('rA'), 'leads', 'no_prazo_mes') = 1,
  'leads: no prazo = aceito dentro do prazo de aceite da imobiliária (30 min)');
SELECT pg_temp.ok(pg_temp.n(pg_temp.j('rA'), 'vendas_paradas', 'qtd') - pg_temp.n(pg_temp.j('rA0'), 'vendas_paradas', 'qtd') = 1
  AND pg_temp.n(pg_temp.j('rA'), 'vendas_paradas', 'maior_dias') >= 10,
  'vendas paradas: sem mudança de etapa há mais de 5 dias (a que andou hoje não conta)');
SELECT pg_temp.ok(pg_temp.n(pg_temp.j('rA'), 'alugueis', 'qtd') - pg_temp.n(pg_temp.j('rA0'), 'alugueis', 'qtd') = 1
  AND pg_temp.n(pg_temp.j('rA'), 'alugueis', 'valor') - pg_temp.n(pg_temp.j('rA0'), 'alugueis', 'valor') = 1000
  AND pg_temp.n(pg_temp.j('rA'), 'alugueis', 'maior_dias') >= 12, 'aluguéis em atraso: quantidade, valor e maior atraso');
SELECT pg_temp.ok(pg_temp.j('rA') -> 'produtivos' ?& ARRAY['ativos', 'produtivos', 'admins_que_venderam', 'ativos_ant', 'produtivos_ant']
  AND pg_temp.n(pg_temp.j('rA'), 'produtivos', 'produtivos') <= pg_temp.n(pg_temp.j('rA'), 'produtivos', 'ativos')
  AND jsonb_typeof(pg_temp.j('rA') -> 'novos_sem_venda') = 'number', 'produtivos e corretores novos: campos e coerência');
SELECT pg_temp.ok((pg_temp.de(pg_temp.j('aA'), 'atividades', pg_temp.id('a1')) ->> 'v1')::int = 3
  AND (pg_temp.de(pg_temp.j('aA'), 'atividades', pg_temp.id('a1')) ->> 'v2')::int = 2,
  'atividades: V1/V2 do mês corrente (mês passado não entra)');
SELECT pg_temp.ok(pg_temp.de(pg_temp.j('aA'), 'funil', pg_temp.id('a1')) -> 'respostas'
  = '{"op.0":5000,"fu.v2cre":"40","m.conv":"20"}'::jsonb, 'atividades: recorte do plano sem despesas item a item');
SELECT pg_temp.ok(pg_temp.de(pg_temp.j('aA'), 'admins', pg_temp.id('adm')) IS NOT NULL
  AND pg_temp.de(pg_temp.j('aA'), 'admins', pg_temp.id('fin')) IS NOT NULL
  AND pg_temp.de(pg_temp.j('aA'), 'admins', pg_temp.id('go')) IS NULL, 'atividades: lista os administradores (admin e dono), não o gestor');

-- 3) Isolamento: a B não vê nada da A ---------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('badm')::text);
SELECT pg_temp.guarda('rB', public.minha_imobiliaria_resumo());
SELECT pg_temp.guarda('aB', public.minha_imobiliaria_atividades(2027));
SELECT pg_temp.ok(pg_temp.j('rB') - 'hoje' = pg_temp.j('rB0') - 'hoje', 'admin da B: resumo da B igual ao antes (nada da A vaza)');
SELECT pg_temp.ok(pg_temp.de(pg_temp.j('aB'), 'atividades', pg_temp.id('a1')) IS NULL
  AND pg_temp.de(pg_temp.j('aB'), 'funil', pg_temp.id('a1')) IS NULL
  AND pg_temp.de(pg_temp.j('aB'), 'admins', pg_temp.id('adm')) IS NULL, 'admin da B: atividades e planos da A não aparecem');

-- 4) Usuário inativo --------------------------------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('adm');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.minha_imobiliaria_resumo()') LIKE '42501%', 'admin inativo: recusado');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
