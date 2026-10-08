-- Rollback de 20261008150000_vendas_regiao_todos_e_mapa_captacoes.sql
-- Remove só as três funções novas. vendas_por_regiao(), sale_geo, captações e vendas não são tocadas.
-- Fazer junto com o rollback do frontend (a tela nova chama estas funções).
-- Depois de rodar, remover a linha 20261008150000 de supabase_migrations.schema_migrations.
BEGIN;
DROP FUNCTION IF EXISTS public.mapa_captacoes();
DROP FUNCTION IF EXISTS public.vendas_por_regiao_todos(date, date);
DROP FUNCTION IF EXISTS public.relatorio_regiao_permitido();
COMMIT;
