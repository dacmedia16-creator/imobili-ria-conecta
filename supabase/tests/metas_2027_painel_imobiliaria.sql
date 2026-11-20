-- Suíte da migration 20261208120000 (painéis de metas 2027, etapa 4: painel da imobiliária + meta da direção).
-- Roda DENTRO de transação revertida (run-metas-2027-painel-imobiliaria.sh). Dados fictícios; nada fica gravado.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0).
--   a1 = UE Corretor (corretor); tl = QA A Corretor Um (team_leader); go = QA A Gestor (gestor);
--   adm = QA A Admin (admin); fin = QA A Financeiro; b1 = QA B Corretor Um; badm = QA B Admin.
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
-- Linha da venda _sale na quebra (null = não veio).
CREATE FUNCTION pg_temp.q(_j jsonb, _sale uuid) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT x FROM jsonb_array_elements(_j -> 'vendas') x WHERE (x ->> 'sale_id')::uuid = _sale $$;
CREATE FUNCTION pg_temp.ndir() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.metas_direcao $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.as_user(text), pg_temp.id(text),
  pg_temp.q(jsonb, uuid), pg_temp.ndir() TO authenticated;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('a3', 'a742cfda-4731-4fa8-989a-374d2fdf0820'),
  ('tl', '5745cbff-22b6-4a28-a515-dd6706504b8b'), ('go', 'cab7391a-463f-4d97-b99b-ced6e4696796'),
  ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'), ('fin', 'b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'), ('badm', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
CREATE TEMP TABLE d AS SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje;
GRANT SELECT ON d TO authenticated;

-- Pré-condição da homologação (não é teste da migration): papéis esperados.
SELECT pg_temp.ok(
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = pg_temp.id('adm') AND role = 'admin' AND organization_id = pg_temp.id('orgA'))
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = pg_temp.id('go') AND role = 'gestor' AND organization_id = pg_temp.id('orgA'))
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = pg_temp.id('tl') AND role = 'team_leader' AND organization_id = pg_temp.id('orgA'))
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = pg_temp.id('badm') AND role = 'admin' AND organization_id = pg_temp.id('orgB'))
  AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = pg_temp.id('a1') AND role IN ('admin', 'gestor', 'team_leader', 'super_admin')),
  'pré: papéis da homologação (admin/gestor/TL da A, admin da B, A1 só corretor)');

