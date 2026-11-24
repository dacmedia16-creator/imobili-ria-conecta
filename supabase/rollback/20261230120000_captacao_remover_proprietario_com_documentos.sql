-- Rollback de 20261230120000_captacao_remover_proprietario_com_documentos.sql (t_b3a9ed4f).
-- Só remove a função nova; proprietários/documentos já removidos não voltam (o histórico guarda o registro).
BEGIN;
DROP FUNCTION IF EXISTS public.exclusive_remove_owner(uuid, integer, integer);
COMMIT;
