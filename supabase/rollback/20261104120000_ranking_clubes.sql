-- Rollback da migration 20261104120000_ranking_clubes.sql (card t_481a3f26).
-- Remove as 3 funções novas e só as faixas 2026 que essa migration criou (origem 'Regra REMAX Brasil 2026').
-- Não toca em carreira_ranking, carreira_clube, vendas, comissões, times nem em faixas editadas pelas
-- imobiliárias. Antes de aplicar, volte o front para a versão anterior (as telas chamam essas RPCs).
BEGIN;

DROP FUNCTION IF EXISTS public.carreira_clube_selos(integer, integer);
DROP FUNCTION IF EXISTS public.carreira_ranking_clubes(date, date);
DROP FUNCTION IF EXISTS public.ranking_clubes_base(uuid, date, date);
DELETE FROM public.clube_remax_faixas WHERE ano = 2026 AND origem = 'Regra REMAX Brasil 2026';
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261104120000';

COMMIT;