-- Vendas fictícias (só nesta transação) --------------------------------------------------------------------------
-- V1 (A): bruta 30 mil = imobiliária 14 mil + indicador do captador 1 mil + captador 8 mil líquido + vendedor 7 mil.
-- VB (B): bruta 42 mil = imobiliária 2 mil + captador 20 mil + vendedor 20 mil.
CREATE FUNCTION pg_temp.venda(_k text, _org text, _capt text, _vend text, _valor numeric, _capt_v numeric,
  _vend_v numeric, _imob numeric, _ind_capt numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _s uuid := gen_random_uuid(); _o uuid := gen_random_uuid();
BEGIN
  INSERT INTO ids VALUES (_k, _s), ('o' || _k, _o);
  INSERT INTO public.sales (id, organization_id, corretor_id, corretor_captador_id, corretor_vendedor_id, status,
    modalidade, codigo_interno, imovel_id, imovel_endereco, imovel_bairro, tipo_imovel, valor_negociado,
    valor_total_comissao, data_assinatura, valor_comissao_captador, valor_comissao_vendedor,
    valor_comissao_imobiliaria, valor_comissao_indicador_captador)
  VALUES (_s, pg_temp.id(_org), pg_temp.id(_capt), pg_temp.id(_capt), pg_temp.id(_vend), 'contrato_assinado',
    'padrao', CASE _k WHEN 'v1' THEN '999999921-1' ELSE '999999922-1' END, 'QA-MT4-' || _k, 'Rua QA Metas ' || _k,
    'Bairro QA', 'Casa', _valor, _valor * 0.06, (now() AT TIME ZONE 'America/Sao_Paulo')::date, _capt_v, _vend_v,
    _imob, _ind_capt);
  INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
  VALUES (_s, pg_temp.id(_org), 'contrato_assinado', now());
  INSERT INTO public.occurrences (id, sale_id, organization_id, status) VALUES (_o, _s, pg_temp.id(_org), 'pendente');
  -- managed_by_sale = true: linhas geradas pela venda (como no sistema), não "comissão manual".
  INSERT INTO public.occurrence_commissions (occurrence_id, organization_id, papel, user_id, valor, managed_by_sale)
  VALUES (_o, pg_temp.id(_org), 'corretor_captador', pg_temp.id(_capt), _capt_v - _ind_capt, true),
         (_o, pg_temp.id(_org), 'corretor_vendedor', pg_temp.id(_vend), _vend_v, true);
END $$;
SELECT pg_temp.venda('v1', 'orgA', 'a1', 'a3', 500000, 9000, 7000, 14000, 1000);
SELECT pg_temp.venda('vb', 'orgB', 'b1', 'b1', 700000, 20000, 20000, 2000, 0);
CREATE TEMP TABLE antes AS SELECT md5(string_agg(t, ',' ORDER BY t)) h FROM (
  SELECT s::text t FROM public.sales s WHERE s.id IN (SELECT v FROM ids)
  UNION ALL SELECT c::text FROM public.occurrence_commissions c JOIN public.occurrences o ON o.id = c.occurrence_id
   WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT x::text FROM public.exclusive_captures x WHERE x.organization_id IN (SELECT v FROM ids)) x;
GRANT SELECT ON antes TO authenticated;
-- (o "antes" é tirado de novo depois dos dados do item 3, que mudam vendas de propósito)
-- Estoque esperado (lido como postgres, mesma regra da RPC).
CREATE TEMP TABLE est_esp AS SELECT o.k,
  CASE WHEN EXISTS (SELECT 1 FROM public.organization_modules om WHERE om.organization_id = pg_temp.id(o.k)
                     AND om.module = 'captacao_exclusiva' AND om.enabled)
       THEN (SELECT count(*) FROM public.exclusive_captures c WHERE c.organization_id = pg_temp.id(o.k)
               AND c.status = 'aprovada' AND c.discarded_at IS NULL AND c.archived_at IS NULL) END AS ativas
  FROM (VALUES ('orgA'), ('orgB')) o(k);
GRANT SELECT ON est_esp TO authenticated;

-- 0) Estrutura: aditiva e protegida --------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.metas_direcao'::regclass), 'metas_direcao com RLS ligada');
SELECT pg_temp.ok(has_table_privilege('authenticated', 'public.metas_direcao', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.metas_direcao', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.metas_direcao', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.metas_direcao', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.metas_direcao', 'SELECT'),
  'tabela: usuário só lê (grava só pela RPC); anon sem acesso');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM pg_constraint WHERE conrelid = 'public.metas_direcao'::regclass AND contype = 'u'
                    AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, ano)'), 'UNIQUE(org, ano)');
SELECT pg_temp.ok((SELECT bool_and(prosecdef AND proconfig = ARRAY['search_path=""']) FROM pg_proc
  WHERE oid IN ('public.metas_direcao_salvar(integer,numeric,numeric,integer,integer)'::regprocedure,
                'public.metas_comissao_quebra(date,date)'::regprocedure, 'public.metas_imobiliaria_estoque()'::regprocedure,
                'public.metas_direcao_papel(public.app_role[])'::regprocedure, 'public.metas_direcao_pode_ler()'::regprocedure)),
  'RPCs SECURITY DEFINER com search_path vazio');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.metas_direcao_salvar(integer,numeric,numeric,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.metas_comissao_quebra(date,date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.metas_imobiliaria_estoque()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.metas_direcao_papel(public.app_role[])', 'EXECUTE'),
  'anon não executa as RPCs; função interna sem EXECUTE para usuários');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
  WHERE p.proname IN ('metas_direcao_salvar', 'metas_comissao_quebra', 'metas_imobiliaria_estoque', 'metas_direcao_papel',
                      'metas_direcao_pode_ler') AND p.pronamespace = 'public'::regnamespace AND x.grantee = 0), 'PUBLIC sem EXECUTE');

SET LOCAL ROLE authenticated;
-- 1) Meta da direção: só o admin grava ------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_direcao_salvar(2027, 1400000, 60000000, 120, 200)') IS NULL,
  'admin grava a meta da direção 2027');
SELECT pg_temp.ok((SELECT count(*) = 1 AND min(meta_comissao) = 1400000 AND min(meta_vgv) = 60000000 AND min(meta_vendas) = 120
                     AND min(meta_captacoes) = 200 AND bool_and(updated_by = pg_temp.id('adm'))
                     AND bool_and(organization_id = pg_temp.id('orgA'))
                   FROM public.metas_direcao WHERE ano = 2027), 'admin lê a meta gravada, na imobiliária dele, com autor');
