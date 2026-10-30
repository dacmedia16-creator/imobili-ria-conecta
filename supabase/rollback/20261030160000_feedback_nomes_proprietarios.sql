-- Rollback de 20261030160000_feedback_nomes_proprietarios.sql: remove só a função de leitura dos nomes.
-- A tela /feedback continua funcionando sem ela (mostra "Proprietário não informado" na lista e o
-- 1º proprietário no topo, como antes). Não mexe em dados.
BEGIN;
DROP FUNCTION IF EXISTS public.owner_feedback_proprietarios();
COMMIT;
