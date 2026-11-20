-- Suíte da migration 20261206120000 (painéis de metas 2027, etapa 2: anotações + comissão do corretor).
-- Roda DENTRO de transação revertida (run-metas-2027-painel-corretor.sh). Dados fictícios; nada fica gravado.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0).
--   a1 = UE Corretor (equipe "Equipe UE", líder ga = UE Gestor);
--   a3 = QA A Corretor Tres (equipe "Equipe TL Homolog", líder tl = QA A Corretor Um, team_leader);
--   go = QA A Gestor (gestor de OUTRA equipe); adm = QA A Admin; b1 = QA B Corretor Um; badm = QA B Admin.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.n(_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE _n integer;
BEGIN EXECUTE _sql; GET DIAGNOSTICS _n = ROW_COUNT; RETURN _n; EXCEPTION WHEN others THEN RETURN -1; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.n(text), pg_temp.as_user(text),
  pg_temp.id(text) TO authenticated;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('ga', '10000000-0000-4000-8000-000000000002'),
  ('a3', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('tl', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('go', 'cab7391a-463f-4d97-b99b-ced6e4696796'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'), ('badm', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536');
CREATE TEMP TABLE d AS SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje;
GRANT SELECT ON d TO authenticated;

-- Pré-condição da homologação (não é teste da migration): equipes e líderes como descrito acima.
SELECT pg_temp.ok(public.equipe_vigente(pg_temp.id('a1'), now()) = '1a000000-0000-4000-8000-000000000001'
  AND public.equipe_vigente(pg_temp.id('a3'), now()) = '3b000000-0000-4000-8000-0000000004a7',
  'pré: A1 na Equipe UE e A3 na Equipe TL Homolog');

-- 0) Escopo: aditiva --------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FROM pg_policies WHERE tablename = 'carreira_anotacoes') = 4
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'carreira_anotacoes' AND permissive = 'RESTRICTIVE') = 2,
  'anotações: 4 policies, isolamento por imobiliária e usuário ativo restritivos');
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.carreira_anotacoes'::regclass),
  'RLS ligada em carreira_anotacoes');

-- 1) Dono grava, edita e apaga só as próprias -------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.carreira_anotacoes (texto, proximo_passo, proximo_passo_em)
  VALUES ('Liguei para o proprietário (QA)', 'Levar ACM', current_date + 3)$q$) IS NULL, 'A1 grava anotação com próximo passo e data');
SELECT pg_temp.ok((SELECT bool_and(user_id = pg_temp.id('a1') AND organization_id = pg_temp.id('orgA')) FROM public.carreira_anotacoes),
  'anotação fica em nome de A1 na imobiliária A');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_anotacoes (user_id, texto) VALUES (%L, ''x'')', pg_temp.id('a3'))) LIKE '42501%',
  'A1 não grava em nome de A3');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_anotacoes (organization_id, texto) VALUES (%L, ''x'')', pg_temp.id('orgB'))) LIKE '42501%',
  'A1 não grava na imobiliária B');
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.carreira_anotacoes (texto) VALUES ('   ')$q$) LIKE '23514%'
  AND pg_temp.err(format('INSERT INTO public.carreira_anotacoes (texto) VALUES (%L)', repeat('a', 2001))) LIKE '23514%'
  AND pg_temp.err(format('INSERT INTO public.carreira_anotacoes (texto, proximo_passo) VALUES (''x'', %L)', repeat('a', 301))) LIKE '23514%',
  'texto vazio, texto > 2000 ou próximo passo > 300 são recusados');
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.carreira_anotacoes (texto, created_at) VALUES ('Antedatada (QA)', '2020-01-01')$q$) IS NULL,
  'grava anotação mandando created_at');
SELECT pg_temp.ok((SELECT created_at > now() - interval '1 minute' FROM public.carreira_anotacoes WHERE texto = 'Antedatada (QA)'),
  'data de criação é do servidor (não dá para antedatar)');
