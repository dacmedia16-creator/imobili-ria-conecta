-- Suíte da migration 20261207120000 (painéis de metas 2027, etapa 3: painel do gestor/broker/TL).
-- Roda DENTRO de transação revertida (run-metas-2027-painel-gestor.sh). Dados fictícios; nada fica gravado.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0).
--   Equipe UE (ue) = a1 (UE Corretor) + ga (UE Gestor, líder; papel gestor);
--   Equipe TL Homolog (tlh) = a3 (QA A Corretor Tres) + tl (QA A Corretor Um, líder, team_leader);
--   go = QA A Gestor (gestor); adm = QA A Admin; fin = QA A Financeiro; b1 = QA B Corretor Um; badm = QA B Admin.
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
-- Pessoas (user_id) devolvidas por metas_equipe_planos / linhas de metas_equipe_realizado.
CREATE FUNCTION pg_temp.pessoas(_j jsonb) RETURNS uuid[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg((x ->> 'user_id')::uuid ORDER BY x ->> 'user_id'), '{}') FROM jsonb_array_elements(_j -> 'pessoas') x $$;
CREATE FUNCTION pg_temp.vendas(_j jsonb, _sale uuid) RETURNS integer LANGUAGE sql AS
  $$ SELECT count(*)::integer FROM jsonb_array_elements(_j -> 'vendas') x WHERE (x ->> 'sale_id')::uuid = _sale $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.as_user(text), pg_temp.id(text),
  pg_temp.pessoas(jsonb), pg_temp.vendas(jsonb, uuid) TO authenticated;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('ue', '1a000000-0000-4000-8000-000000000001'), ('tlh', '3b000000-0000-4000-8000-0000000004a7'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('ga', '10000000-0000-4000-8000-000000000002'),
  ('a3', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('tl', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('go', 'cab7391a-463f-4d97-b99b-ced6e4696796'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('fin', 'b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'), ('badm', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
CREATE TEMP TABLE d AS SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje;
GRANT SELECT ON d TO authenticated;

-- Pré-condição da homologação (não é teste da migration).
SELECT pg_temp.ok(public.equipe_vigente(pg_temp.id('a1'), now()) = pg_temp.id('ue')
  AND public.equipe_vigente(pg_temp.id('a3'), now()) = pg_temp.id('tlh')
  AND public.equipe_vigente(pg_temp.id('tl'), now()) = pg_temp.id('tlh'),
  'pré: A1 na Equipe UE; A3 e o TL na Equipe TL Homolog');

-- Dados fictícios (só nesta transação) --------------------------------------------------------------------
-- V1 (A): A1 (Equipe UE) capta, A3 (Equipe TL) vende → venda DIVIDIDA entre 2 equipes. VB (B): B1 capta e vende.
CREATE FUNCTION pg_temp.venda(_k text, _org text, _capt text, _vend text, _valor numeric, _liq_capt numeric,
  _liq_vend numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _s uuid := gen_random_uuid(); _o uuid := gen_random_uuid();
BEGIN
  INSERT INTO ids VALUES (_k, _s), ('o' || _k, _o);
  INSERT INTO public.sales (id, organization_id, corretor_id, corretor_captador_id, corretor_vendedor_id, status,
    modalidade, codigo_interno, imovel_id, imovel_endereco, imovel_bairro, tipo_imovel, valor_negociado,
    valor_total_comissao, data_assinatura, valor_comissao_captador, valor_comissao_vendedor)
  VALUES (_s, pg_temp.id(_org), pg_temp.id(_capt), pg_temp.id(_capt), pg_temp.id(_vend), 'contrato_assinado',
    'padrao', CASE _k WHEN 'v1' THEN '999999911-1' ELSE '999999912-1' END, 'QA-MT3-' || _k, 'Rua QA Metas ' || _k,
    'Bairro QA', 'Casa', _valor, _valor * 0.06, (now() AT TIME ZONE 'America/Sao_Paulo')::date, _liq_capt, _liq_vend);
  INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
  VALUES (_s, pg_temp.id(_org), 'contrato_assinado', now());
  INSERT INTO public.occurrences (id, sale_id, organization_id, status) VALUES (_o, _s, pg_temp.id(_org), 'pendente');
  INSERT INTO public.occurrence_commissions (occurrence_id, organization_id, papel, user_id, valor)
  VALUES (_o, pg_temp.id(_org), 'corretor_captador', pg_temp.id(_capt), _liq_capt),
         (_o, pg_temp.id(_org), 'corretor_vendedor', pg_temp.id(_vend), _liq_vend);
END $$;
SELECT pg_temp.venda('v1', 'orgA', 'a1', 'a3', 500000, 9000, 7000);
SELECT pg_temp.venda('vb', 'orgB', 'b1', 'b1', 700000, 20000, 20000);
-- Plano assinado de A3 com respostas da meta + campos que NÃO entram na conta (nome do sonho, notas, despesa).
INSERT INTO public.carreira_plano (organization_id, user_id, ano, respostas, assinado_corretor_em)
VALUES (pg_temp.id('orgA'), pg_temp.id('a3'), 2027,
  jsonb_build_object('mt.tCapt', '14', 'mt.tVenda', '10', 'mt.comMedia', '5000', 'mt.novas', '30', 'm.ticket', '400000',
                     'mt.mes.tcapt.3', '2', 'so.0.n', 'Viagem QA', 'so.0.v', '20000', 'av.0', '3', 'op.0', '5000',
                     'or.0.c', '4', 'es.aliq', '10'), now());
-- Plano em preenchimento do TL SEM transações (a conta precisa das despesas pessoais → elas vão).
INSERT INTO public.carreira_plano (organization_id, user_id, ano, respostas)
VALUES (pg_temp.id('orgA'), pg_temp.id('tl'), 2027,
  jsonb_build_object('op.0', '6000', 'op.3', '1.500', 'es.aliq', '10', 'm.faixa', '50', 'm.ticket', '300000', 'm.pct', '3',
                     'av.1', '4', 'so.1.n', 'Carro QA'))
ON CONFLICT (organization_id, user_id, ano) DO UPDATE SET respostas = EXCLUDED.respostas;
CREATE TEMP TABLE antes AS SELECT md5(string_agg(t, ',' ORDER BY t)) h FROM (
  SELECT s::text t FROM public.sales s WHERE s.id IN (SELECT v FROM ids)
  UNION ALL SELECT c::text FROM public.occurrence_commissions c JOIN public.occurrences o ON o.id = c.occurrence_id
   WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT p::text FROM public.carreira_plano p WHERE p.organization_id IN (SELECT v FROM ids)) x;
GRANT SELECT ON antes TO authenticated;

-- 0) Escopo: aditiva e protegida --------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT bool_and(prosecdef AND proconfig = ARRAY['search_path=""']) FROM pg_proc
  WHERE oid IN ('public.metas_equipe_planos(integer,uuid)'::regprocedure, 'public.metas_equipe_realizado(date,date,uuid)'::regprocedure,
                'public.metas_equipe_escopo(uuid)'::regprocedure, 'public.metas_equipe_broker()'::regprocedure)),
  'RPCs SECURITY DEFINER com search_path vazio');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.metas_equipe_planos(integer,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.metas_equipe_realizado(date,date,uuid)', 'EXECUTE'), 'anon não executa as RPCs');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.metas_equipe_escopo(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.metas_equipe_broker()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.metas_respostas_meta(jsonb)', 'EXECUTE'),
  'funções internas sem EXECUTE para usuários');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
  WHERE p.proname LIKE 'metas\_%' AND p.pronamespace = 'public'::regnamespace AND x.grantee = 0), 'PUBLIC sem EXECUTE');

