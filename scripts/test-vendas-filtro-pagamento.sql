-- Teste da migration 20261028200000 (filtro Pagamento) em Postgres DESCARTÁVEL (t_7538ddac).
-- Esquema mínimo com RLS parecida com a de produção: org_isolation RESTRICTIVE em sales e sale_payment
-- + visibilidade por "dono" (sales) e por venda visível (sale_payment). Identidade simulada por
-- request.jwt.claim.sub; executa como role authenticated (funções são SECURITY INVOKER).
-- Uso: scripts/test-vendas-filtro-pagamento.sh  (aplica a definição implantada, a migration, testa,
-- rollback e confere que volta igual).
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE TEMP TABLE resultado (n serial, ok boolean, teste text);

CREATE OR REPLACE FUNCTION pg_temp.chk(_ok boolean, _t text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO resultado(ok, teste) VALUES (coalesce(_ok, false), _t) $$;

-- Chama a RPC como um usuário autenticado e devolve o jsonb.
CREATE OR REPLACE FUNCTION pg_temp.lista(_uid uuid, _pag text, _fila boolean DEFAULT false, _page int DEFAULT 0, _size int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  SET LOCAL ROLE authenticated;
  IF _fila THEN
    r := public.list_vendas_comerciais_paginadas_fila(_page, _size, NULL, NULL, '2026-10-01', '2026-10-31', NULL, NULL, NULL, _pag);
  ELSE
    r := public.list_vendas_comerciais_paginadas(_page, _size, NULL, NULL, '2026-10-01', '2026-10-31', NULL, NULL, NULL, _pag);
  END IF;
  RESET ROLE;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.ids(_j jsonb) RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(x->>'imovel_id', ',' ORDER BY x->>'imovel_id'), '') FROM jsonb_array_elements(_j->'rows') x $$;

-- Usuários: A = financeiro org1 (vê tudo da org1); C = corretor org1 (só as próprias); B = admin org2.
-- org1: F1,F2 financiadas (F1 com banco+correspondente, F2 sem), V1 à vista, K1 consórcio, N1 sem pagamento,
--       X1 cancelada financiada (entra na contagem, fica fora do total_valor, como hoje), S1 setembro (fora do período).
-- org2: Z1 financiada (não pode vazar para org1).
\set A '\'aaaaaaaa-0000-0000-0000-000000000001\''
\set C '\'cccccccc-0000-0000-0000-000000000003\''
\set B '\'bbbbbbbb-0000-0000-0000-000000000002\''

-- 1) Cada opção, financeiro da org1
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; j jsonb;
BEGIN
  j := pg_temp.lista(A, NULL);
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F1,F2,K1,N1,V1,X1', 'Todas: 6 vendas de outubro da org1 (' || pg_temp.ids(j) || ')');
  PERFORM pg_temp.chk((j->>'total_count')::int = 6 AND (j->>'total_valor')::numeric = 1500, 'Todas: total 6 e valor 1500 (sem cancelada) -> ' || (j->>'total_count') || '/' || (j->>'total_valor'));

  j := pg_temp.lista(A, 'financiamento');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F1,F2,X1', 'Financiada: F1,F2,X1 (' || pg_temp.ids(j) || ')');
  PERFORM pg_temp.chk((j->>'total_count')::int = 3 AND (j->>'total_valor')::numeric = 300, 'Financiada: total 3 e valor 300 -> ' || (j->>'total_count') || '/' || (j->>'total_valor'));

  j := pg_temp.lista(A, 'vista');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'V1' AND (j->>'total_valor')::numeric = 300, 'À vista: só V1, valor 300 (' || pg_temp.ids(j) || ')');

  j := pg_temp.lista(A, 'consorcio');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'K1' AND (j->>'total_valor')::numeric = 400, 'Consórcio: só K1, valor 400 (' || pg_temp.ids(j) || ')');

  j := pg_temp.lista(A, '__nao_informado__');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'N1' AND (j->>'total_valor')::numeric = 500, 'Não informado: só N1 (sem sale_payment), valor 500 (' || pg_temp.ids(j) || ')');

  j := pg_temp.lista(A, 'boleto');
  PERFORM pg_temp.chk((j->>'total_count')::int = 0, 'Valor desconhecido não abre a lista (0 linhas)');
END $$;

-- 2) Soma das 4 opções = Todas (ninguém some nem conta 2x)
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; n int := 0; v numeric := 0; j jsonb; p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['financiamento','vista','consorcio','__nao_informado__'] LOOP
    j := pg_temp.lista(A, p); n := n + (j->>'total_count')::int; v := v + (j->>'total_valor')::numeric;
  END LOOP;
  j := pg_temp.lista(A, NULL);
  PERFORM pg_temp.chk(n = (j->>'total_count')::int AND v = (j->>'total_valor')::numeric, 'Soma das 4 opções = Todas (' || n || '/' || v || ')');
END $$;

