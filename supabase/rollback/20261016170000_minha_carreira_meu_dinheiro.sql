-- Rollback da migration 20261016170000_minha_carreira_meu_dinheiro.sql (Minha carreira, PR 4).
-- Só remove a consulta de leitura; nenhum dado é apagado.
BEGIN;
DROP FUNCTION IF EXISTS public.minhas_comissoes();
COMMIT;