SET LOCAL ROLE authenticated;
-- 1) Quem NÃO acessa ------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_equipe_planos(2027)') LIKE '42501%'
  AND pg_temp.err('SELECT public.metas_equipe_realizado(current_date - 1, current_date)') LIKE '42501%',
  'corretor não acessa (planos e realizado)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.metas_equipe_planos(2027, %L)', pg_temp.id('ue'))) LIKE '42501%',
  'corretor não acessa nem a própria equipe');
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_equipe_planos(2027)') LIKE '42501%', 'financeiro não acessa');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_equipe_planos(2027)') LIKE '42501%'
  AND pg_temp.err('SELECT public.metas_equipe_realizado(current_date - 1, current_date)') LIKE '42501%', 'sem login: recusado');

-- 2) Team Leader: só a equipe dele -----------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
CREATE TEMP TABLE jt AS SELECT public.metas_equipe_planos(2027) j;
SELECT pg_temp.ok(pg_temp.id('a3') = ANY (pg_temp.pessoas((SELECT j FROM jt))) AND pg_temp.id('tl') = ANY (pg_temp.pessoas((SELECT j FROM jt))),
  'TL vê A3 e ele mesmo');
SELECT pg_temp.ok(NOT (pg_temp.id('a1') = ANY (pg_temp.pessoas((SELECT j FROM jt))))
  AND NOT (pg_temp.id('ga') = ANY (pg_temp.pessoas((SELECT j FROM jt)))),
  'TL NÃO vê A1 nem o gestor da Equipe UE');
