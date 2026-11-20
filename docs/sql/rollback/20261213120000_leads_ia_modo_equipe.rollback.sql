-- Rollback de 20261213120000_leads_ia_modo_equipe (t_45d0f5aa).
-- Desligar sem rollback: UPDATE public.lead_config SET ia_modo_equipe = false WHERE organization_id = '<org>';
-- O código lê a coluna com tolerância a erro: sem a coluna, a chave vale "desligada" (comportamento de antes).

BEGIN;
ALTER TABLE public.lead_config DROP COLUMN IF EXISTS ia_modo_equipe;
COMMIT;
