-- Rollback de 20261008170000_mapa_captacoes_preco_contato.sql
-- Remove só a função nova. mapa_captacoes() (20261008150000) continua intacta.
-- Fazer junto com o rollback do frontend (a tela passa a chamar mapa_captacoes_v2).
-- Depois de rodar, remover a linha 20261008170000 de supabase_migrations.schema_migrations.
BEGIN;
DROP FUNCTION IF EXISTS public.mapa_captacoes_v2();
COMMIT;
