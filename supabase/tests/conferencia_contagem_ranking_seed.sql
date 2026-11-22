-- Parte 1 da suíte da migration 20261225120000 (t_fee0b359): dados fictícios + foto ANTES (funções atuais).
-- Roda DENTRO da transação revertida de run-conferencia-contagem-ranking.sh, antes da migration. Nada fica gravado.
-- Homologação, Agência A (…-0001): a1 = UE Corretor (Equipe UE), a3 = QA A Corretor Tres (Equipe TL Homolog),
-- tl = QA A Corretor Um (team_leader, Equipe TL Homolog), go = QA A Gestor (gestor; faz o papel da coordenação
-- de lançamento), se = UE Admin (corretor+admin, SEM equipe), adm = QA A Admin.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE antes(k text, u text, v jsonb);
GRANT ALL ON r, ids, antes TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.as_user(text), pg_temp.id(text) TO authenticated;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('a3', 'a742cfda-4731-4fa8-989a-374d2fdf0820'),
  ('tl', '5745cbff-22b6-4a28-a515-dd6706504b8b'), ('go', 'cab7391a-463f-4d97-b99b-ced6e4696796'),
  ('se', '10000000-0000-4000-8000-000000000001'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd');

SELECT pg_temp.ok(public.equipe_vigente(pg_temp.id('a1'), now()) IS NOT NULL
  AND public.equipe_vigente(pg_temp.id('a3'), now()) IS NOT NULL AND public.equipe_vigente(pg_temp.id('go'), now()) IS NOT NULL
  AND public.equipe_vigente(pg_temp.id('se'), now()) IS NULL, 'pré: a1/a3/go têm equipe; se (UE Admin) está sem equipe');

-- Venda fictícia. _capt/_vend NULL = sem pontas no cadastro (caso do Lançamento). _occ = linhas da ocorrência
-- (papel:pessoa:valor); vazio = venda ainda sem ocorrência.
CREATE FUNCTION pg_temp.venda(_k text, _cod text, _mod text, _status text, _corr text, _capt text, _vend text,
  _occ text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _s uuid := gen_random_uuid(); _o uuid := gen_random_uuid(); _l text; _p text[];
BEGIN
  INSERT INTO ids VALUES (_k, _s);
  INSERT INTO public.sales (id, organization_id, corretor_id, corretor_captador_id, corretor_vendedor_id, status,
    modalidade, codigo_interno, imovel_id, imovel_endereco, imovel_bairro, tipo_imovel, valor_negociado,
    valor_total_comissao, data_assinatura)
  VALUES (_s, pg_temp.id('orgA'), pg_temp.id(_corr), pg_temp.id(_capt), pg_temp.id(_vend), _status::public.sale_status,
    _mod, _cod, 'QA-CONF-' || _k, 'Rua QA Conferência ' || _k, 'Bairro QA', 'Casa', 400000, 24000,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  INSERT INTO public.sale_status_history (sale_id, organization_id, para, created_at)
  SELECT _s, pg_temp.id('orgA'), x::public.sale_status, now()
    FROM unnest(CASE WHEN _mod = 'lancamento' THEN ARRAY['contrato_assinado', 'ocorrencia_analise_financeiro']
                     ELSE ARRAY['contrato_assinado'] END) x;
  IF cardinality(_occ) > 0 THEN
    INSERT INTO public.occurrences (id, sale_id, organization_id, status, valor_comissao)
    VALUES (_o, _s, pg_temp.id('orgA'), 'pendente', 24000);
    FOREACH _l IN ARRAY _occ LOOP
      _p := string_to_array(_l, ':');
      INSERT INTO public.occurrence_commissions (occurrence_id, organization_id, papel, user_id, valor)
      VALUES (_o, pg_temp.id('orgA'), _p[1], pg_temp.id(_p[2]), _p[3]::numeric);
    END LOOP;
  END IF;
END $$;

-- P1 padrão: a1 capta e vende (comissão de corretor) e o TL ganha como líder.
SELECT pg_temp.venda('p1', '999999921-1', 'padrao', 'contrato_assinado', 'a1', 'a1', 'a1',
  ARRAY['corretor_captador:a1:5000', 'corretor_vendedor:a1:4000', 'lider_captador:tl:500']);
-- P2 padrão: o TL está no cadastro como captador e vendedor, mas recebeu SÓ como líder (caso real da conferência).
SELECT pg_temp.venda('p2', '999999922-1', 'padrao', 'contrato_assinado', 'tl', 'tl', 'tl',
  ARRAY['lider_captador:tl:700', 'lider_vendedor:tl:600']);
-- L1 lançamento com ocorrência: corretor_id = coordenação (go), sem pontas; a3 vende (participação extra, como
-- nos casos reais); go recebe coordenação.
SELECT pg_temp.venda('l1', '999999923-1', 'lancamento', 'ocorrencia_analise_financeiro', 'go', NULL, NULL,
  ARRAY['corretor_vendedor:a3:6000', 'coordenador_lancamento:go:800']);
SET LOCAL session_replication_role = replica; -- só a linha de participação, sem recalcular a ocorrência fictícia
INSERT INTO public.sale_commission_extras (sale_id, organization_id, papel, user_id, origem, lado, valor)
VALUES (pg_temp.id('l1'), pg_temp.id('orgA'), 'corretor_vendedor', pg_temp.id('a3'), 'vendedor', 'vendedor', 6000);
SET LOCAL session_replication_role = origin;
-- L2 lançamento SEM ocorrência: corretor_id = coordenação (go), sem pontas.
SELECT pg_temp.venda('l2', '999999924-1', 'lancamento', 'contrato_assinado', 'go', NULL, NULL, ARRAY[]::text[]);
-- P3 padrão SEM ocorrência: a1 capta e vende (cadastro continua valendo).
SELECT pg_temp.venda('p3', '999999925-1', 'padrao', 'contrato_assinado', 'a1', 'a1', 'a1', ARRAY[]::text[]);
-- P4 padrão: UE Admin (sem equipe) capta e vende → linha "Sem equipe" do ranking.
SELECT pg_temp.venda('p4', '999999926-1', 'padrao', 'contrato_assinado', 'se', 'se', 'se',
  ARRAY['corretor_captador:se:3000', 'corretor_vendedor:se:2000']);

-- Foto ANTES (funções atuais): Dashboard de cada pessoa e ranking como admin (mês e ano correntes).
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
INSERT INTO antes SELECT 'dash', 'a1', public.dashboard_stats();
SELECT pg_temp.as_user(pg_temp.id('a3')::text);
INSERT INTO antes SELECT 'dash', 'a3', public.dashboard_stats();
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
INSERT INTO antes SELECT 'dash', 'tl', public.dashboard_stats();
SELECT pg_temp.as_user(pg_temp.id('go')::text);
INSERT INTO antes SELECT 'dash', 'go', public.dashboard_stats();
SELECT pg_temp.as_user(pg_temp.id('se')::text);
INSERT INTO antes SELECT 'dash', 'se', public.dashboard_stats();
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
INSERT INTO antes SELECT 'dash', 'adm', public.dashboard_stats();
INSERT INTO antes SELECT 'rank_mes', 'adm', public.desempenho_ranking_periodo(
  date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
INSERT INTO antes SELECT 'rank_ano', 'adm', public.desempenho_ranking_periodo(
  date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
SELECT pg_temp.as_user(pg_temp.id('tl')::text);
INSERT INTO antes SELECT 'rank_tl', 'tl', public.desempenho_equipe_ranking_periodo(
  date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
SELECT pg_temp.as_user(pg_temp.id('go')::text);
INSERT INTO antes SELECT 'rank_emp', 'go', public.desempenho_empresa_ranking_periodo(
  date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
RESET ROLE;