-- (gravar e conferir em instruções separadas: a conferência na mesma instrução enxerga a foto anterior)
CREATE TEMP TABLE s2 AS SELECT pg_temp.err('SELECT public.metas_direcao_salvar(2027, 1500000, NULL, 130, NULL)') e;
SELECT pg_temp.ok((SELECT e IS NULL FROM s2)
  AND (SELECT count(*) = 1 AND min(meta_comissao) = 1500000 AND bool_and(meta_vgv IS NULL) AND min(meta_vendas) = 130
       FROM public.metas_direcao WHERE ano = 2027),
  'salvar de novo atualiza a mesma linha (vazio = sem meta naquele indicador)');
SELECT pg_temp.ok(pg_temp.err('INSERT INTO public.metas_direcao (organization_id, ano) VALUES (current_org_id(), 2028)') LIKE '42501%'
  AND pg_temp.err('UPDATE public.metas_direcao SET meta_comissao = 1') LIKE '42501%'
  AND pg_temp.err('DELETE FROM public.metas_direcao') LIKE '42501%',
  'nem o admin grava direto na tabela (INSERT/UPDATE/DELETE recusados)');
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_direcao_salvar(2027, -1, NULL, NULL, NULL)') LIKE '22023%'
  AND pg_temp.err('SELECT public.metas_direcao_salvar(2027, NULL, NULL, -3, NULL)') LIKE '22023%'
  AND pg_temp.err('SELECT public.metas_direcao_salvar(1999, 1, 1, 1, 1)') LIKE '22023%'
  AND pg_temp.err('SELECT public.metas_direcao_salvar(NULL, 1, 1, 1, 1)') LIKE '22023%',
  'valor negativo ou ano inválido: recusado');
SELECT pg_temp.as_user(pg_temp.id('go')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_direcao_salvar(2027, 1, 1, 1, 1)') LIKE '42501%', 'gestor NÃO grava a meta da direção');
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_direcao_salvar(2027, 1, 1, 1, 1)') LIKE '42501%', 'Team Leader NÃO grava');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_direcao_salvar(2027, 1, 1, 1, 1)') LIKE '42501%', 'corretor NÃO grava');
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_direcao_salvar(2027, 1, 1, 1, 1)') LIKE '42501%', 'financeiro NÃO grava');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_direcao_salvar(2027, 1, 1, 1, 1)') LIKE '42501%', 'sem login: recusado');
SELECT pg_temp.as_user(pg_temp.id('badm')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_direcao_salvar(2027, 900000, NULL, 50, 80)') IS NULL,
  'admin da B grava a meta da B');

-- 2) Meta da direção: quem lê -------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('badm')::text);
SELECT pg_temp.ok((SELECT count(*) = 1 AND min(meta_comissao) = 900000 AND bool_and(organization_id = pg_temp.id('orgB'))
                   FROM public.metas_direcao), 'admin da B lê só a linha da B');
SELECT pg_temp.as_user(pg_temp.id('go')::text);
SELECT pg_temp.ok((SELECT count(*) = 1 AND min(meta_comissao) = 1500000 FROM public.metas_direcao), 'gestor da A lê só a meta da A');
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok((SELECT count(*) = 1 AND min(meta_comissao) = 1500000 FROM public.metas_direcao), 'Team Leader da A lê só a meta da A');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.ndir() = 0, 'corretor NÃO lê a meta da direção');
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok(pg_temp.ndir() = 0, 'financeiro NÃO lê a meta da direção');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.ndir() = 0, 'sem login: não lê nada');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.err('SET LOCAL ROLE anon; SELECT count(*) FROM public.metas_direcao') LIKE '42501%', 'anon: sem permissão na tabela');
RESET ROLE;

-- Papel admin gravado para a imobiliária B numa pessoa da A (forçado só nesta transação, sem gatilhos):
-- has_any_role enxerga o papel, mas a regra exige o papel DESTA imobiliária → A1 continua sem acesso na A.
SET LOCAL session_replication_role = replica;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('a1'), 'admin', pg_temp.id('orgB'));
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.ndir() = 0
  AND pg_temp.err('SELECT public.metas_direcao_salvar(2027, 1, 1, 1, 1)') LIKE '42501%'
  AND pg_temp.err('SELECT public.metas_comissao_quebra(current_date - 1, current_date)') LIKE '42501%'
  AND pg_temp.err('SELECT public.metas_imobiliaria_estoque()') LIKE '42501%',
  'corretor da A com papel admin na B: não lê, não grava, sem bruta e sem estoque na A');
