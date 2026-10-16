-- Rollback de 20261016200000_remax_xml_feed.sql (t_698be0d2)
-- Remove as RPCs e tabelas do XML VRSync. O Feedback e o mapa voltam a usar portais + site RE/MAX
-- (o frontend já cai para mapa_anuncios_site quando mapa_anuncios_xml não existe ou volta vazio).
-- Antes: desligar REMAX_XML_COLLECT no Worker. Depois: remover a linha 20261016200000 de
-- supabase_migrations.schema_migrations.
BEGIN;
DROP FUNCTION IF EXISTS public.mapa_anuncios_xml();
DROP FUNCTION IF EXISTS public.feedback_xml_base();
DROP FUNCTION IF EXISTS public.remax_xml_broker_links();
DROP FUNCTION IF EXISTS public.remax_xml_status();
DROP FUNCTION IF EXISTS public.remax_xml_can_read();
DROP FUNCTION IF EXISTS public.remax_xml_broker_match(uuid);
DROP FUNCTION IF EXISTS public.remax_xml_ingest(uuid, jsonb, integer, timestamptz);
DROP FUNCTION IF EXISTS public.remax_xml_mark_failed(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.remax_xml_last_ok(uuid);
DROP FUNCTION IF EXISTS public.remax_tel_norm(text);
DROP TABLE IF EXISTS public.remax_xml_listings;
DROP TABLE IF EXISTS public.remax_xml_runs;
COMMIT;
