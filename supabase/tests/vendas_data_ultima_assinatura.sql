-- Ensaio: tela Vendas usa a ÚLTIMA assinatura (migration 20260929180000). SOMENTE Postgres local
-- descartável com o schema da produção. Tudo em transação + ROLLBACK; nenhum dado real.
-- Antes da migration deve FALHAR (reassinatura fica no mês da 1ª assinatura); depois, 100%.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA vua_test;
CREATE TABLE vua_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA vua_test TO authenticated;
GRANT ALL ON vua_test.results TO authenticated;
GRANT ALL ON SEQUENCE vua_test.results_n_seq TO authenticated;
CREATE FUNCTION vua_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO vua_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION vua_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
-- data_venda de uma venda na RPC principal (sem filtro de data; busca pelo imóvel sintético)
CREATE FUNCTION vua_test.dv(imovel text) RETURNS date LANGUAGE sql AS $$
 SELECT (r->>'data_venda')::date
 FROM jsonb_array_elements(public.list_vendas_comerciais_paginadas(0, 50, NULL, NULL, NULL, NULL, imovel, NULL)->'rows') r
 WHERE r->>'imovel_id' = imovel $$;
CREATE FUNCTION vua_test.conta(st text, de date, ate date) RETURNS integer LANGUAGE sql AS $$
 SELECT (public.list_vendas_comerciais_paginadas(0, 10, st, NULL, de, ate, 'VUA-', NULL)->>'total_count')::integer $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA vua_test TO authenticated;

-- Multiempresa (branch feat/multiempresa-fase1): as tabelas exigem organization_id. Dentro desta
-- transação (desfeita no ROLLBACK), os dados sintéticos entram na agência legada por DEFAULT.
DO $mt$ DECLARE t text; o uuid; BEGIN
  IF to_regclass('public.organizations') IS NULL THEN RETURN; END IF;
  SELECT id INTO o FROM public.organizations ORDER BY created_at LIMIT 1;
  FOR t IN SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name
      AND x.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND c.column_default IS NULL LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT %L::uuid', t, o);
  END LOOP;
END $mt$;

-- ---------- Dados sintéticos ----------
-- C: corretor (cria/participa). F: financeiro (fila "Só minha vez").
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data) VALUES
  ('5a000000-0000-4000-8000-00000000000c','vua.c@example.test','{"nome":"C"}','{}'),
  ('5a000000-0000-4000-8000-00000000000f','vua.f@example.test','{"nome":"F"}','{}');
UPDATE public.profiles SET ativo = true WHERE id::text LIKE '5a000000-%';
INSERT INTO public.user_roles (user_id, role) VALUES
  ('5a000000-0000-4000-8000-00000000000c','corretor'),
  ('5a000000-0000-4000-8000-00000000000f','financeiro')
ON CONFLICT DO NOTHING;
DO $mt$ BEGIN
  IF to_regclass('public.organization_members') IS NOT NULL THEN
    INSERT INTO public.organization_members (user_id)
    SELECT id FROM auth.users WHERE id::text LIKE '5a000000-%' ON CONFLICT DO NOTHING;
  END IF;
END $mt$;

-- R: padrão REASSINADA (25/08 e 04/09); a ocorrência guardou só a 1ª data (25/08). Concluída.
-- N: padrão assinada 31/08 às 23:30 em São Paulo (= 01/09 02:30 UTC) → deve ficar em 31/08.
-- O: padrão sem evento contrato_assinado; ocorrência com 10/07 → fallback para a ocorrência.
-- L: LANÇAMENTO com data_assinatura 05/06 e evento contrato_assinado em setembro → não muda.
-- Q: padrão reassinada (20/08 e 03/09), em análise do financeiro → fila do financeiro.
INSERT INTO public.sales (id, corretor_id, imovel_id, status, corretor_captador_id, corretor_vendedor_id, valor_negociado) VALUES
  ('5a200000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-00000000000c','VUA-R','rascunho','5a000000-0000-4000-8000-00000000000c',NULL,100000),
  ('5a200000-0000-4000-8000-000000000002','5a000000-0000-4000-8000-00000000000c','VUA-N','rascunho','5a000000-0000-4000-8000-00000000000c',NULL,200000),
  ('5a200000-0000-4000-8000-000000000003','5a000000-0000-4000-8000-00000000000c','VUA-O','rascunho','5a000000-0000-4000-8000-00000000000c',NULL,300000),
  ('5a200000-0000-4000-8000-000000000005','5a000000-0000-4000-8000-00000000000c','VUA-Q','rascunho','5a000000-0000-4000-8000-00000000000c',NULL,500000);
-- status/data direto como superusuário, sem as regras de transição nem a trava de mês do
-- Lançamento (preparação do cenário; desfeito no ROLLBACK)
ALTER TABLE public.sales DISABLE TRIGGER USER;
INSERT INTO public.sales (id, corretor_id, imovel_id, status, modalidade, data_assinatura, valor_negociado) VALUES
  ('5a200000-0000-4000-8000-000000000004','5a000000-0000-4000-8000-00000000000c','VUA-L','rascunho','lancamento','2026-06-05',400000);