RESET ROLE;
SET LOCAL session_replication_role = replica;
DELETE FROM public.user_roles WHERE user_id = pg_temp.id('a1') AND role = 'admin' AND organization_id = pg_temp.id('orgB');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;

-- 3) Quebra da comissão: só admin/gestor -----------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
CREATE TEMP TABLE qa AS SELECT public.metas_comissao_quebra((SELECT hoje - 1 FROM d), (SELECT hoje FROM d)) j;
SELECT pg_temp.ok((SELECT (pg_temp.q(j, pg_temp.id('v1')) ->> 'bruta')::numeric = 30000 FROM qa), 'admin: bruta da V1 = 30 mil');
SELECT pg_temp.ok((SELECT (x ->> 'imobiliaria')::numeric = 14000 AND (x ->> 'indicador')::numeric = 1000
                     AND (x ->> 'corretores')::numeric = 15000 AND (x ->> 'lideres')::numeric = 0
                     AND (x ->> 'parceria')::numeric = 0 AND (x ->> 'extras')::numeric = 0 AND (x ->> 'diferenca')::numeric = 0
                     AND (x ->> 'valido')::boolean
                   FROM (SELECT pg_temp.q(j, pg_temp.id('v1')) x FROM qa) s),
  'admin: V1 discriminada (imobiliária 14 mil, indicador 1 mil, corretores 15 mil, sem diferença)');
SELECT pg_temp.ok((SELECT bool_and(abs((x ->> 'bruta')::numeric + (x ->> 'premio')::numeric
                     - (x ->> 'imobiliaria')::numeric - (x ->> 'lideres')::numeric - (x ->> 'indicador')::numeric
                     - (x ->> 'parceria')::numeric - (x ->> 'extras')::numeric - (x ->> 'corretores')::numeric
                     - (x ->> 'diferenca')::numeric) < 0.02)
                   FROM qa, jsonb_array_elements(qa.j -> 'vendas') x),
  'toda venda fecha: bruta (+ prêmio) = imobiliária + líderes + indicador + parceria + extras + corretores + diferença');
SELECT pg_temp.ok((SELECT pg_temp.q(j, pg_temp.id('vb')) IS NULL FROM qa), 'admin da A não vê a venda da B na quebra');
SELECT pg_temp.ok((SELECT NOT (pg_temp.q(j, pg_temp.id('v1')) ?| ARRAY['user_id', 'nome', 'corretor_captador', 'imovel_endereco'])
                   FROM qa), 'quebra não traz nomes nem endereço (só valores)');
-- O líquido dos corretores da quebra bate com o realizado (occurrence_commissions) da mesma venda.
RESET ROLE;
CREATE TEMP TABLE oc_v1 AS SELECT sum(oc.valor) v FROM public.occurrence_commissions oc
  JOIN public.occurrences o ON o.id = oc.occurrence_id WHERE o.sale_id = pg_temp.id('v1') AND oc.papel IN ('corretor_captador', 'corretor_vendedor');
GRANT SELECT ON oc_v1 TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT (pg_temp.q(j, pg_temp.id('v1')) ->> 'corretores')::numeric FROM qa) = (SELECT v FROM oc_v1),
  'corretores na quebra = soma das partes dos corretores (mesma base do realizado)');
