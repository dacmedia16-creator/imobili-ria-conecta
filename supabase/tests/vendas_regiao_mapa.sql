-- Suíte da migration 20261005090000 (sale_geo + sale_set_geo). Roda dentro de transação revertida.
-- Precisa de duas imobiliárias com admin ativo e pelo menos uma venda cada (homologação: A e B fictícias).
-- Saída: linhas "ok ..." / "FALHA ..." e "TOTAL=<falhas>".
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated;

-- Atores: admin ativo de cada org e uma venda de cada org.
SELECT ur.user_id AS a_admin FROM public.user_roles ur JOIN public.profiles p ON p.id=ur.user_id AND p.ativo
 WHERE ur.organization_id='00000000-0000-4000-8000-000000000001' AND ur.role='admin' ORDER BY 1 LIMIT 1 \gset
SELECT ur.user_id AS b_admin FROM public.user_roles ur JOIN public.profiles p ON p.id=ur.user_id AND p.ativo
 WHERE ur.organization_id='2a000000-0000-4000-8000-0000000000b0' AND ur.role='admin' ORDER BY 1 LIMIT 1 \gset
SELECT id AS a_sale FROM public.sales WHERE organization_id='00000000-0000-4000-8000-000000000001' AND codigo_interno='QA-MAPA-A1' \gset
SELECT id AS b_sale FROM public.sales WHERE organization_id='2a000000-0000-4000-8000-0000000000b0' AND codigo_interno='QA-MAPA-B1' \gset
SELECT md5(string_agg(to_jsonb(s)::text, '' ORDER BY s.id)) AS sales_md5 FROM public.sales s \gset
SELECT set_config('t.a_sale', :'a_sale', true), set_config('t.b_sale', :'b_sale', true);

-- Estrutura e permissões
INSERT INTO r VALUES
 ((SELECT relrowsecurity FROM pg_class WHERE oid='public.sale_geo'::regclass), 'sale_geo com RLS'),
 (NOT has_table_privilege('anon','public.sale_geo','SELECT,INSERT,UPDATE,DELETE'), 'anon sem acesso a sale_geo'),
 (NOT has_table_privilege('authenticated','public.sale_geo','INSERT,UPDATE,DELETE'), 'authenticated sem escrita direta'),
 (NOT has_function_privilege('anon','public.sale_set_geo(uuid,text,double precision,double precision)','EXECUTE'), 'anon não executa sale_set_geo'),
 ((SELECT proowner::regrole::text='mt_1b_definer' AND prosecdef FROM pg_proc WHERE oid='public.sale_set_geo(uuid,text,double precision,double precision)'::regprocedure), 'RPC definer com dono mt_1b_definer'),
 (NOT has_function_privilege('anon','public.vendas_por_regiao()','EXECUTE'), 'anon não executa vendas_por_regiao');

-- Admin da A grava coordenada da própria venda
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'a_admin', true);
SELECT set_config('request.jwt.claims', json_build_object('sub', :'a_admin', 'role','authenticated')::text, true);
SELECT public.sale_set_geo(:'a_sale', 'rua a|centro|sorocaba|sp', -23.5, -47.45);
INSERT INTO r SELECT count(*)=1, 'A grava e lê a coordenada da própria venda' FROM public.sale_geo WHERE sale_id=:'a_sale';
SELECT public.sale_set_geo(:'a_sale', 'rua a|centro|sorocaba|sp', NULL, NULL);
INSERT INTO r SELECT geo_lat IS NULL, 'A regrava (não encontrado = sem coordenada)' FROM public.sale_geo WHERE sale_id=:'a_sale';
INSERT INTO r SELECT count(*) = 4, 'A vê as 4 vendas QA-MAPA dela em vendas_por_regiao'
  FROM public.vendas_por_regiao() v WHERE v.codigo_interno LIKE 'QA-MAPA-A%';
INSERT INTO r SELECT count(*) = 0, 'A não vê nenhuma venda QA-MAPA-B'
  FROM public.vendas_por_regiao() v WHERE v.codigo_interno LIKE 'QA-MAPA-B%';