UPDATE public.sales SET status = 'ocorrencia_concluida' WHERE imovel_id IN ('VUA-R','VUA-N','VUA-O','VUA-L');
UPDATE public.sales SET status = 'ocorrencia_analise_financeiro' WHERE imovel_id = 'VUA-Q';
ALTER TABLE public.sales ENABLE TRIGGER USER;
ALTER TABLE public.sale_status_history DISABLE TRIGGER USER;
INSERT INTO public.sale_status_history (sale_id, de, para, created_at) VALUES
  ('5a200000-0000-4000-8000-000000000001','aguardando_assinatura','contrato_assinado','2026-08-25 15:00:00+00'),
  ('5a200000-0000-4000-8000-000000000001','aguardando_assinatura','contrato_assinado','2026-09-04 15:00:00+00'),
  ('5a200000-0000-4000-8000-000000000002','aguardando_assinatura','contrato_assinado','2026-09-01 02:30:00+00'),
  ('5a200000-0000-4000-8000-000000000004','aguardando_assinatura','contrato_assinado','2026-09-10 15:00:00+00'),
  ('5a200000-0000-4000-8000-000000000005','aguardando_assinatura','contrato_assinado','2026-08-20 15:00:00+00'),
  ('5a200000-0000-4000-8000-000000000005','aguardando_assinatura','contrato_assinado','2026-09-03 15:00:00+00');
ALTER TABLE public.sale_status_history ENABLE TRIGGER USER;
ALTER TABLE public.occurrences DISABLE TRIGGER USER;
INSERT INTO public.occurrences (sale_id, data_assinatura) VALUES
  ('5a200000-0000-4000-8000-000000000001','2026-08-25'),
  ('5a200000-0000-4000-8000-000000000002','2026-09-01'),
  ('5a200000-0000-4000-8000-000000000003','2026-07-10'),
  ('5a200000-0000-4000-8000-000000000005','2026-08-20');
ALTER TABLE public.occurrences ENABLE TRIGGER USER;

-- ---------- Regra da data ----------
SELECT vua_test.check('REASSINATURA: data_venda = última assinatura (04/09), não a 1ª (25/08)',
  vua_test.dv('VUA-R') = '2026-09-04');
SELECT vua_test.check('FUSO: assinatura 31/08 23:30 em SP fica em 31/08 (não 01/09 UTC)',
  vua_test.dv('VUA-N') = '2026-08-31');
SELECT vua_test.check('FALLBACK: sem evento, usa occurrences.data_assinatura (10/07)',
  vua_test.dv('VUA-O') = '2026-07-10');
SELECT vua_test.check('LANÇAMENTO não muda: segue sales.data_assinatura (05/06)',
  vua_test.dv('VUA-L') = '2026-06-05');

-- ---------- Filtro de período + status (o caso 46 × 47) ----------
SELECT vua_test.check('SETEMBRO + Ocorrência concluída: conta a reassinada R (1 venda)',
  vua_test.conta('ocorrencia_concluida', '2026-09-01', '2026-09-30') = 1);
SELECT vua_test.check('AGOSTO + Ocorrência concluída: perde R, fica só N (1 venda)',
  vua_test.conta('ocorrencia_concluida', '2026-08-01', '2026-08-31') = 1);

-- ---------- Igual a vendas_comerciais_validas (Efetivadas / Ocorrências concluídas) ----------
SELECT vua_test.check('MESMO DIA que vendas_comerciais_validas para toda venda padrão sintética',
  NOT EXISTS (
    SELECT 1 FROM public.vendas_comerciais_validas() v
    JOIN public.sales s ON s.id = v.sale_id AND s.imovel_id LIKE 'VUA-%' AND s.modalidade::text <> 'lancamento'
    WHERE vua_test.dv(s.imovel_id) IS DISTINCT FROM (v.venda_em AT TIME ZONE 'America/Sao_Paulo')::date)
  AND (SELECT count(*) FROM public.vendas_comerciais_validas() v
       JOIN public.sales s ON s.id = v.sale_id AND s.imovel_id LIKE 'VUA-%' AND s.modalidade::text <> 'lancamento') = 3);

-- ---------- Fila "Só minha vez" (financeiro) ----------
SELECT vua_test.as_user('5a000000-0000-4000-8000-00000000000f');
SELECT vua_test.check('FILA: financeiro vê Q em setembro (última assinatura 03/09)',
  (public.list_vendas_comerciais_paginadas_fila(0, 10, NULL, NULL, '2026-09-01', '2026-09-30', 'VUA-Q', NULL)->>'total_count')::integer = 1);
SELECT vua_test.check('FILA: Q não aparece mais em agosto',
  (public.list_vendas_comerciais_paginadas_fila(0, 10, NULL, NULL, '2026-08-01', '2026-08-31', 'VUA-Q', NULL)->>'total_count')::integer = 0);
SELECT vua_test.check('FILA: data_venda de Q = 03/09',
  (public.list_vendas_comerciais_paginadas_fila(0, 10, NULL, NULL, NULL, NULL, 'VUA-Q', NULL)->'rows'->0->>'data_venda')::date = '2026-09-03');
RESET ROLE;

-- ---------- Contrato: mesmo retorno e ACL ----------
SELECT vua_test.check('CONTRATO: retorno jsonb com rows/total_count/total_valor',
  (SELECT public.list_vendas_comerciais_paginadas(0, 10, NULL, NULL, NULL, NULL, 'VUA-', NULL) ?& ARRAY['rows','total_count','total_valor']));
SELECT vua_test.check('CONTRATO: anon não executa as RPCs',
  NOT has_function_privilege('anon', 'public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.list_vendas_comerciais_paginadas_fila(integer,integer,text,text[],date,date,text,uuid[])', 'EXECUTE'));
SELECT vua_test.check('CONTRATO: authenticated executa as RPCs',
  has_function_privilege('authenticated', 'public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.list_vendas_comerciais_paginadas_fila(integer,integer,text,text[],date,date,text,uuid[])', 'EXECUTE'));

SELECT CASE WHEN ok THEN 'OK    ' ELSE 'FALHA ' END || label FROM vua_test.results ORDER BY n;
SELECT 'TOTAL=' || count(*) || ' OK=' || count(*) FILTER (WHERE ok) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM vua_test.results;
ROLLBACK;
