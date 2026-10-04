-- Remove a fixture fictícia QA-MAPA (homologação/clone). sale_geo sai junto (ON DELETE CASCADE).
BEGIN;
DELETE FROM public.sale_status_history WHERE sale_id IN (SELECT id FROM public.sales WHERE codigo_interno LIKE 'QA-MAPA-%');
DELETE FROM public.sales WHERE codigo_interno LIKE 'QA-MAPA-%';
COMMIT;
