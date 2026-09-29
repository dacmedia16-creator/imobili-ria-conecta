-- Isolamento da migration 20260929180000 (tela Vendas pela última assinatura) na multiempresa.
-- A nova leitura de sale_status_history não pode revelar venda nem data de outra agência.
-- Rodar SOMENTE em Postgres local descartável com 1a–2g + 20260929180000. Tudo em ROLLBACK.
BEGIN;
CREATE TEMP TABLE r (label text, ok boolean);
GRANT ALL ON r TO authenticated, anon;
SET LOCAL session_replication_role = replica; -- só preparação do cenário (sem gatilhos)
INSERT INTO public.organizations (id, slug, nome) VALUES
  ('6b000000-0000-4000-8000-0000000000a1','vua-org-a','VUA A'),
  ('6b000000-0000-4000-8000-0000000000b1','vua-org-b','VUA B');
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data) VALUES
  ('6b000000-0000-4000-8000-00000000000a','vua.iso.a@example.test','{"nome":"A"}','{}'),
  ('6b000000-0000-4000-8000-00000000000b','vua.iso.b@example.test','{"nome":"B"}','{}');
INSERT INTO public.profiles (id, nome, ativo, organization_id) VALUES
  ('6b000000-0000-4000-8000-00000000000a','A',true,'6b000000-0000-4000-8000-0000000000a1'),
  ('6b000000-0000-4000-8000-00000000000b','B',true,'6b000000-0000-4000-8000-0000000000b1')
ON CONFLICT (id) DO UPDATE SET ativo = true, organization_id = excluded.organization_id;
INSERT INTO public.organization_members (user_id, organization_id) VALUES
  ('6b000000-0000-4000-8000-00000000000a','6b000000-0000-4000-8000-0000000000a1'),
  ('6b000000-0000-4000-8000-00000000000b','6b000000-0000-4000-8000-0000000000b1');
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  ('6b000000-0000-4000-8000-00000000000a','admin','6b000000-0000-4000-8000-0000000000a1'),
  ('6b000000-0000-4000-8000-00000000000b','admin','6b000000-0000-4000-8000-0000000000b1');
-- SA: venda da agência A. SB: venda da agência B.
INSERT INTO public.sales (id, corretor_id, imovel_id, status, organization_id) VALUES
  ('6b200000-0000-4000-8000-0000000000a1','6b000000-0000-4000-8000-00000000000a','VUAISO-A','ocorrencia_concluida','6b000000-0000-4000-8000-0000000000a1'),
  ('6b200000-0000-4000-8000-0000000000b1','6b000000-0000-4000-8000-00000000000b','VUAISO-B','ocorrencia_concluida','6b000000-0000-4000-8000-0000000000b1');
INSERT INTO public.sale_status_history (sale_id, de, para, created_at, organization_id) VALUES
  ('6b200000-0000-4000-8000-0000000000a1','aguardando_assinatura','contrato_assinado','2026-09-04 15:00+00','6b000000-0000-4000-8000-0000000000a1'),
  ('6b200000-0000-4000-8000-0000000000b1','aguardando_assinatura','contrato_assinado','2026-09-05 15:00+00','6b000000-0000-4000-8000-0000000000b1'),
  -- linha anômala: evento com a venda de A mas gravado na agência B (não pode influenciar A)
  ('6b200000-0000-4000-8000-0000000000a1','aguardando_assinatura','contrato_assinado','2026-09-20 15:00+00','6b000000-0000-4000-8000-0000000000b1');
INSERT INTO public.occurrences (sale_id, data_assinatura, organization_id) VALUES
  ('6b200000-0000-4000-8000-0000000000a1','2026-08-25','6b000000-0000-4000-8000-0000000000a1');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claims', json_build_object('sub','6b000000-0000-4000-8000-00000000000a','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'A vê a própria venda com a última assinatura DA SUA agência (04/09)',
  (public.list_vendas_comerciais_paginadas(0,50,NULL,NULL,NULL,NULL,'VUAISO-',NULL)->'rows'->0->>'data_venda') = '2026-09-04'
  AND (public.list_vendas_comerciais_paginadas(0,50,NULL,NULL,NULL,NULL,'VUAISO-',NULL)->>'total_count')::int = 1;
INSERT INTO r SELECT 'A não vê a venda de B (lista)',
  NOT (public.list_vendas_comerciais_paginadas(0,50,NULL,NULL,NULL,NULL,'VUAISO-B',NULL)->'rows') @> '[{"imovel_id":"VUAISO-B"}]';
INSERT INTO r SELECT 'A não vê a venda de B (fila)',
  (public.list_vendas_comerciais_paginadas_fila(0,50,NULL,NULL,NULL,NULL,'VUAISO-B',NULL)->>'total_count')::int = 0;
INSERT INTO r SELECT 'A não lê eventos de histórico da agência B',
  NOT EXISTS (SELECT 1 FROM public.sale_status_history WHERE organization_id = '6b000000-0000-4000-8000-0000000000b1');
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub','6b000000-0000-4000-8000-00000000000b','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'B vê só a própria venda (05/09)',
  (public.list_vendas_comerciais_paginadas(0,50,NULL,NULL,NULL,NULL,'VUAISO-',NULL)->>'total_count')::int = 1
  AND (public.list_vendas_comerciais_paginadas(0,50,NULL,NULL,NULL,NULL,'VUAISO-',NULL)->'rows'->0->>'imovel_id') = 'VUAISO-B'
  AND (public.list_vendas_comerciais_paginadas(0,50,NULL,NULL,NULL,NULL,'VUAISO-',NULL)->'rows'->0->>'data_venda') = '2026-09-05';
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;
INSERT INTO r SELECT 'anon não executa a RPC', NOT has_function_privilege('anon',
  'public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[])','EXECUTE');
RESET ROLE;
SELECT CASE WHEN ok THEN 'OK    ' ELSE 'FALHA ' END || label FROM r;
SELECT 'TOTAL=' || count(*) || ' OK=' || count(*) FILTER (WHERE ok) || ' FALHAS=' || count(*) FILTER (WHERE NOT coalesce(ok,false)) FROM r;
ROLLBACK;