DELETE FROM public.carreira_anotacoes WHERE texto = 'Antedatada (QA)';
SELECT pg_temp.ok(pg_temp.n($q$UPDATE public.carreira_anotacoes SET texto = 'Liguei e marquei visita (QA)'$q$) = 1,
  'A1 edita a própria anotação');
SELECT pg_temp.ok((SELECT updated_at >= created_at FROM public.carreira_anotacoes LIMIT 1), 'edição atualiza updated_at');
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.carreira_anotacoes SET user_id = %L', pg_temp.id('a3'))) LIKE '42501%',
  'A1 não passa a anotação para outra pessoa');
SELECT pg_temp.as_user(pg_temp.id('a3')::text);
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.carreira_anotacoes (texto) VALUES ('Anotação de A3 (QA)')$q$) IS NULL,
  'A3 grava a própria anotação');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes) = 1, 'A3 vê só a dele (não vê a de A1)');
SELECT pg_temp.ok(pg_temp.n(format('UPDATE public.carreira_anotacoes SET texto = ''x'' WHERE user_id = %L', pg_temp.id('a1'))) = 0
  AND pg_temp.n(format('DELETE FROM public.carreira_anotacoes WHERE user_id = %L', pg_temp.id('a1'))) = 0,
  'A3 não edita nem apaga a anotação de A1');

-- 2) Gestor/TL da equipe e admin: só leitura --------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes WHERE user_id = pg_temp.id('a1')) = 1
  AND (SELECT count(*) FROM public.carreira_anotacoes WHERE user_id = pg_temp.id('a3')) = 0,
  'gestor da Equipe UE lê a de A1 e não a de A3 (outra equipe)');
SELECT pg_temp.ok(pg_temp.n('UPDATE public.carreira_anotacoes SET texto = ''x''') = 0
  AND pg_temp.n('DELETE FROM public.carreira_anotacoes') = 0, 'gestor não edita nem apaga');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_anotacoes (user_id, texto) VALUES (%L, ''x'')', pg_temp.id('a1'))) LIKE '42501%',
  'gestor não grava em nome do corretor');
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes WHERE user_id = pg_temp.id('a3')) = 1
  AND (SELECT count(*) FROM public.carreira_anotacoes WHERE user_id = pg_temp.id('a1')) = 0,
  'Team Leader lê a de A3 (equipe dele) e não a de A1');
SELECT pg_temp.ok(pg_temp.n('UPDATE public.carreira_anotacoes SET texto = ''x''') = 0
  AND pg_temp.n('DELETE FROM public.carreira_anotacoes') = 0, 'Team Leader não edita nem apaga');
SELECT pg_temp.as_user(pg_temp.id('go')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes) = 0, 'gestor de outra equipe não lê nenhuma das duas');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes) = 2, 'admin da imobiliária A lê as duas');
SELECT pg_temp.ok(pg_temp.n('UPDATE public.carreira_anotacoes SET texto = ''x''') = 0
  AND pg_temp.n('DELETE FROM public.carreira_anotacoes') = 0, 'admin não edita nem apaga');

-- 3) Organização A × B ------------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes) = 0, 'B1 não vê anotações da imobiliária A');
-- Em 2 instruções: na mesma, o Postgres calcula a subconsulta antes do INSERT.
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.carreira_anotacoes (texto) VALUES ('Anotação de B1 (QA)')$q$) IS NULL,
  'B1 grava a dele');
SELECT pg_temp.ok((SELECT count(*) = 1 AND bool_and(organization_id = pg_temp.id('orgB')) FROM public.carreira_anotacoes),
  'a anotação de B1 fica na imobiliária B');
SELECT pg_temp.as_user(pg_temp.id('badm')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes) = 1
  AND (SELECT bool_and(organization_id = pg_temp.id('orgB')) FROM public.carreira_anotacoes),
  'admin da B lê só a da B');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes WHERE organization_id = pg_temp.id('orgB')) = 0,
  'admin da A não lê a da B');
