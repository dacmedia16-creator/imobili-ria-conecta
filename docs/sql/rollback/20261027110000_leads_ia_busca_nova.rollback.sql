-- Rollback de 20261027110000_leads_ia_busca_nova.sql (card t_5b493bc9).
-- Remove só a função da busca nova. Nenhum dado é apagado. Sem a função, a busca nova da Nicole termina
-- passando o atendimento à equipe ("vou procurar para você"), sem oferecer imóvel.
BEGIN;
DROP FUNCTION IF EXISTS public.lead_ia_imoveis_busca(uuid, text, text, numeric, numeric, text, text, text[], integer);
COMMIT;