-- Coautor (outro corretor captador da divisão, 2 mil descontados do captador) conta em "corretores", não em extras.
-- (gatilhos desligados só nesta transação: o sync do sistema recopiaria as comissões da venda fictícia)
RESET ROLE;
SET LOCAL session_replication_role = replica;
INSERT INTO public.sale_commission_extras (sale_id, organization_id, nome, origem, valor, papel, user_id, lado)
VALUES (pg_temp.id('v1'), pg_temp.id('orgA'), 'Coautor QA', 'captador', 2000, 'corretor_captador', pg_temp.id('tl'), 'captador');
-- Lançamento (A): bruta 20 mil + prêmio 1 mil; divisão: corretor 8 mil, TL 2 mil, outro 1 mil.
CREATE FUNCTION pg_temp.lanc() RETURNS void LANGUAGE plpgsql AS $$
DECLARE _s uuid := gen_random_uuid();
BEGIN
  INSERT INTO ids VALUES ('vl', _s);
  INSERT INTO public.sales (id, organization_id, corretor_id, status, modalidade, codigo_interno, imovel_id,
    valor_negociado, valor_total_comissao, premio_valor, data_assinatura)
  -- Lançamento só é venda válida depois de entrar no Financeiro (vendas_comerciais_validas).
  VALUES (_s, pg_temp.id('orgA'), pg_temp.id('a1'), 'ocorrencia_analise_financeiro', 'lancamento', '999999923-1', 'QA-MT4-vl',
    400000, 20000, 1000, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
  VALUES (_s, pg_temp.id('orgA'), 'ocorrencia_analise_financeiro', now());
  INSERT INTO public.sale_commission_extras (sale_id, organization_id, nome, origem, valor, papel, user_id, sem_cadastro_confirmado)
  VALUES (_s, pg_temp.id('orgA'), 'Corretor QA', 'imobiliaria', 8000, 'corretor_vendedor', pg_temp.id('a1'), false),
         (_s, pg_temp.id('orgA'), 'TL QA', 'imobiliaria', 2000, 'team_leader', pg_temp.id('tl'), false),
         (_s, pg_temp.id('orgA'), 'Outro QA', 'imobiliaria', 1000, 'outro', pg_temp.id('fin'), false);
END $$;
SELECT pg_temp.lanc();
SET LOCAL session_replication_role = origin;
DROP TABLE antes;
CREATE TEMP TABLE antes AS SELECT md5(string_agg(t, ',' ORDER BY t)) h FROM (
  SELECT s::text t FROM public.sales s WHERE s.id IN (SELECT v FROM ids)
  UNION ALL SELECT c::text FROM public.occurrence_commissions c JOIN public.occurrences o ON o.id = c.occurrence_id
   WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT x::text FROM public.exclusive_captures x WHERE x.organization_id IN (SELECT v FROM ids)) x;
GRANT SELECT ON antes TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
CREATE TEMP TABLE qa2 AS SELECT public.metas_comissao_quebra((SELECT hoje - 1 FROM d), (SELECT hoje FROM d)) j;
SELECT pg_temp.ok((SELECT (x ->> 'corretores')::numeric = 15000 AND (x ->> 'extras')::numeric = 0
                     AND (x ->> 'indicador')::numeric = 1000 AND (x ->> 'diferenca')::numeric = 0
                     AND (x ->> 'imobiliaria')::numeric = 14000
                   FROM (SELECT pg_temp.q(j, pg_temp.id('v1')) x FROM qa2) s),
  'coautor da divisão (2 mil tirados do captador) conta em corretores (6 + 7 + 2 mil), não em extras');
SELECT pg_temp.ok((SELECT x IS NOT NULL AND x ->> 'modalidade' = 'lancamento' AND (x ->> 'bruta')::numeric = 20000
                     AND (x ->> 'premio')::numeric = 1000 AND (x ->> 'corretores')::numeric = 8000
                     AND (x ->> 'lideres')::numeric = 2000 AND (x ->> 'extras')::numeric = 1000
                     AND (x ->> 'parceria')::numeric = 0 AND (x ->> 'imobiliaria')::numeric = 10000
                   FROM (SELECT pg_temp.q(j, pg_temp.id('vl')) x FROM qa2) s),
  'lançamento: divisão separada por papel (corretor, TL, outros) e imobiliária = resto (20 + 1 − 11 mil)');
SELECT pg_temp.ok((SELECT bool_and(abs((x ->> 'bruta')::numeric + (x ->> 'premio')::numeric
                     - (x ->> 'imobiliaria')::numeric - (x ->> 'lideres')::numeric - (x ->> 'indicador')::numeric
                     - (x ->> 'parceria')::numeric - (x ->> 'extras')::numeric - (x ->> 'corretores')::numeric
                     - (x ->> 'diferenca')::numeric) < 0.02)
                   FROM qa2, jsonb_array_elements(qa2.j -> 'vendas') x),
  'com coautor e lançamento, toda venda continua fechando');
-- TL da A com papel admin gravado na B (forçado só nesta transação): continua sem a bruta e sem gravar na A.
RESET ROLE;
SET LOCAL session_replication_role = replica;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('tl'), 'admin', pg_temp.id('orgB'));
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_comissao_quebra(current_date - 1, current_date)') LIKE '42501%'
  AND pg_temp.err('SELECT public.metas_direcao_salvar(2027, 1, 1, 1, 1)') LIKE '42501%'
  AND pg_temp.err('SELECT public.metas_imobiliaria_estoque()') LIKE '42501%',
  'TL da A com papel admin na B: sem bruta, sem estoque e sem gravar na A');