SELECT pg_temp.ok((SELECT bool_and((x ->> 'team_id')::uuid = pg_temp.id('tlh')) FROM jsonb_array_elements((SELECT j FROM jt) -> 'pessoas') x),
  'TL: todas as pessoas são da Equipe TL');
SELECT pg_temp.ok((SELECT jsonb_array_length(j -> 'equipes') = 1 AND (j -> 'equipes' -> 0 ->> 'id')::uuid = pg_temp.id('tlh')
  AND NOT (j ->> 'todas')::boolean FROM jt), 'TL: lista de equipes só com a dele e todas = false');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.metas_equipe_planos(2027, %L)', pg_temp.id('ue'))) LIKE '42501%'
  AND pg_temp.err(format('SELECT public.metas_equipe_realizado(current_date - 1, current_date, %L)', pg_temp.id('ue'))) LIKE '42501%',
  'TL pedindo outra equipe: recusado (planos e realizado)');
CREATE TEMP TABLE rt AS SELECT public.metas_equipe_realizado((SELECT hoje - 1 FROM d), (SELECT hoje FROM d)) j;
SELECT pg_temp.ok(pg_temp.vendas((SELECT j FROM rt), pg_temp.id('v1')) = 1
  AND (SELECT (x ->> 'user_id')::uuid = pg_temp.id('a3') AND (x ->> 'comissao')::numeric = 7000
       FROM jsonb_array_elements((SELECT j FROM rt) -> 'vendas') x WHERE (x ->> 'sale_id')::uuid = pg_temp.id('v1')),
  'TL: na venda dividida vê só a linha de A3 (7 mil), não a parte de A1');

-- 3) Respostas do plano: só o que a conta usa ------------------------------------------------------------------
SELECT pg_temp.ok((SELECT x -> 'respostas' ?& ARRAY['mt.tCapt', 'mt.tVenda', 'mt.comMedia', 'mt.novas', 'm.ticket', 'mt.mes.tcapt.3']
                     AND x ->> 'assinado_em' IS NOT NULL
                   FROM jsonb_array_elements((SELECT j FROM jt) -> 'pessoas') x WHERE (x ->> 'user_id')::uuid = pg_temp.id('a3')),
  'plano de A3: vêm as respostas da meta e a data de assinatura');
SELECT pg_temp.ok((SELECT NOT (x -> 'respostas' ?| ARRAY['so.0.n', 'so.0.v', 'av.0', 'op.0', 'or.0.c', 'es.aliq'])
                   FROM jsonb_array_elements((SELECT j FROM jt) -> 'pessoas') x WHERE (x ->> 'user_id')::uuid = pg_temp.id('a3')),
  'plano de A3: NÃO vêm sonho, notas, origens nem despesas (a conta não precisa)');
SELECT pg_temp.ok((SELECT x -> 'respostas' ?& ARRAY['op.0', 'es.aliq', 'm.faixa'] AND NOT (x -> 'respostas' ?| ARRAY['av.1', 'so.1.n', 'op.1', 'op.3'])
                     AND (x -> 'respostas' ->> 'op.0')::numeric = 7500 AND x ->> 'assinado_em' IS NULL
                   FROM jsonb_array_elements((SELECT j FROM jt) -> 'pessoas') x WHERE (x ->> 'user_id')::uuid = pg_temp.id('tl')),
  'plano em preenchimento sem transações: despesas saem só SOMADAS (6 mil + 1,5 mil), sem item, notas nem sonho');

