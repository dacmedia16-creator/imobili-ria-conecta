-- Desfaz 20261009050000_fix_sales_select_insert_returning.sql:
-- volta a policy sales.sales_select ao USING da perf_01 (lido em produção em 09/10/2026 antes da correção).
-- ATENÇÃO: com este USING o corretor volta a não conseguir criar venda pelo app (INSERT ... RETURNING).
alter policy sales_select on public.sales using ((id IN (SELECT public.vendas_visiveis_ids())));
