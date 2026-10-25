-- Rollback de 20261025190000_leads_ia_grant_config (card t_5d8c0b63). A tela volta a não ver a config da IA.
BEGIN;
REVOKE SELECT (ia_ativa, ia_nome, ia_boas_vindas, ia_canal) ON public.lead_config FROM authenticated;
COMMIT;