INSERT INTO r SELECT count(*) = 0, 'A não vê vendas da B em vendas_por_regiao'
  FROM public.vendas_por_regiao() v WHERE v.sale_id = :'b_sale';
-- A tenta gravar na venda da B
DO $$ BEGIN
  PERFORM public.sale_set_geo(current_setting('t.b_sale')::uuid, 'x', 1, 1);
  INSERT INTO r VALUES (false, 'A gravou coordenada na venda da B');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO r VALUES (true, 'A não grava coordenada na venda da B (42501)');
END $$;
-- A tenta escrita direta
DO $$ BEGIN
  INSERT INTO public.sale_geo(sale_id, organization_id, geo_key) VALUES (current_setting('t.a_sale')::uuid, '00000000-0000-4000-8000-000000000001', 'x');
  INSERT INTO r VALUES (false, 'INSERT direto em sale_geo aceito');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO r VALUES (true, 'INSERT direto em sale_geo negado');
END $$;
-- Validações
DO $$ BEGIN
  PERFORM public.sale_set_geo(current_setting('t.a_sale')::uuid, 'x', 200, 1);
  INSERT INTO r VALUES (false, 'coordenada inválida aceita');
EXCEPTION WHEN raise_exception THEN INSERT INTO r VALUES (true, 'coordenada inválida recusada');
END $$;
DO $$ BEGIN
  PERFORM public.sale_set_geo(current_setting('t.a_sale')::uuid, repeat('x', 501), 1, 1);
  INSERT INTO r VALUES (false, 'chave longa aceita');
EXCEPTION WHEN raise_exception THEN INSERT INTO r VALUES (true, 'chave >500 recusada');
END $$;

-- Admin da B grava a própria e não vê a da A
SELECT set_config('request.jwt.claim.sub', :'b_admin', true);
SELECT set_config('request.jwt.claims', json_build_object('sub', :'b_admin', 'role','authenticated')::text, true);
SELECT public.sale_set_geo(:'b_sale', 'rua b|bairro|cidade|uf', -22.9, -47.06);
INSERT INTO r SELECT count(*)=1, 'B vê só a própria coordenada' FROM public.sale_geo;
INSERT INTO r SELECT count(*) = 2 AND bool_and(v.codigo_interno LIKE 'QA-MAPA-B%'), 'B vê só as 2 vendas dela'
  FROM public.vendas_por_regiao() v WHERE v.codigo_interno LIKE 'QA-MAPA-%';
INSERT INTO r SELECT count(*)=0, 'B não lê coordenada da venda da A' FROM public.sale_geo WHERE sale_id=:'a_sale';
DO $$ BEGIN
  PERFORM public.sale_set_geo(current_setting('t.a_sale')::uuid, 'invasao', 0, 0);
  INSERT INTO r VALUES (false, 'B gravou coordenada na venda da A');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO r VALUES (true, 'B não grava coordenada na venda da A (42501)');
END $$;
DO $$ BEGIN
  UPDATE public.sale_geo SET geo_lat=0 WHERE true;
  INSERT INTO r VALUES (false, 'UPDATE direto em sale_geo aceito');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO r VALUES (true, 'UPDATE direto em sale_geo negado');
END $$;

-- Sem login
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
INSERT INTO r SELECT count(*)=0, 'sem usuário: 0 coordenadas' FROM public.sale_geo;
DO $$ BEGIN
  PERFORM public.sale_set_geo(current_setting('t.a_sale')::uuid, 'x', 1, 1);
  INSERT INTO r VALUES (false, 'sem usuário gravou');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO r VALUES (true, 'sem usuário não grava');
END $$;
RESET ROLE;

-- Conferência como dono: a coordenada da A não foi tocada pela B; vendas intactas
INSERT INTO r SELECT geo_key='rua a|centro|sorocaba|sp' AND geo_lat IS NULL, 'coordenada da A intacta após tentativas da B'
  FROM public.sale_geo WHERE sale_id=:'a_sale';
INSERT INTO r SELECT md5(string_agg(to_jsonb(s)::text, '' ORDER BY s.id)) = :'sales_md5', 'nenhuma linha de sales alterada'
  FROM public.sales s;

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) FROM r;
