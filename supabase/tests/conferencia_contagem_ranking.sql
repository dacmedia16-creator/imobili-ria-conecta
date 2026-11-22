-- Parte 2 da suíte da migration 20261225120000 (t_fee0b359): roda DEPOIS da migration, na mesma transação.
-- Compara com a foto ANTES gravada por conferencia_contagem_ranking_seed.sql.
CREATE TEMP TABLE depois(k text, u text, v jsonb);
GRANT ALL ON depois TO authenticated;
CREATE FUNCTION pg_temp.ant(_k text, _u text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM antes WHERE k = _k AND u = _u $$;
CREATE FUNCTION pg_temp.dep(_k text, _u text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM depois WHERE k = _k AND u = _u $$;
-- Diferença de contagem (depois − antes) de uma chave do Dashboard.
CREATE FUNCTION pg_temp.dif(_u text, _chave text) RETURNS int LANGUAGE sql AS
  $$ SELECT (pg_temp.dep('dash', _u) ->> _chave)::int - (pg_temp.ant('dash', _u) ->> _chave)::int $$;
-- Todas as chaves do Dashboard iguais, exceto minhas_vendas/meus_assinados.
CREATE FUNCTION pg_temp.resto_igual(_u text) RETURNS bool LANGUAGE sql AS
  $$ SELECT (pg_temp.ant('dash', _u) - 'minhas_vendas' - 'meus_assinados') = (pg_temp.dep('dash', _u) - 'minhas_vendas' - 'meus_assinados') $$;
CREATE FUNCTION pg_temp.soma(_j jsonb) RETURNS numeric LANGUAGE sql AS
  $$ SELECT coalesce(round(sum((e ->> 'comissao')::numeric), 2), 0) FROM jsonb_array_elements(_j) e $$;
CREATE FUNCTION pg_temp.linha(_j jsonb, _tipo text) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT e FROM jsonb_array_elements(_j -> 'ranking_equipe') e WHERE e ->> 'linha' = _tipo $$;
-- Linhas de equipe real, sem o campo novo, em ordem estável (para comparar com o antes).
CREATE FUNCTION pg_temp.equipes(_j jsonb, _novo bool) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(e - 'linha' ORDER BY e ->> 'team_id'), '[]') FROM jsonb_array_elements(_j -> 'ranking_equipe') e
   WHERE NOT _novo OR e ->> 'linha' = 'equipe' $$;
GRANT EXECUTE ON FUNCTION pg_temp.ant(text, text), pg_temp.dep(text, text), pg_temp.dif(text, text),
  pg_temp.resto_igual(text), pg_temp.soma(jsonb), pg_temp.linha(jsonb, text), pg_temp.equipes(jsonb, bool) TO authenticated;

-- Foto DEPOIS (funções novas), mesmas pessoas e períodos.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
INSERT INTO depois SELECT 'dash', 'a1', public.dashboard_stats();
SELECT pg_temp.as_user(pg_temp.id('a3')::text);
INSERT INTO depois SELECT 'dash', 'a3', public.dashboard_stats();
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
INSERT INTO depois SELECT 'dash', 'tl', public.dashboard_stats();
SELECT pg_temp.as_user(pg_temp.id('go')::text);
INSERT INTO depois SELECT 'dash', 'go', public.dashboard_stats();
SELECT pg_temp.as_user(pg_temp.id('se')::text);
INSERT INTO depois SELECT 'dash', 'se', public.dashboard_stats();
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
INSERT INTO depois SELECT 'dash', 'adm', public.dashboard_stats();
INSERT INTO depois SELECT 'rank_mes', 'adm', public.desempenho_ranking_periodo(
  date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
INSERT INTO depois SELECT 'rank_ano', 'adm', public.desempenho_ranking_periodo(
  date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
INSERT INTO depois SELECT 'rank_tl', 'tl', public.desempenho_equipe_ranking_periodo(
  date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
SELECT pg_temp.as_user(pg_temp.id('go')::text);
INSERT INTO depois SELECT 'rank_emp', 'go', public.desempenho_empresa_ranking_periodo(
  date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
RESET ROLE;

-- 0) Escopo -------------------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.dashboard_stats_leve()'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.desempenho_ranking_periodo(date,date)'::regprocedure),
  'segurança das funções igual (leve DEFINER; ranking INVOKER)');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.dashboard_stats_leve()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.desempenho_ranking_periodo(date,date)', 'EXECUTE'), 'anon segue sem executar');

-- A) Dashboard: contagem pela participação comercial ----------------------------------------------------------
SELECT pg_temp.ok(pg_temp.dif('tl', 'minhas_vendas') = -1 AND pg_temp.dif('tl', 'meus_assinados') = -1,
  'A: líder cadastrado como captador/vendedor que recebeu só como líder deixa de contar a venda (−1/−1)');
SELECT pg_temp.ok(pg_temp.dif('go', 'minhas_vendas') = -1 AND pg_temp.dif('go', 'meus_assinados') = -1,
  'A: coordenação de lançamento (corretor_id, sem captador/vendedor) deixa de contar o Lançamento sem participação (−1/−1)');
SELECT pg_temp.ok((pg_temp.ant('dash', 'go') ->> 'minhas_vendas')::int = 1,
  'A: o Lançamento com vendedor na participação extra já não contava para a coordenação ANTES (regra atual)');
SELECT pg_temp.ok(pg_temp.dif('a3', 'minhas_vendas') = 0 AND (pg_temp.dep('dash', 'a3') ->> 'minhas_vendas')::int = 1,
  'A: quem vendeu o Lançamento (comissão corretor_vendedor) continua contando 1');
SELECT pg_temp.ok(pg_temp.dif('a1', 'minhas_vendas') = 0 AND pg_temp.dif('a1', 'meus_assinados') = 0
  AND (pg_temp.dep('dash', 'a1') ->> 'minhas_vendas')::int >= 2,
  'A: corretor comum não muda (venda com ocorrência + venda ainda sem ocorrência pelo cadastro)');
-- UE Admin já tem na homologação Lançamentos antigos só como corretor_id (sem ocorrência): pela regra nova eles
-- deixam de contar. A variação esperada é calculada sobre esses dados, sem número fixo.
SELECT pg_temp.ok(pg_temp.dif('se', 'minhas_vendas') = -(SELECT count(*) FROM public.sales s
     WHERE s.organization_id = pg_temp.id('orgA') AND s.modalidade = 'lancamento' AND s.corretor_id = pg_temp.id('se')
       AND s.corretor_captador_id IS NULL AND s.corretor_vendedor_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.occurrences o JOIN public.occurrence_commissions oc ON oc.occurrence_id = o.id WHERE o.sale_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM public.sale_commission_extras e WHERE e.sale_id = s.id AND e.papel IN ('corretor_captador', 'corretor_vendedor') AND e.user_id IS NOT NULL))
  AND pg_temp.dif('adm', 'minhas_vendas') = 0 AND pg_temp.dif('adm', 'meus_assinados') = 0,
  'A: as demais pessoas só mudam pelos Lançamentos em que estão apenas como corretor_id');
