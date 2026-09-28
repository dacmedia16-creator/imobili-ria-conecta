-- Ensaio: atribuição de venda = participantes, nunca quem criou (Denis, 28/09/2026).
-- Rodar SOMENTE em Postgres local descartável (clone estrutural). Tudo em transação + ROLLBACK;
-- escritas de teste rodam em subtransação desfeita. Antes da migration deve FALHAR; depois, 100%.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA atr_test;
CREATE TABLE atr_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA atr_test TO authenticated;
GRANT ALL ON atr_test.results TO authenticated;
GRANT ALL ON SEQUENCE atr_test.results_n_seq TO authenticated;
CREATE FUNCTION atr_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO atr_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION atr_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
CREATE FUNCTION atr_test.dry(q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN
  BEGIN
   EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT;
   RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = n::text;
  EXCEPTION WHEN SQLSTATE 'P0999' THEN RETURN 'ok:' || SQLERRM;
   WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE; END;
 END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA atr_test TO authenticated;

-- ---------- Dados sintéticos ----------
-- G1 (gestor) lidera equipe 1 com A; TL2 (team_leader) lidera equipe 2 com B;
-- G3 (gestor) lidera equipe 3 com C e CRIA vendas das quais não participa. L = lançamento. F = financeiro.
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data) VALUES
  ('3a000000-0000-4000-8000-000000000001','atr.g1@example.test','{"nome":"G1"}','{}'),
  ('3a000000-0000-4000-8000-000000000002','atr.tl2@example.test','{"nome":"TL2"}','{}'),
  ('3a000000-0000-4000-8000-000000000003','atr.g3@example.test','{"nome":"G3"}','{}'),
  ('3a000000-0000-4000-8000-00000000000a','atr.a@example.test','{"nome":"A"}','{}'),
  ('3a000000-0000-4000-8000-00000000000b','atr.b@example.test','{"nome":"B"}','{}'),
  ('3a000000-0000-4000-8000-00000000000c','atr.c@example.test','{"nome":"C"}','{}'),
  ('3a000000-0000-4000-8000-00000000000d','atr.l@example.test','{"nome":"L"}','{}'),
  ('3a000000-0000-4000-8000-00000000000f','atr.f@example.test','{"nome":"F"}','{}');
UPDATE public.profiles SET ativo = true WHERE id::text LIKE '3a000000-%';
INSERT INTO public.user_roles (user_id, role) VALUES
  ('3a000000-0000-4000-8000-000000000001','gestor'),
  ('3a000000-0000-4000-8000-000000000002','team_leader'),
  ('3a000000-0000-4000-8000-000000000003','gestor'),
  ('3a000000-0000-4000-8000-00000000000a','corretor'),
  ('3a000000-0000-4000-8000-00000000000b','corretor'),
  ('3a000000-0000-4000-8000-00000000000c','corretor'),
  ('3a000000-0000-4000-8000-00000000000d','lancamento'),
  ('3a000000-0000-4000-8000-00000000000f','financeiro')
ON CONFLICT DO NOTHING;
INSERT INTO public.teams (id, lider_id, nome) VALUES
  ('3a100000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001','ATR Equipe 1'),
  ('3a100000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000002','ATR Equipe 2'),
  ('3a100000-0000-4000-8000-000000000003','3a000000-0000-4000-8000-000000000003','ATR Equipe 3');
INSERT INTO public.team_members (membro_id, team_id, tipo) VALUES
  ('3a000000-0000-4000-8000-00000000000a','3a100000-0000-4000-8000-000000000001','corretor'),
  ('3a000000-0000-4000-8000-00000000000b','3a100000-0000-4000-8000-000000000002','corretor'),
  ('3a000000-0000-4000-8000-00000000000c','3a100000-0000-4000-8000-000000000003','corretor');