-- 4) Broker (admin e gestor): todas as equipes da imobiliária --------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
CREATE TEMP TABLE ja AS SELECT public.metas_equipe_planos(2027) j;
SELECT pg_temp.ok(pg_temp.pessoas((SELECT j FROM ja)) @> ARRAY[pg_temp.id('a1'), pg_temp.id('a3'), pg_temp.id('tl'), pg_temp.id('ga')]
  AND (SELECT (j ->> 'todas')::boolean AND jsonb_array_length(j -> 'equipes') >= 3 FROM ja),
  'admin vê as pessoas e as equipes da imobiliária inteira');
SELECT pg_temp.ok(NOT (pg_temp.id('b1') = ANY (pg_temp.pessoas((SELECT j FROM ja))))
  AND NOT (pg_temp.id('adm') = ANY (pg_temp.pessoas((SELECT j FROM ja))))
  AND NOT (pg_temp.id('fin') = ANY (pg_temp.pessoas((SELECT j FROM ja)))),
  'admin: sem gente da B; admin e financeiro (não vendem) fora da lista');
SELECT pg_temp.ok(pg_temp.pessoas(public.metas_equipe_planos(2027, pg_temp.id('ue'))) @> ARRAY[pg_temp.id('a1')]
  AND NOT (pg_temp.id('a3') = ANY (pg_temp.pessoas(public.metas_equipe_planos(2027, pg_temp.id('ue'))))),
  'admin filtrando a Equipe UE: só quem é dela');
CREATE TEMP TABLE ra AS SELECT public.metas_equipe_realizado((SELECT hoje - 1 FROM d), (SELECT hoje FROM d)) j;
SELECT pg_temp.ok(pg_temp.vendas((SELECT j FROM ra), pg_temp.id('v1')) = 2
  AND (SELECT count(DISTINCT x ->> 'vgv') = 1 AND min((x ->> 'vgv')::numeric) > 0
       FROM jsonb_array_elements((SELECT j FROM ra) -> 'vendas') x WHERE (x ->> 'sale_id')::uuid = pg_temp.id('v1')),
  'admin: venda dividida em 2 linhas (1 por pessoa) com o MESMO VGV da venda (a regra soma 1 vez)');
SELECT pg_temp.ok((SELECT sum((x ->> 'comissao')::numeric) FROM jsonb_array_elements((SELECT j FROM ra) -> 'vendas') x
                    WHERE (x ->> 'sale_id')::uuid = pg_temp.id('v1')) = 16000
  AND (SELECT sum((x ->> 'lados')::integer) FROM jsonb_array_elements((SELECT j FROM ra) -> 'vendas') x
        WHERE (x ->> 'sale_id')::uuid = pg_temp.id('v1')) = 2,
  'admin: comissão da venda = parte de A1 + parte de A3 (16 mil); 1 lado cada');
SELECT pg_temp.ok(NOT ((SELECT j FROM ra) -> 'vendas' -> 0 ?| ARRAY['comissao_bruta', 'valor_total_comissao', 'imobiliaria'])
  AND (SELECT bool_and((x ->> 'conta_equipe')::boolean AND (x ->> 'ponta')::boolean)
         FROM jsonb_array_elements((SELECT j FROM ra) -> 'vendas') x WHERE (x ->> 'sale_id')::uuid = pg_temp.id('v1')),
  'realizado não traz a bruta nem a parte da imobiliária; marca quem conta para a equipe e quem é ponta');
SELECT pg_temp.ok(pg_temp.vendas((SELECT j FROM ra), pg_temp.id('vb')) = 0, 'admin da A não vê a venda da B');
SELECT pg_temp.as_user(pg_temp.id('go')::text);
SELECT pg_temp.ok(pg_temp.pessoas(public.metas_equipe_planos(2027)) @> ARRAY[pg_temp.id('a1'), pg_temp.id('a3')]
  AND pg_temp.err(format('SELECT public.metas_equipe_planos(2027, %L)', pg_temp.id('tlh'))) IS NULL,
  'gestor (de outra equipe) vê todas as equipes da imobiliária');
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok(pg_temp.pessoas(public.metas_equipe_planos(2027)) @> ARRAY[pg_temp.id('a1'), pg_temp.id('a3')],
  'gestor que lidera a Equipe UE também vê a imobiliária inteira (broker)');