SELECT pg_temp.ok(bool_and(pg_temp.resto_igual(u)), 'A: R$ e demais contadores do Dashboard idênticos para todas as pessoas')
  FROM (VALUES ('a1'), ('a3'), ('tl'), ('go'), ('se'), ('adm')) x(u);
SELECT pg_temp.ok((pg_temp.ant('dash', 'go') ->> 'minhas_pendencias') = (pg_temp.dep('dash', 'go') ->> 'minhas_pendencias')
  AND (pg_temp.ant('dash', 'go') ->> 'meus_contratos_conferir') = (pg_temp.dep('dash', 'go') ->> 'meus_contratos_conferir'),
  'A: pendências e contratos para conferir da coordenação continuam pelo responsável do Lançamento');

-- C) Ranking de equipes: Sem equipe + Coordenação de lançamento ---------------------------------------------
SELECT pg_temp.ok(pg_temp.ant(k, 'adm') -> 'ranking_corretor' = pg_temp.dep(k, 'adm') -> 'ranking_corretor'
  AND pg_temp.ant(k, 'adm') -> 'quantidade_captacoes' = pg_temp.dep(k, 'adm') -> 'quantidade_captacoes',
  'C (' || k || '): ranking por corretor e captações idênticos')
  FROM (VALUES ('rank_mes'), ('rank_ano')) x(k);
