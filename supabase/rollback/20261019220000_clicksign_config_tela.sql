-- Rollback de 20261019220000_clicksign_config_tela.sql (cartão t_7508c6b6). Remove a tela do banco:
-- funções novas, tabela de auditoria e as 4 colunas de controle. NÃO mexe em enabled, sale_enabled,
-- test_mode, signatários, prazo, allowlist nem nos segredos do Vault (a configuração de cada
-- imobiliária, inclusive o que tiver sido salvo pela tela, continua valendo para os envios).
-- Linhas de clicksign_org_settings criadas pela tela ficam (enabled=false por padrão; inofensivas).
-- Rodar numa transação só e publicar junto o frontend sem a tela e remover a edge clicksign-config.
-- ATENÇÃO: a auditoria da tela é apagada junto. Exporte antes se precisar guardá-la:
--   COPY (SELECT * FROM public.clicksign_config_audit) TO STDOUT WITH CSV HEADER;
BEGIN;
DROP FUNCTION IF EXISTS public.clicksign_config_set_enabled(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.clicksign_config_record_test(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.clicksign_config_save(uuid, uuid, boolean, uuid[], text[], integer);
DROP FUNCTION IF EXISTS public.clicksign_config_store_secret(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.clicksign_config_view(uuid);
DROP FUNCTION IF EXISTS public.clicksign_config_mask_email(text);
DROP FUNCTION IF EXISTS public.clicksign_config_authorize();
DROP TABLE IF EXISTS public.clicksign_config_audit;
ALTER TABLE public.clicksign_org_settings
  DROP COLUMN IF EXISTS connection_checked_at,
  DROP COLUMN IF EXISTS connection_ok,
  DROP COLUMN IF EXISTS webhook_secret_set_at,
  DROP COLUMN IF EXISTS access_token_set_at;
COMMIT;