-- 5) Mesma base de meu_realizado ---------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a3')::text);
CREATE TEMP TABLE m3 AS SELECT comissao FROM public.meu_realizado((SELECT hoje - 1 FROM d), (SELECT hoje FROM d));
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok((SELECT sum((x ->> 'comissao')::numeric) FROM jsonb_array_elements((SELECT j FROM ra) -> 'vendas') x
                    WHERE (x ->> 'user_id')::uuid = pg_temp.id('a3')) = (SELECT comissao FROM m3),
  'comissão de A3 no painel = meu_realizado de A3 no mesmo período');

-- 6) Imobiliária A × B --------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('badm')::text);
CREATE TEMP TABLE jb AS SELECT public.metas_equipe_planos(2027) j;
SELECT pg_temp.ok(pg_temp.id('b1') = ANY (pg_temp.pessoas((SELECT j FROM jb)))
  AND NOT (pg_temp.pessoas((SELECT j FROM jb)) && ARRAY[pg_temp.id('a1'), pg_temp.id('a3'), pg_temp.id('tl')]),
  'admin da B vê só gente da B');
SELECT pg_temp.ok((SELECT jsonb_array_length(j -> 'equipes') = 0 FROM jb), 'admin da B não vê equipes da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.metas_equipe_planos(2027, %L)', pg_temp.id('ue'))) LIKE '42501%',
  'admin da B pedindo a equipe da A: recusado');
CREATE TEMP TABLE rb AS SELECT public.metas_equipe_realizado((SELECT hoje - 1 FROM d), (SELECT hoje FROM d)) j;
SELECT pg_temp.ok(pg_temp.vendas((SELECT j FROM rb), pg_temp.id('vb')) = 1 AND pg_temp.vendas((SELECT j FROM rb), pg_temp.id('v1')) = 0,
  'admin da B vê a venda da B e não a da A');
-- Papel admin gravado para a imobiliária B numa pessoa da A (forçado só nesta transação, sem gatilhos):
-- has_any_role enxerga o papel, mas o broker exige o papel DESTA imobiliária → A1 continua recusado na A.
RESET ROLE;
SET LOCAL session_replication_role = replica;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('a1'), 'admin', pg_temp.id('orgB'));
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_equipe_planos(2027)') LIKE '42501%', 'admin só da B não vira broker na A');
-- Mesmo caso num Team Leader da A (achado da revisão): painel_equipe_permitido sozinho liberaria todas as equipes.
RESET ROLE;
SET LOCAL session_replication_role = replica;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('tl'), 'admin', pg_temp.id('orgB'));
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok(NOT (pg_temp.pessoas(public.metas_equipe_planos(2027)) && ARRAY[pg_temp.id('a1'), pg_temp.id('ga')])
  AND (SELECT jsonb_array_length(j -> 'equipes') = 1 AND NOT (j ->> 'todas')::boolean FROM (SELECT public.metas_equipe_planos(2027) j) s)
  AND pg_temp.err(format('SELECT public.metas_equipe_planos(2027, %L)', pg_temp.id('ue'))) LIKE '42501%'
  AND pg_temp.vendas(public.metas_equipe_realizado((SELECT hoje - 1 FROM d), (SELECT hoje FROM d)), pg_temp.id('v1')) = 1,
  'TL da A com papel admin na B continua vendo só a equipe dele (planos, equipes e realizado)');
RESET ROLE;
SET LOCAL session_replication_role = replica;
DELETE FROM public.user_roles WHERE user_id = pg_temp.id('a1') AND role = 'admin' AND organization_id = pg_temp.id('orgB');
DELETE FROM public.user_roles WHERE user_id = pg_temp.id('tl') AND role = 'admin' AND organization_id = pg_temp.id('orgB');
SET LOCAL session_replication_role = origin;

