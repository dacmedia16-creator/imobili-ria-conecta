-- Rollback de 20261027160000_leads_ia_uso_rota (t_3ea838d7).
-- 1) Para só voltar a ZZ ao Gemini (não precisa mexer na coluna):
--    UPDATE public.lead_config SET ia_modelo_provedor = 'gemini', ia_modelo = NULL, updated_at = now()
--     WHERE organization_id = 'eb0a260a-db2f-4cbf-b031-f0c2aebb407c';
-- 2) Para remover a coluna, publique ANTES o código anterior (que não grava `rota`); senão o registro de uso
--    falha em silêncio.
BEGIN;
ALTER TABLE public.lead_ia_uso DROP COLUMN IF EXISTS rota;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261027160000';
COMMIT;
