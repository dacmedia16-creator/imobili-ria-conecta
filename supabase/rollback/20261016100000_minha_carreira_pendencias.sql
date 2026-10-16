-- Rollback de 20261016100000_minha_carreira_pendencias.sql: só remove as duas consultas novas.
BEGIN;
DROP FUNCTION IF EXISTS public.minhas_pendencias();
DROP FUNCTION IF EXISTS public.minhas_captacoes(integer, integer);
COMMIT;