-- 7) Inativo, módulo desligado e validação ---------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('tl');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_equipe_planos(2027)') LIKE '42501%', 'TL inativo: recusado');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(NOT (pg_temp.id('tl') = ANY (pg_temp.pessoas(public.metas_equipe_planos(2027)))), 'pessoa inativa sai da lista');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('a3');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(NOT (pg_temp.id('a3') = ANY (pg_temp.pessoas(public.metas_equipe_planos(2027))))
  AND pg_temp.vendas(public.metas_equipe_realizado((SELECT hoje - 1 FROM d), (SELECT hoje FROM d)), pg_temp.id('v1')) = 2
  AND pg_temp.vendas(public.metas_equipe_realizado((SELECT hoje - 1 FROM d), (SELECT hoje FROM d), pg_temp.id('tlh')), pg_temp.id('v1')) = 0,
  'quem saiu: some da lista e da equipe, mas a venda dele continua no total da imobiliária (broker)');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
UPDATE public.profiles SET ativo = true WHERE id = pg_temp.id('a3');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
UPDATE public.profiles SET ativo = true WHERE id = pg_temp.id('tl');
UPDATE public.organization_modules SET enabled = false WHERE organization_id = pg_temp.id('orgA') AND module = 'meu_plano_2027';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok((SELECT bool_and(x -> 'respostas' = 'null'::jsonb OR x -> 'respostas' = '{}'::jsonb)
                     AND bool_and(NOT (x ->> 'tem_plano')::boolean) AND NOT (bool_or((j ->> 'modulo_plano')::boolean))
                   FROM (SELECT public.metas_equipe_planos(2027) j) s, jsonb_array_elements(s.j -> 'pessoas') x),
  'Meu Plano desligado: nenhuma resposta de plano sai');
RESET ROLE;
UPDATE public.organization_modules SET enabled = true WHERE organization_id = pg_temp.id('orgA') AND module = 'meu_plano_2027';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_equipe_realizado(current_date, current_date - 1)') LIKE '22023%'
  AND pg_temp.err('SELECT public.metas_equipe_realizado(current_date - 400, current_date)') LIKE '22023%'
  AND pg_temp.err('SELECT public.metas_equipe_realizado(NULL, current_date)') LIKE '22023%'
  AND pg_temp.err('SELECT public.metas_equipe_planos(1999)') LIKE '22023%',
  'período invertido, > 1 ano, vazio ou ano inválido: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.metas_equipe_planos(2027, %L)', gen_random_uuid())) LIKE '42501%',
  'equipe que não existe: recusado');
RESET ROLE;
-- Coordenador de lançamento: a linha vem marcada para ficar FORA da soma da equipe (participacoes_comerciais_validas).
INSERT INTO public.occurrence_commissions (occurrence_id, organization_id, papel, user_id, valor)
VALUES (pg_temp.id('ov1'), pg_temp.id('orgA'), 'coordenador_lancamento', pg_temp.id('ga'), 300);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok((SELECT count(*) = 1 AND bool_and(NOT (x ->> 'conta_equipe')::boolean AND NOT (x ->> 'ponta')::boolean
                                          AND (x ->> 'lados')::int = 0 AND (x ->> 'comissao')::numeric = 300)
                     FROM jsonb_array_elements(public.metas_equipe_realizado((SELECT hoje - 1 FROM d), (SELECT hoje FROM d)) -> 'vendas') x
                    WHERE (x ->> 'user_id')::uuid = pg_temp.id('ga') AND (x ->> 'sale_id')::uuid = pg_temp.id('v1')),
  'coordenador de lançamento: linha vem com conta_equipe = false e ponta = false');
RESET ROLE;
DELETE FROM public.occurrence_commissions WHERE occurrence_id = pg_temp.id('ov1') AND papel = 'coordenador_lancamento';

-- 8) Só leitura -----------------------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT h FROM antes) = (SELECT md5(string_agg(t, ',' ORDER BY t)) FROM (
  SELECT s::text t FROM public.sales s WHERE s.id IN (SELECT v FROM ids)
  UNION ALL SELECT c::text FROM public.occurrence_commissions c JOIN public.occurrences o ON o.id = c.occurrence_id
   WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT p::text FROM public.carreira_plano p WHERE p.organization_id IN (SELECT v FROM ids)) x),
  'as RPCs não alteram vendas, comissões nem planos');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
