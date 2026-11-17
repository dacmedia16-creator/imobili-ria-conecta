-- Rollback de 20261202120000_sales_valor_negociado_teto.sql (t_9f5f3ae2).
-- Tira só a trava de teto. Nenhum dado é alterado.
BEGIN;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_valor_negociado_teto;
COMMIT;
