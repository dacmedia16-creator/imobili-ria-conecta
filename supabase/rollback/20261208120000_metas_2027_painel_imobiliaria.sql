-- Rollback da migration 20261208120000 (painéis de metas 2027, etapa 4, t_69d29df6).
-- Apaga SÓ o que a migration criou: a tabela metas_direcao (e as policies dela) e as 5 funções novas.
-- ATENÇÃO: depois de publicada, a tabela guarda a meta da direção digitada pelo administrador. Antes de rodar em
-- produção, guarde uma cópia:  SELECT * FROM public.metas_direcao;  (poucas linhas: uma por imobiliária e ano).
BEGIN;
DROP FUNCTION IF EXISTS public.metas_imobiliaria_estoque();
DROP FUNCTION IF EXISTS public.metas_comissao_quebra(date, date);
DROP FUNCTION IF EXISTS public.metas_direcao_salvar(integer, numeric, numeric, integer, integer);
DROP TABLE IF EXISTS public.metas_direcao;
DROP FUNCTION IF EXISTS public.metas_direcao_pode_ler();
DROP FUNCTION IF EXISTS public.metas_direcao_papel(public.app_role[]);
COMMIT;