SELECT pg_temp.ok(pg_temp.equipes(pg_temp.ant(k, 'adm'), false) = pg_temp.equipes(pg_temp.dep(k, 'adm'), true),
  'C (' || k || '): linhas das equipes reais idênticas (mesmos valores e vendas)')
  FROM (VALUES ('rank_mes'), ('rank_ano')) x(k);
SELECT pg_temp.ok(pg_temp.soma(pg_temp.ant(k, 'adm') -> 'ranking_equipe') < pg_temp.soma(pg_temp.ant(k, 'adm') -> 'ranking_corretor'),
  'C (' || k || '): ANTES a soma das equipes ficava abaixo da soma das pessoas')
  FROM (VALUES ('rank_mes'), ('rank_ano')) x(k);
SELECT pg_temp.ok(pg_temp.soma(pg_temp.dep(k, 'adm') -> 'ranking_equipe') = pg_temp.soma(pg_temp.dep(k, 'adm') -> 'ranking_corretor'),
  'C (' || k || '): DEPOIS a soma de todas as linhas = soma das pessoas ('
    || pg_temp.soma(pg_temp.dep(k, 'adm') -> 'ranking_corretor') || ')')
  FROM (VALUES ('rank_mes'), ('rank_ano')) x(k);
SELECT pg_temp.ok((pg_temp.linha(pg_temp.dep('rank_mes', 'adm'), 'sem_equipe') ->> 'comissao')::numeric >= 5000
  AND pg_temp.linha(pg_temp.dep('rank_mes', 'adm'), 'sem_equipe') ->> 'team_id' IS NULL,
  'C: linha Sem equipe traz a venda de quem não tem equipe (team_id nulo)');
SELECT pg_temp.ok((pg_temp.linha(pg_temp.dep('rank_mes', 'adm'), 'coordenacao_lancamento') ->> 'comissao')::numeric >= 800
  AND (pg_temp.linha(pg_temp.dep('rank_mes', 'adm'), 'coordenacao_lancamento') ->> 'vendas_fechadas')::int >= 1,
  'C: linha Coordenação de lançamento traz a parte da coordenação');
SELECT pg_temp.ok((SELECT bool_and(e ->> 'linha' IN ('equipe', 'sem_equipe', 'coordenacao_lancamento'))
                     FROM jsonb_array_elements(pg_temp.dep('rank_ano', 'adm') -> 'ranking_equipe') e)
  AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.dep('rank_ano', 'adm') -> 'ranking_equipe') e WHERE e ->> 'linha' <> 'equipe') = 2,
  'C: toda linha tem o tipo; só 1 Sem equipe + 1 Coordenação');
SELECT pg_temp.ok(pg_temp.equipes(pg_temp.ant('rank_tl', 'tl'), false) = pg_temp.equipes(pg_temp.dep('rank_tl', 'tl'), true)
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.dep('rank_tl', 'tl') -> 'ranking_equipe') e
                   WHERE e ->> 'linha' = 'equipe' AND e ->> 'team_nome' IS NULL),
  'C: líder de equipe vê as mesmas equipes de antes (equipe que a RLS esconde não volta como linha sem nome)');
SELECT pg_temp.ok((pg_temp.linha(pg_temp.dep('rank_mes', 'adm'), 'coordenacao_lancamento') ->> 'vendas_fechadas')::int
  = (SELECT count(DISTINCT o.sale_id) FROM public.occurrences o JOIN public.occurrence_commissions oc ON oc.occurrence_id = o.id
      WHERE oc.papel = 'coordenador_lancamento' AND o.sale_id IN (SELECT v FROM ids)),
  'C: Fechadas da Coordenação conta vendas distintas');
SELECT pg_temp.ok(pg_temp.soma(pg_temp.dep('rank_emp', 'go') -> 'ranking_equipe') = pg_temp.soma(pg_temp.dep('rank_ano', 'adm') -> 'ranking_equipe')
  AND pg_temp.dep('rank_emp', 'go') -> 'ranking_corretor' = '[]'::jsonb,
  'C: visão Empresa do gestor recebe as mesmas linhas (e segue sem ranking por corretor)');

-- Resultado ---------------------------------------------------------------------------------------------------
SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