-- S1: rascunho criado por G3; captador A, vendedor B (G3 não participa).
-- S2: contrato_conferencia_corretor criado por G3; captador A.
-- S3: ocorrência pendente criada por G3; captador A, vendedor B; comissão total 10.000, A = 3.000, B = 2.500.
-- S4: rascunho criado por C sem participantes (fallback: C continua responsável).
-- L1: lançamento em rascunho criado por L; corretor_vendedor B (extra).
INSERT INTO public.sales (id, corretor_id, imovel_id, status, corretor_captador_id, corretor_vendedor_id, valor_total_comissao) VALUES
  ('3a200000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000003','ATR-1','rascunho','3a000000-0000-4000-8000-00000000000a','3a000000-0000-4000-8000-00000000000b',10000),
  ('3a200000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000003','ATR-2','rascunho','3a000000-0000-4000-8000-00000000000a',NULL,8000),
  ('3a200000-0000-4000-8000-000000000003','3a000000-0000-4000-8000-000000000003','ATR-3','rascunho','3a000000-0000-4000-8000-00000000000a','3a000000-0000-4000-8000-00000000000b',10000),
  ('3a200000-0000-4000-8000-000000000004','3a000000-0000-4000-8000-00000000000c','ATR-4','rascunho',NULL,NULL,NULL);
INSERT INTO public.sales (id, corretor_id, imovel_id, status, modalidade) VALUES
  ('3a200000-0000-4000-8000-00000000000e','3a000000-0000-4000-8000-00000000000d','ATR-L1','rascunho','lancamento');
-- status direto como superusuário, sem passar pelas regras de transição (preparação do cenário)
ALTER TABLE public.sales DISABLE TRIGGER USER;
UPDATE public.sales SET status = 'contrato_conferencia_corretor' WHERE id = '3a200000-0000-4000-8000-000000000002';
UPDATE public.sales SET status = 'ocorrencia_pendente' WHERE id = '3a200000-0000-4000-8000-000000000003';
ALTER TABLE public.sales ENABLE TRIGGER USER;
ALTER TABLE public.sale_commission_extras DISABLE TRIGGER USER;
INSERT INTO public.sale_commission_extras (sale_id, papel, nome, user_id, valor, origem) VALUES
  ('3a200000-0000-4000-8000-00000000000e','corretor_vendedor','B','3a000000-0000-4000-8000-00000000000b',1500,'vendedor');
ALTER TABLE public.sale_commission_extras ENABLE TRIGGER USER;
ALTER TABLE public.occurrences DISABLE TRIGGER USER;
INSERT INTO public.occurrences (id, sale_id, valor_comissao) VALUES
  ('3a300000-0000-4000-8000-000000000003','3a200000-0000-4000-8000-000000000003',10000);
ALTER TABLE public.occurrences ENABLE TRIGGER USER;
ALTER TABLE public.occurrence_commissions DISABLE TRIGGER USER;
INSERT INTO public.occurrence_commissions (occurrence_id, papel, nome, valor, user_id, managed_by_sale) VALUES
  ('3a300000-0000-4000-8000-000000000003','corretor_captador','A',3000,'3a000000-0000-4000-8000-00000000000a',true),
  ('3a300000-0000-4000-8000-000000000003','corretor_vendedor','B',2500,'3a000000-0000-4000-8000-00000000000b',true);
ALTER TABLE public.occurrence_commissions ENABLE TRIGGER USER;
-- Nos testes de etapa só interessa a regra de permissão: desliga as validações de conteúdo
-- (pagamento, valores, distribuição) e mantém trg_validate_sale_status. Desfeito no ROLLBACK.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.sales'::regclass AND NOT tgisinternal
    AND tgname <> 'trg_validate_sale_status' LOOP
    EXECUTE format('ALTER TABLE public.sales DISABLE TRIGGER %I', t);
  END LOOP; END $$;

-- ---------- Visibilidade ----------
SELECT atr_test.as_user('3a000000-0000-4000-8000-000000000002');
SELECT atr_test.check('VER: TL2 (líder do vendedor B) vê S1 criada por outro gestor',
  EXISTS (SELECT 1 FROM public.sales WHERE id = '3a200000-0000-4000-8000-000000000001'));
SELECT atr_test.check('VER: TL2 lê ocorrência/comissões de S3 (via can_view_sale)',
  EXISTS (SELECT 1 FROM public.occurrence_commissions oc WHERE oc.occurrence_id = '3a300000-0000-4000-8000-000000000003'));
SELECT atr_test.check('CAP: TL2 é líder (team_owner) em S1',
  (public.sale_management_capabilities('3a200000-0000-4000-8000-000000000001')->>'team_owner')::boolean);
RESET ROLE;
SELECT atr_test.as_user('3a000000-0000-4000-8000-000000000001');
SELECT atr_test.check('VER: G1 (líder do captador A) vê S1',
  EXISTS (SELECT 1 FROM public.sales WHERE id = '3a200000-0000-4000-8000-000000000001'));
