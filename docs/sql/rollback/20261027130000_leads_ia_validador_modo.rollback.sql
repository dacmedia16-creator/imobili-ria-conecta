-- Rollback de 20261027130000_leads_ia_validador_modo.sql (card t_3a4bf078).
-- Desligar o modo observar é imediato e não precisa deste arquivo:
--   UPDATE public.lead_config SET ia_validador_modo = 'bloquear';
-- Para apagar as colunas: publicar ANTES o servidor anterior (senão o insert em lead_ia_uso com as colunas novas
-- falha e só o registro de uso se perde; a resposta ao cliente segue). Conversas e mensagens ficam.
BEGIN;
ALTER TABLE public.lead_ia_uso
  DROP COLUMN IF EXISTS tentativa,
  DROP COLUMN IF EXISTS observado,
  DROP COLUMN IF EXISTS bloqueio_trecho;
ALTER TABLE public.lead_config DROP COLUMN IF EXISTS ia_validador_modo;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261027130000';
COMMIT;