-- 3) Campos da etiqueta na linha
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; j jsonb; f1 jsonb; f2 jsonb; v1 jsonb; n1 jsonb;
BEGIN
  j := pg_temp.lista(A, NULL);
  SELECT x INTO f1 FROM jsonb_array_elements(j->'rows') x WHERE x->>'imovel_id' = 'F1';
  SELECT x INTO f2 FROM jsonb_array_elements(j->'rows') x WHERE x->>'imovel_id' = 'F2';
  SELECT x INTO v1 FROM jsonb_array_elements(j->'rows') x WHERE x->>'imovel_id' = 'V1';
  SELECT x INTO n1 FROM jsonb_array_elements(j->'rows') x WHERE x->>'imovel_id' = 'N1';
  PERFORM pg_temp.chk(f1->>'pagamento_tipo' = 'financiamento' AND f1->>'pagamento_banco' = 'Caixa' AND f1->>'pagamento_correspondente' = 'Corresp X', 'F1 traz tipo, banco e correspondente');
  PERFORM pg_temp.chk(f2->>'pagamento_tipo' = 'financiamento' AND f2->'pagamento_banco' = 'null'::jsonb, 'F2 financiada sem banco (etiqueta só "Financiada")');
  PERFORM pg_temp.chk(v1->>'pagamento_tipo' = 'vista', 'V1 traz tipo vista (sem etiqueta)');
  PERFORM pg_temp.chk(n1 ? 'pagamento_tipo' AND n1->'pagamento_tipo' = 'null'::jsonb, 'N1 traz pagamento_tipo null');
  PERFORM pg_temp.chk((SELECT count(*) FROM jsonb_array_elements(j->'rows')) = (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(j->'rows') x), 'join não duplica linhas');
END $$;

-- 4) Multiempresa e permissões
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; B uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
        C uuid := 'cccccccc-0000-0000-0000-000000000003'; j jsonb;
BEGIN
  j := pg_temp.lista(A, 'financiamento');
  PERFORM pg_temp.chk(pg_temp.ids(j) NOT LIKE '%Z1%', 'org1 não vê a financiada da org2');
  j := pg_temp.lista(B, 'financiamento');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'Z1', 'org2 vê só a própria financiada (' || pg_temp.ids(j) || ')');
  j := pg_temp.lista(B, '__nao_informado__');
  PERFORM pg_temp.chk((j->>'total_count')::int = 0, 'org2: Não informado não traz vendas da org1');
  -- corretor C só vê F2 e N1 (as dele)
  j := pg_temp.lista(C, NULL);
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F2,N1', 'corretor: Todas = só as dele (' || pg_temp.ids(j) || ')');
  j := pg_temp.lista(C, 'financiamento');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F2', 'corretor: Financiada não mostra venda que ele não via (' || pg_temp.ids(j) || ')');
  j := pg_temp.lista(C, '__nao_informado__');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'N1', 'corretor: Não informado não mostra venda alheia (' || pg_temp.ids(j) || ')');
  -- fila "Só minha vez" também filtra (C é responsável por F2/N1 em rascunho)
  j := pg_temp.lista(C, 'financiamento', true);
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F2', 'fila Só minha vez + Financiada (' || pg_temp.ids(j) || ')');
  j := pg_temp.lista(C, 'vista', true);
  PERFORM pg_temp.chk((j->>'total_count')::int = 0, 'fila Só minha vez + À vista = 0');
END $$;

-- 5) Paginação: o filtro vale antes do limit (página 2 com page_size 1)
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; j jsonb;
BEGIN
  j := pg_temp.lista(A, 'financiamento', false, 1, 1);
  PERFORM pg_temp.chk((j->>'total_count')::int = 3 AND jsonb_array_length(j->'rows') = 1 AND (j->'rows'->0->>'pagamento_tipo') = 'financiamento', 'paginação: página 2 ainda é financiada e total 3');
END $$;

-- 6) Chamada antiga (sem _pagamento) continua funcionando e igual a "Todas"
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; j jsonb; k jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', A::text, true);
  SET LOCAL ROLE authenticated;
  j := public.list_vendas_comerciais_paginadas(0, 50, NULL, NULL, '2026-10-01', '2026-10-31', NULL, NULL, NULL);
  RESET ROLE;
  k := pg_temp.lista(A, NULL);
  PERFORM pg_temp.chk(j->'total_count' = k->'total_count' AND j->'total_valor' = k->'total_valor', 'chamada sem _pagamento = Todas');
END $$;

-- 7) anon não executa
DO $$
BEGIN
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.list_vendas_comerciais_paginadas(integer, integer, text, text[], date, date, text, uuid[], text, text)', 'execute'), 'anon sem EXECUTE (lista)');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.list_vendas_comerciais_paginadas_fila(integer, integer, text, text[], date, date, text, uuid[], text, text)', 'execute'), 'anon sem EXECUTE (fila)');
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.list_vendas_comerciais_paginadas(integer, integer, text, text[], date, date, text, uuid[], text, text)', 'execute'), 'authenticated com EXECUTE');
  PERFORM pg_temp.chk((SELECT count(*) FROM pg_proc WHERE proname LIKE 'list_vendas_comerciais_paginadas%') = 2, 'só 2 versões (assinatura antiga removida)');
END $$;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FAIL ' END || teste FROM resultado ORDER BY n;
SELECT 'RESULTADO ' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM resultado;
