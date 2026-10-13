-- Rollback de 20261013200000_mapa_anuncios_site.sql
-- Remove só a função de leitura. Coleta, anúncios, ligações e captações não são tocados.
-- Fazer junto com o rollback do frontend (o painel deixa de chamar mapa_anuncios_site; se a função
-- sumir antes, a camada apenas não carrega e o mapa de captações segue funcionando).
-- Depois de rodar, remover a linha 20261013200000 de supabase_migrations.schema_migrations.
BEGIN;
DROP FUNCTION IF EXISTS public.mapa_anuncios_site();
COMMIT;