RESET ROLE;
SET LOCAL session_replication_role = replica;
DELETE FROM public.user_roles WHERE user_id = pg_temp.id('tl') AND role = 'admin' AND organization_id = pg_temp.id('orgB');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('go')::text);
SELECT pg_temp.ok((SELECT (pg_temp.q(public.metas_comissao_quebra((SELECT hoje - 1 FROM d), (SELECT hoje FROM d)), pg_temp.id('v1')) ->> 'bruta')::numeric) = 30000,
  'gestor vê a quebra com a bruta');
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_comissao_quebra(current_date - 1, current_date)') LIKE '42501%', 'Team Leader NÃO recebe a bruta');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_comissao_quebra(current_date - 1, current_date)') LIKE '42501%', 'corretor NÃO recebe a bruta');
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_comissao_quebra(current_date - 1, current_date)') LIKE '42501%', 'financeiro NÃO recebe por esta RPC');
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_comissao_quebra(current_date - 1, current_date)') LIKE '42501%', 'sem login: recusado');
SELECT pg_temp.as_user(pg_temp.id('badm')::text);
CREATE TEMP TABLE qb AS SELECT public.metas_comissao_quebra((SELECT hoje - 1 FROM d), (SELECT hoje FROM d)) j;
SELECT pg_temp.ok((SELECT pg_temp.q(j, pg_temp.id('v1')) IS NULL AND (pg_temp.q(j, pg_temp.id('vb')) ->> 'bruta')::numeric = 42000 FROM qb),
  'admin da B vê a venda da B (bruta 42 mil) e não a da A');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_comissao_quebra(current_date, current_date - 1)') LIKE '22023%'
  AND pg_temp.err('SELECT public.metas_comissao_quebra(current_date - 400, current_date)') LIKE '22023%'
  AND pg_temp.err('SELECT public.metas_comissao_quebra(NULL, current_date)') LIKE '22023%',
  'período invertido, > 1 ano ou vazio: recusado');

-- 4) Estoque: só admin/gestor --------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
CREATE TEMP TABLE ea AS SELECT public.metas_imobiliaria_estoque() j;
SELECT pg_temp.ok((SELECT j ?& ARRAY['captacoes_ligadas', 'exclusivas_ativas', 'exclusivas_novas_30d', 'anuncios_xml', 'xml_em']
                     AND (j ->> 'exclusivas_ativas')::bigint IS NOT DISTINCT FROM (SELECT ativas FROM est_esp WHERE k = 'orgA') FROM ea),
  'admin: estoque da A igual à contagem direta');
SELECT pg_temp.as_user(pg_temp.id('go')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_imobiliaria_estoque()') IS NULL, 'gestor vê o estoque');
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_imobiliaria_estoque()') LIKE '42501%', 'Team Leader NÃO vê o estoque da imobiliária');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.metas_imobiliaria_estoque()') LIKE '42501%', 'corretor NÃO vê o estoque da imobiliária');
SELECT pg_temp.as_user(pg_temp.id('badm')::text);
SELECT pg_temp.ok((SELECT (public.metas_imobiliaria_estoque() ->> 'exclusivas_ativas')::bigint)
                    IS NOT DISTINCT FROM (SELECT ativas FROM est_esp WHERE k = 'orgB'), 'admin da B: estoque só da B');

-- 5) Usuário inativo -----------------------------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);   -- a trava de ativo exige um admin logado
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('go');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('go')::text);
SELECT pg_temp.ok(pg_temp.ndir() = 0 AND pg_temp.err('SELECT public.metas_comissao_quebra(current_date - 1, current_date)') LIKE '42501%',
  'gestor inativo: não lê a meta nem a quebra');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
UPDATE public.profiles SET ativo = true WHERE id = pg_temp.id('go');

-- 6) Só leitura onde deve --------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT h FROM antes) = (SELECT md5(string_agg(t, ',' ORDER BY t)) FROM (
  SELECT s::text t FROM public.sales s WHERE s.id IN (SELECT v FROM ids)
  UNION ALL SELECT c::text FROM public.occurrence_commissions c JOIN public.occurrences o ON o.id = c.occurrence_id
   WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT x::text FROM public.exclusive_captures x WHERE x.organization_id IN (SELECT v FROM ids)) x),
  'as RPCs não alteram vendas, comissões nem captações');
SELECT pg_temp.ok((SELECT count(*) FROM public.metas_direcao) = 2, 'metas_direcao só tem as 2 linhas gravadas pela RPC (A e B)');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
