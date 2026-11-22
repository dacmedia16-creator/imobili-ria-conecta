-- Rollback da migration 20261222120000_venda_salvar_resumo (t_8ab6c348).
-- A função é nova (não substitui nenhuma), então voltar = remover a função. Os dados das vendas não mudam.
-- Antes de rodar: volte o site para a versão anterior (a tela antiga não usa esta função).
BEGIN;
DROP FUNCTION IF EXISTS public.venda_salvar_resumo(uuid, jsonb, jsonb, uuid[]);
COMMIT;
