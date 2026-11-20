-- Rollback da migration 20261206120000_metas_2027_painel_corretor.sql (painel do corretor, etapa 2).
-- Remove só o que ela criou: a RPC da comissão, a tabela de anotações (as anotações são perdidas: faça
-- backup antes, se já houver uso) e as 2 funções de apoio. Nada mais é tocado.
BEGIN;
DROP FUNCTION IF EXISTS public.minha_comissao_vendas(date, date);
DROP TABLE IF EXISTS public.carreira_anotacoes;
DROP FUNCTION IF EXISTS public.carreira_anotacoes_editar();
DROP FUNCTION IF EXISTS public.carreira_anotacoes_pode_ler(uuid);
COMMIT;
