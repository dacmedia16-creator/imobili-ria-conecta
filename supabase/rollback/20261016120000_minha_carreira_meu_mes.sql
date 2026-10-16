-- Rollback da migration 20261016120000_minha_carreira_meu_mes.sql (Minha carreira, PR 2).
-- ATENÇÃO: apaga as metas e taxas que os corretores gravaram no bloco "Meu mês".
-- Nada de vendas, captações ou da tabela "metas" da gestão é tocado.
BEGIN;
DROP FUNCTION IF EXISTS public.meu_realizado(date, date);
DROP TABLE IF EXISTS public.carreira_taxas;
DROP TABLE IF EXISTS public.minhas_metas;
COMMIT;
