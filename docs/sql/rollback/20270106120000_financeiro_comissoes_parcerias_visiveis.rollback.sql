-- Rollback de 20270106120000_financeiro_comissoes_parcerias_visiveis (t_205ec8f5 B).
-- A função é nova e só de leitura: remover devolve o banco ao estado anterior. O front (PR B) detecta
-- a RPC ausente (PGRST202/42883) e volta sozinho para a leitura direta das tabelas com RLS.
BEGIN;

DROP FUNCTION IF EXISTS public.financeiro_comissoes_parcerias_visiveis();

COMMIT;
