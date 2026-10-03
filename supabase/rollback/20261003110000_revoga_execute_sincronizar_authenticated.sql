-- Rollback de 20261003110000_revoga_execute_sincronizar_authenticated.sql
-- Restaura o EXECUTE de authenticated (estado anterior: anon e PUBLIC já não tinham).
GRANT EXECUTE ON FUNCTION public.sincronizar_base_financeira_ocorrencia(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_previsao_ocorrencia_pendente(uuid) TO authenticated;

-- Rollback do achado 1 (configuração de Auth, fora do SQL):
--   PATCH https://api.supabase.com/v1/projects/xvvymgurpchhlmbpjbgc/config/auth
--   corpo: {"disable_signup": false}