-- Papel admin gravado para a imobiliária B numa pessoa da A (o gatilho de org normalmente impede; aqui é
-- forçado só nesta transação, sem gatilhos). A leitura exige admin DESTA imobiliária: não pode ler nada.
RESET ROLE;
SET LOCAL session_replication_role = replica;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (pg_temp.id('a1'), 'admin', pg_temp.id('orgB'));
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes WHERE user_id = pg_temp.id('a3')) = 0,
  'admin só da imobiliária B não lê anotações da A');
RESET ROLE;
SET LOCAL session_replication_role = replica;
DELETE FROM public.user_roles WHERE user_id = pg_temp.id('a1') AND role = 'admin' AND organization_id = pg_temp.id('orgB');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;

-- 4) Apagar a própria; inativo, sem login e anon -----------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('a3')::text);
SELECT pg_temp.ok(pg_temp.n('DELETE FROM public.carreira_anotacoes') = 1, 'A3 apaga a própria');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);  -- trava existente: só admin desativa usuário
UPDATE public.profiles SET ativo = false WHERE id = pg_temp.id('a1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes) = 0, 'inativo não lê a própria');
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.carreira_anotacoes (texto) VALUES ('x')$q$) LIKE '42501%', 'inativo não grava');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.minha_comissao_vendas(current_date - 30, current_date)') LIKE '42501%',
  'inativo não consulta a comissão');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
UPDATE public.profiles SET ativo = true WHERE id = pg_temp.id('a1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_anotacoes) = 0, 'sem login: não lê');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.minha_comissao_vendas(current_date - 30, current_date)') LIKE '42501%',
  'sem login: comissão recusada');
RESET ROLE;
SELECT pg_temp.ok(NOT has_table_privilege('anon', 'public.carreira_anotacoes', 'SELECT,INSERT,UPDATE,DELETE'),
  'anon sem acesso à tabela');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.minha_comissao_vendas(date,date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.carreira_anotacoes_pode_ler(uuid)', 'EXECUTE'), 'anon não executa as funções');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
  WHERE p.oid IN ('public.minha_comissao_vendas(date,date)'::regprocedure, 'public.carreira_anotacoes_pode_ler(uuid)'::regprocedure,
                  'public.carreira_anotacoes_editar()'::regprocedure) AND x.grantee = 0), 'PUBLIC sem EXECUTE');
SELECT pg_temp.ok((SELECT bool_and(prosecdef AND proconfig = ARRAY['search_path=""']) FROM pg_proc
  WHERE oid IN ('public.minha_comissao_vendas(date,date)'::regprocedure, 'public.carreira_anotacoes_pode_ler(uuid)'::regprocedure)),
  'RPC e função de leitura: SECURITY DEFINER com search_path vazio');
SELECT pg_temp.ok((SELECT NOT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
  WHERE oid = 'public.carreira_anotacoes_editar()'::regprocedure),
  'gatilho de datas roda com o usuário (sem privilégio extra) e search_path vazio');

