-- Teste da migration 20261028233000 (opção "Financiada pela Obah" + campo pagamento_oba), t_1e3dda48.
-- Banco DESCARTÁVEL, mesmo esquema/RLS de scripts/test-vendas-filtro-pagamento-setup.sql, com a coluna
-- oba_credito (boolean NOT NULL default false, igual à produção). Identidade por request.jwt.claim.sub;
-- executa como role authenticated (funções SECURITY INVOKER).
-- Dados (outubro): org1 F1 financiada+Obah, F2 financiada sem Obah, X1 cancelada financiada+Obah,
--   V1 à vista com Oba marcado (não pode virar Obah), K1 consórcio, N1 sem pagamento; S1 setembro financiada+Obah
--   (fora do período). org2: Z1 financiada+Obah (não pode vazar).
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE TEMP TABLE resultado (n serial, ok boolean, teste text);
CREATE OR REPLACE FUNCTION pg_temp.chk(_ok boolean, _t text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO resultado(ok, teste) VALUES (coalesce(_ok, false), _t) $$;

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

CREATE OR REPLACE FUNCTION pg_temp.linha(_j jsonb, _imovel text) RETURNS jsonb LANGUAGE sql AS
$$ SELECT x FROM jsonb_array_elements(_j->'rows') x WHERE x->>'imovel_id' = _imovel $$;

-- 1) Opção nova e "Financiada" inalterada (financeiro org1)
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; j jsonb;
BEGIN
  j := pg_temp.lista(A, 'financiamento_obah');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F1,X1', 'Financiada pela Obah: F1,X1 (' || pg_temp.ids(j) || ')');
  PERFORM pg_temp.chk((j->>'total_count')::int = 2 AND (j->>'total_valor')::numeric = 100,
    'Obah: total 2 e valor 100 (cancelada fora do valor) -> ' || (j->>'total_count') || '/' || (j->>'total_valor'));
  PERFORM pg_temp.chk(pg_temp.ids(j) NOT LIKE '%V1%', 'Oba marcado em venda à vista NÃO entra em Obah');

  j := pg_temp.lista(A, 'financiamento');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F1,F2,X1', 'Financiada continua com todas (com e sem Obah): ' || pg_temp.ids(j));
  PERFORM pg_temp.chk((j->>'total_count')::int = 3 AND (j->>'total_valor')::numeric = 300, 'Financiada: total 3 / valor 300 (igual a antes)');

  j := pg_temp.lista(A, NULL);
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F1,F2,K1,N1,V1,X1' AND (j->>'total_valor')::numeric = 1500, 'Todas: igual a antes');
  j := pg_temp.lista(A, 'vista');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'V1', 'À vista: igual a antes');
  j := pg_temp.lista(A, '__nao_informado__');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'N1', 'Não informado: igual a antes');
END $$;

-- 2) Campo pagamento_oba na linha (etiqueta)
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; j jsonb;
BEGIN
  j := pg_temp.lista(A, NULL);
  PERFORM pg_temp.chk(pg_temp.linha(j, 'F1')->'pagamento_oba' = 'true'::jsonb, 'F1 traz pagamento_oba = true');
  PERFORM pg_temp.chk(pg_temp.linha(j, 'F2')->'pagamento_oba' = 'false'::jsonb, 'F2 traz pagamento_oba = false');
  PERFORM pg_temp.chk(pg_temp.linha(j, 'N1') ? 'pagamento_oba' AND pg_temp.linha(j, 'N1')->'pagamento_oba' = 'null'::jsonb, 'N1 (sem pagamento) traz pagamento_oba null');
  PERFORM pg_temp.chk(pg_temp.linha(j, 'F1')->>'pagamento_banco' = 'Caixa', 'banco/correspondente continuam vindo');
  PERFORM pg_temp.chk((SELECT count(*) FROM jsonb_array_elements(j->'rows')) = (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(j->'rows') x), 'não duplica linhas');
END $$;

-- 3) Multiempresa, corretor e fila
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; B uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
        C uuid := 'cccccccc-0000-0000-0000-000000000003'; D uuid := 'dddddddd-0000-0000-0000-000000000004'; j jsonb;
