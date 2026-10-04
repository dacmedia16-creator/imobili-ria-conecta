-- Rollback de 20261005090000_vendas_regiao_mapa.sql
-- Remove só o que a migration criou (coordenadas das vendas e a RPC). Nenhuma venda é alterada.
-- Depois de rodar, remover a linha 20261005090000 de supabase_migrations.schema_migrations.
BEGIN;
DROP FUNCTION IF EXISTS public.sale_set_geo(uuid,text,double precision,double precision);
DROP TABLE IF EXISTS public.sale_geo;
COMMIT;
