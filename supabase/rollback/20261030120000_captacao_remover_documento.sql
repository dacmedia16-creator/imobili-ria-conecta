-- Rollback de 20261030120000_captacao_remover_documento.sql (t_5ab6dad4).
-- Só remove a função nova; documentos já removidos não voltam (o histórico guarda o registro).
BEGIN;
DROP FUNCTION IF EXISTS public.exclusive_remove_document(uuid, text, integer);
COMMIT;
