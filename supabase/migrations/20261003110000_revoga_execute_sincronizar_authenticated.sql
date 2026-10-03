-- Segurança (revisão t_f9022dc6, achado 3 / M1): as funções SECURITY DEFINER abaixo
-- gravam na ocorrência sem checar papel e estavam com EXECUTE para authenticated.
-- Mapeamento feito antes da mudança (03/10/2026):
--   * frontend / edge functions / server: nenhuma chamada (só tipos gerados);
--   * cron: projeto sem pg_cron;
--   * sincronizar_base_financeira_ocorrencia: nenhum chamador no banco;
--   * sincronizar_previsao_ocorrencia_pendente: só trg_sincronizar_previsao_ocorrencia_pendente()
--     (SECURITY DEFINER, dono postgres, que segue com EXECUTE via mt_1b_definer).
-- A sincronização legítima (triggers em sales/sale_payment/sale_commission_extras) usa
-- sincronizar_ocorrencia_antes_financeiro, que já não tinha EXECUTE para authenticated.
-- Rollback: supabase/rollback/20261003110000_revoga_execute_sincronizar_authenticated.sql

REVOKE EXECUTE ON FUNCTION public.sincronizar_base_financeira_ocorrencia(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sincronizar_previsao_ocorrencia_pendente(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sincronizar_base_financeira_ocorrencia(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sincronizar_previsao_ocorrencia_pendente(uuid) TO service_role;