RESET ROLE;
SELECT atr_test.as_user('3a000000-0000-4000-8000-000000000003');
SELECT atr_test.check('VER: criador não participante (G3) continua vendo S1 (autoria)',
  EXISTS (SELECT 1 FROM public.sales WHERE id = '3a200000-0000-4000-8000-000000000001'));
SELECT atr_test.check('EDIT: G3 criador não participante NÃO edita o rascunho S1',
  NOT public.can_edit_sale_stage(auth.uid(), '3a200000-0000-4000-8000-000000000001'));
SELECT atr_test.check('EDIT: G3 NÃO edita comissão do rascunho S1',
  NOT public.can_edit_sale_comissao(auth.uid(), '3a200000-0000-4000-8000-000000000001'));
SELECT atr_test.check('CAP: G3 não é líder (team_owner) de S1',
  NOT coalesce((public.sale_management_capabilities('3a200000-0000-4000-8000-000000000001')->>'team_owner')::boolean, false));
SELECT 'INFO etapa G3=' || atr_test.dry($q$UPDATE public.sales SET status = 'enviada_revisao' WHERE id = '3a200000-0000-4000-8000-000000000001'$q$);
SELECT atr_test.check('ETAPA: G3 não envia S1 para revisão',
  -- bloqueio pela RLS (0 linhas) ou pelo gatilho de transição (42501)
  atr_test.dry($q$UPDATE public.sales SET status = 'enviada_revisao' WHERE id = '3a200000-0000-4000-8000-000000000001'$q$) IN ('ok:0', 'erro:42501'));
RESET ROLE;
SELECT atr_test.as_user('3a000000-0000-4000-8000-00000000000a');
SELECT 'INFO etapa A=' || atr_test.dry($q$UPDATE public.sales SET status = 'enviada_revisao' WHERE id = '3a200000-0000-4000-8000-000000000001'$q$);
SELECT atr_test.check('ETAPA: A (participante) passa pela permissão ao enviar S1 para revisão',
  atr_test.dry($q$UPDATE public.sales SET status = 'enviada_revisao' WHERE id = '3a200000-0000-4000-8000-000000000001'$q$) NOT IN ('ok:0', 'erro:42501'));
RESET ROLE;
SELECT atr_test.as_user('3a000000-0000-4000-8000-000000000003');
SELECT atr_test.check('INICIO: G3 não conta S1/S2/S3 em minhas_vendas', (public.dashboard_stats()->>'minhas_vendas')::int = 0);
SELECT atr_test.check('INICIO: G3 comissão prevista = 0', (public.dashboard_stats()->>'minha_comissao_prevista')::numeric = 0);
SELECT atr_test.check('FILA: G3 não tem S1 na fila Sua vez',
  NOT (public.list_vendas_comerciais_paginadas_fila(0, 50)->'rows') @> '[{"id":"3a200000-0000-4000-8000-000000000001"}]');
RESET ROLE;
SELECT atr_test.as_user('3a000000-0000-4000-8000-00000000000c');
SELECT atr_test.check('VER: corretor C sem vínculo não vê S1',
  NOT EXISTS (SELECT 1 FROM public.sales WHERE id = '3a200000-0000-4000-8000-000000000001'));
SELECT atr_test.check('FALLBACK: C (criou S4 sem participantes) edita o rascunho',
  public.can_edit_sale_stage(auth.uid(), '3a200000-0000-4000-8000-000000000004'));
SELECT atr_test.check('FALLBACK: S4 conta em minhas_vendas de C', (public.dashboard_stats()->>'minhas_vendas')::int = 1);
RESET ROLE;

-- ---------- Corretor participante ----------
SELECT atr_test.as_user('3a000000-0000-4000-8000-00000000000a');
SELECT atr_test.check('EDIT: A (captador) edita o rascunho S1 criado pelo gestor',
  public.can_edit_sale_stage(auth.uid(), '3a200000-0000-4000-8000-000000000001'));
SELECT atr_test.check('EDIT: A edita comissão do rascunho S1',
  public.can_edit_sale_comissao(auth.uid(), '3a200000-0000-4000-8000-000000000001'));