-- 5) Comissão do corretor ---------------------------------------------------------------------------------
-- Venda V1 (A): A1 captador (bruta dele 10 mil; indicador 1,5 mil e extra 500 descontados DELE → 8 mil),
-- A3 vendedor (8 mil, sem desconto). VB (B): B1 capta e vende. Bruta da venda 30 mil (6% de 500 mil).
CREATE FUNCTION pg_temp.venda(_k text, _org text, _capt text, _vend text, _valor numeric, _c_capt numeric,
  _c_vend numeric, _ind_capt numeric, _liq_capt numeric, _liq_vend numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _s uuid := gen_random_uuid(); _o uuid := gen_random_uuid();
BEGIN
  INSERT INTO ids VALUES (_k, _s), ('o' || _k, _o);
  INSERT INTO public.sales (id, organization_id, corretor_id, corretor_captador_id, corretor_vendedor_id, status,
    modalidade, codigo_interno, imovel_id, imovel_endereco, imovel_bairro, tipo_imovel, valor_negociado,
    valor_total_comissao, data_assinatura, valor_comissao_captador, valor_comissao_vendedor,
    valor_comissao_indicador_captador)
  VALUES (_s, pg_temp.id(_org), pg_temp.id(_capt), pg_temp.id(_capt), pg_temp.id(_vend), 'contrato_assinado',
    'padrao', CASE _k WHEN 'v1' THEN '999999901-1' ELSE '999999902-1' END, 'QA-MT2-' || _k, 'Rua QA Metas ' || _k, 'Bairro QA', 'Casa', _valor,
    _valor * 0.06, (now() AT TIME ZONE 'America/Sao_Paulo')::date, _c_capt, _c_vend, _ind_capt);
  INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
  VALUES (_s, pg_temp.id(_org), 'contrato_assinado', now());
  INSERT INTO public.occurrences (id, sale_id, organization_id, status) VALUES (_o, _s, pg_temp.id(_org), 'pendente');
  INSERT INTO public.occurrence_commissions (occurrence_id, organization_id, papel, user_id, valor)
  VALUES (_o, pg_temp.id(_org), 'corretor_captador', pg_temp.id(_capt), _liq_capt),
         (_o, pg_temp.id(_org), 'corretor_vendedor', pg_temp.id(_vend), _liq_vend);
END $$;
SELECT pg_temp.venda('v1', 'orgA', 'a1', 'a3', 500000, 10000, 8000, 1500, 8000, 8000);
INSERT INTO public.sale_commission_extras (sale_id, organization_id, nome, origem, valor, papel)
VALUES (pg_temp.id('v1'), pg_temp.id('orgA'), 'Extra QA', 'captador', 500, 'outro');
SELECT pg_temp.venda('vb', 'orgB', 'b1', 'b1', 700000, 20000, 20000, 0, 20000, 20000);
CREATE TEMP TABLE antes AS SELECT md5(string_agg(t, ',' ORDER BY t)) h FROM (
  SELECT s::text t FROM public.sales s WHERE s.id IN (SELECT v FROM ids)
  UNION ALL SELECT c::text FROM public.occurrence_commissions c JOIN public.occurrences o ON o.id = c.occurrence_id
   WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT e::text FROM public.sale_commission_extras e WHERE e.sale_id IN (SELECT v FROM ids)) x;
GRANT SELECT ON antes TO authenticated;
SELECT pg_temp.ok((public.calcular_distribuicao_venda(pg_temp.id('v1')) ->> 'liquido_captador')::numeric = 8000,
  'pré: cálculo oficial dá 8 mil líquidos ao captador de V1');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
CREATE TEMP TABLE c1 AS SELECT * FROM public.minha_comissao_vendas((SELECT hoje - 1 FROM d), (SELECT hoje FROM d));
SELECT pg_temp.ok((SELECT count(*) FROM c1) = 1 AND (SELECT sale_id FROM c1) = pg_temp.id('v1'), 'A1 vê só V1, em 1 linha');
SELECT pg_temp.ok((SELECT minha_parte = 8000 AND indicador = 1500 AND extras = 500 AND descontado = 2000 FROM c1),
  'A1: sua parte 8 mil; descontado dele 2 mil (indicador 1,5 mil + extra 500)');
SELECT pg_temp.ok((SELECT venda_em = (SELECT hoje FROM d) AND papel = 'captador' AND imovel = 'Casa · Bairro QA'
  AND codigo = 'QA-MT2-v1' FROM c1), 'data da assinatura (SP), papel, imóvel e código');
SELECT pg_temp.ok((SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
  WHERE attrelid = 'c1'::regclass AND attnum > 0 AND NOT attisdropped)
  = ARRAY['sale_id', 'venda_em', 'imovel', 'codigo', 'papel', 'lados', 'vgv', 'minha_parte', 'indicador', 'extras', 'descontado'],
  'sem coluna de comissão bruta, parte da imobiliária ou parceria');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM c1 WHERE 30000 IN (minha_parte, indicador, extras, descontado, vgv)),
  'nenhum campo traz a bruta da venda (30 mil)');
