-- Rollback de 20261027090000_leads_ia_imovel_parecido.sql (card t_232e13cb).
-- Remove só a função de busca de parecidos. Nenhum dado é apagado. Publicar ANTES o servidor sem a
-- oferta de parecido (senão a Nicole só deixa de oferecer: a falha da busca vira "o corretor procura").
BEGIN;
DROP FUNCTION IF EXISTS public.lead_ia_imoveis_parecidos(uuid, text[], numeric, numeric, text, text, integer, boolean, text);
COMMIT;
