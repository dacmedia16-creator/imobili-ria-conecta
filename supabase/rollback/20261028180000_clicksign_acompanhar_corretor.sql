-- Rollback de 20261028180000_clicksign_acompanhar_corretor.sql (t_82e51349).
-- Antes de rodar: voltar as edges clicksign-manage e clicksign-sale para a versão anterior (a ação
-- "status" volta a usar só clicksign_manage_authorize / clicksign_sale_manage_authorize).
DROP FUNCTION IF EXISTS public.clicksign_capture_view_authorize(uuid);
DROP FUNCTION IF EXISTS public.clicksign_sale_view_authorize(uuid);