SELECT pg_temp.ok((SELECT sum(minha_parte) FROM c1) = (SELECT comissao FROM public.meu_realizado((SELECT hoje - 1 FROM d), (SELECT hoje FROM d))),
  'soma da parte de A1 = comissão de meu_realizado no mesmo período');
SELECT pg_temp.as_user(pg_temp.id('a3')::text);
CREATE TEMP TABLE c3 AS SELECT * FROM public.minha_comissao_vendas((SELECT hoje - 1 FROM d), (SELECT hoje FROM d));
SELECT pg_temp.ok((SELECT minha_parte = 8000 AND indicador = 0 AND extras = 0 AND papel = 'vendedor' FROM c3 WHERE sale_id = pg_temp.id('v1')),
  'A3 (vendedor): 8 mil, sem o desconto que foi do captador');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
CREATE TEMP TABLE cb AS SELECT * FROM public.minha_comissao_vendas((SELECT hoje - 1 FROM d), (SELECT hoje FROM d));
SELECT pg_temp.ok((SELECT count(*) FROM cb) = 1 AND (SELECT minha_parte = 40000 AND papel = 'captador e vendedor' AND lados = 2 FROM cb),
  'B1 vê só a venda dele na B (capta e vende: 40 mil, 2 lados)');
SELECT pg_temp.ok((SELECT lados FROM c1) = 1 AND (SELECT lados FROM c3 WHERE sale_id = pg_temp.id('v1')) = 1,
  'A1 (captador) e A3 (vendedor): 1 lado cada');
SELECT pg_temp.ok((SELECT count(*) FROM cb WHERE sale_id = pg_temp.id('v1')) = 0
  AND (SELECT count(*) FROM c1 WHERE sale_id = pg_temp.id('vb')) = 0, 'A e B não veem vendas uma da outra');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.minha_comissao_vendas((SELECT hoje - 1 FROM d), (SELECT hoje FROM d))) = 0,
  'admin sem participação não recebe a venda de A1 por esta RPC (é só do próprio corretor)');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((SELECT count(*) FROM public.minha_comissao_vendas((SELECT hoje - 400 FROM d), (SELECT hoje - 40 FROM d))) = 0,
  'fora do período: nada');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.minha_comissao_vendas(current_date, current_date - 1)') LIKE '22023%'
  AND pg_temp.err('SELECT * FROM public.minha_comissao_vendas(current_date - 400, current_date)') LIKE '22023%'
  AND pg_temp.err('SELECT * FROM public.minha_comissao_vendas(NULL, current_date)') LIKE '22023%',
  'período invertido, maior que 1 ano ou vazio é recusado');
RESET ROLE;

-- 6) Nada mudou em vendas, comissões e extras pela leitura ---------------------------------------------------
SELECT pg_temp.ok((SELECT h FROM antes) = (SELECT md5(string_agg(t, ',' ORDER BY t)) FROM (
  SELECT s::text t FROM public.sales s WHERE s.id IN (SELECT v FROM ids)
  UNION ALL SELECT c::text FROM public.occurrence_commissions c JOIN public.occurrences o ON o.id = c.occurrence_id
   WHERE o.sale_id IN (SELECT v FROM ids)
  UNION ALL SELECT e::text FROM public.sale_commission_extras e WHERE e.sale_id IN (SELECT v FROM ids)) x),
  'a RPC não altera vendas, comissões nem extras');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