BEGIN
  j := pg_temp.lista(A, 'financiamento_obah');
  PERFORM pg_temp.chk(pg_temp.ids(j) NOT LIKE '%Z1%', 'org1 não vê a Obah da org2');
  j := pg_temp.lista(B, 'financiamento_obah');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'Z1', 'org2 vê só a própria Obah (' || pg_temp.ids(j) || ')');
  j := pg_temp.lista(C, 'financiamento_obah');
  PERFORM pg_temp.chk((j->>'total_count')::int = 0, 'corretor C (só F2 sem Obah): Obah = 0, não vê F1 alheia');
  j := pg_temp.lista(C, 'financiamento');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F2', 'corretor C: Financiada = só a dele (F2)');
  j := pg_temp.lista(D, 'financiamento_obah');
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F1,X1', 'corretor D: Obah = as dele (F1,X1)');
  j := pg_temp.lista(C, 'financiamento_obah', true);
  PERFORM pg_temp.chk((j->>'total_count')::int = 0, 'fila Só minha vez + Obah (C) = 0');
  j := pg_temp.lista(C, 'financiamento', true);
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F2', 'fila Só minha vez + Financiada (C) = F2 (igual a antes)');
END $$;

-- 3b) Fila com Obah: F2 passa a ter Obah dentro da transação (desfeito no fim)
DO $$
DECLARE C uuid := 'cccccccc-0000-0000-0000-000000000003'; j jsonb;
BEGIN
  UPDATE public.sale_payment SET oba_credito = true WHERE sale_id = '00000000-0000-0000-0000-0000000000f2';
  j := pg_temp.lista(C, 'financiamento_obah', true);
  PERFORM pg_temp.chk(pg_temp.ids(j) = 'F2', 'fila Só minha vez + Obah traz F2 quando marcada');
  UPDATE public.sale_payment SET oba_credito = false WHERE sale_id = '00000000-0000-0000-0000-0000000000f2';
END $$;

-- 4) Paginação: filtro antes do limit
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; j jsonb;
BEGIN
  j := pg_temp.lista(A, 'financiamento_obah', false, 1, 1);
  PERFORM pg_temp.chk((j->>'total_count')::int = 2 AND jsonb_array_length(j->'rows') = 1
    AND (j->'rows'->0->'pagamento_oba') = 'true'::jsonb, 'paginação: página 2 ainda é Obah, total 2');
END $$;

-- 5) Chamada antiga (9 parâmetros, sem _pagamento) continua igual a Todas
DO $$
DECLARE A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; j jsonb; k jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', A::text, true);
  SET LOCAL ROLE authenticated;
  j := public.list_vendas_comerciais_paginadas(0, 50, NULL, NULL, '2026-10-01', '2026-10-31', NULL, NULL, NULL);
  RESET ROLE;
  k := pg_temp.lista(A, NULL);
  PERFORM pg_temp.chk(j = k, 'chamada sem _pagamento = Todas (jsonb idêntico)');
END $$;

-- 6) Permissões
DO $$
BEGIN
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.list_vendas_comerciais_paginadas(integer, integer, text, text[], date, date, text, uuid[], text, text)', 'execute'), 'anon sem EXECUTE (lista)');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.list_vendas_comerciais_paginadas_fila(integer, integer, text, text[], date, date, text, uuid[], text, text)', 'execute'), 'anon sem EXECUTE (fila)');
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.list_vendas_comerciais_paginadas_fila(integer, integer, text, text[], date, date, text, uuid[], text, text)', 'execute'), 'authenticated com EXECUTE');
  PERFORM pg_temp.chk((SELECT count(*) FROM pg_proc WHERE proname LIKE 'list_vendas_comerciais_paginadas%') = 2, 'continuam só 2 versões');
  PERFORM pg_temp.chk((SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE proname LIKE 'list_vendas_comerciais_paginadas%'), 'continuam SECURITY INVOKER');
END $$;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FAIL ' END || teste FROM resultado ORDER BY n;
SELECT 'RESULTADO ' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM resultado;