SELECT atr_test.check('ETAPA: A confere contrato de S2 (contrato_conferencia_corretor -> contrato_ok_corretor) sem bloqueio de permissão',
  atr_test.dry($q$UPDATE public.sales SET status = 'contrato_ok_corretor' WHERE id = '3a200000-0000-4000-8000-000000000002'$q$) <> 'erro:42501');
SELECT atr_test.check('INICIO: A tem 3 vendas (S1, S2, S3)', (public.dashboard_stats()->>'minhas_vendas')::int = 3);
SELECT atr_test.check('INICIO: A tem 1 pendência (S1) e 1 contrato a conferir (S2)',
  (public.dashboard_stats()->>'minhas_pendencias')::int = 1 AND (public.dashboard_stats()->>'meus_contratos_conferir')::int = 1);
SELECT atr_test.check('INICIO: A tem 1 assinada/ocorrência (S3)', (public.dashboard_stats()->>'meus_assinados')::int = 1);
-- S1/S2 não têm valor negociado nem divisão lançada: a parte de A nelas é 0. Em S3 é 3000.
SELECT 'INFO comissao A=' || (public.dashboard_stats()->>'minha_comissao_prevista');
SELECT atr_test.check('INICIO: comissão prevista de A = só a parte dele (3000), nunca o total das vendas (28000)',
  (public.dashboard_stats()->>'minha_comissao_prevista')::numeric = 3000);
SELECT atr_test.check('FILA: S1 e S2 na fila Sua vez de A',
  (public.list_vendas_comerciais_paginadas_fila(0, 50)->'rows') @> '[{"id":"3a200000-0000-4000-8000-000000000001"},{"id":"3a200000-0000-4000-8000-000000000002"}]');
RESET ROLE;
SELECT atr_test.as_user('3a000000-0000-4000-8000-00000000000b');
SELECT 'INFO comissao B=' || (public.dashboard_stats()->>'minha_comissao_prevista');
SELECT atr_test.check('INICIO: comissão prevista de B = 2500 (S3) + 1500 (L1), sem total da venda',
  (public.dashboard_stats()->>'minha_comissao_prevista')::numeric = 4000);
SELECT atr_test.check('INICIO: L1 (lançamento) conta em minhas_vendas de B',
  (public.dashboard_stats()->>'minhas_vendas')::int = 3);
RESET ROLE;

-- ---------- Lançamento: operador segue operando, sem atribuição ----------
SELECT atr_test.as_user('3a000000-0000-4000-8000-00000000000d');
SELECT atr_test.check('LANC: operador L continua editando o rascunho L1',
  public.can_edit_sale_stage(auth.uid(), '3a200000-0000-4000-8000-00000000000e'));
SELECT atr_test.check('LANC: L1 não conta em minhas_vendas do operador', (public.dashboard_stats()->>'minhas_vendas')::int = 0);
SELECT atr_test.check('LANC: L1 fica na fila do operador',
  (public.list_vendas_comerciais_paginadas_fila(0, 50)->'rows') @> '[{"id":"3a200000-0000-4000-8000-00000000000e"}]');
RESET ROLE;

-- ---------- Listagem com filtro de corretor (financeiro vê tudo) ----------
SELECT atr_test.as_user('3a000000-0000-4000-8000-00000000000f');
SELECT atr_test.check('LISTA: filtro por B traz S1, S3 e L1',
  (public.list_vendas_comerciais_paginadas(0, 50, _corretor_ids => ARRAY['3a000000-0000-4000-8000-00000000000b']::uuid[])->>'total_count')::int = 3);
SELECT atr_test.check('LISTA: filtro por G3 (só criador) não traz nada',
  (public.list_vendas_comerciais_paginadas(0, 50, _corretor_ids => ARRAY['3a000000-0000-4000-8000-000000000003']::uuid[])->>'total_count')::int = 0);
SELECT atr_test.check('LISTA: linha traz corretores_ids = participantes (A, B) de S1',
  (public.list_vendas_comerciais_paginadas(0, 50, _q => 'ATR-1')->'rows'->0->'corretores_ids')
    = '["3a000000-0000-4000-8000-00000000000a","3a000000-0000-4000-8000-00000000000b"]'::jsonb);
RESET ROLE;

SELECT set_config('request.jwt.claims','',true);
SELECT 'FALHA: ' || label FROM atr_test.results WHERE NOT ok ORDER BY n;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM atr_test.results;
ROLLBACK;
