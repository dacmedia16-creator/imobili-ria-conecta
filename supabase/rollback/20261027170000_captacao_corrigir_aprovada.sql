-- ROLLBACK de 20261027170000_captacao_corrigir_aprovada (t_9f9f0c6a).
-- Remove só a RPC nova e as três funções de apoio. Nada mais foi alterado pela migration.
-- As linhas já gravadas ficam (histórico 'corrigida' e avisos 'captacao_corrigida'): são registro
-- de auditoria e não dependem das funções. Publicar antes o front sem o botão "Corrigir dados".
BEGIN;
DROP FUNCTION IF EXISTS public.exclusive_corrigir_aprovada(uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.exclusive_correcao_secao(jsonb, jsonb, text[], text);
DROP FUNCTION IF EXISTS public.exclusive_correcao_mascara(text, text);
DROP FUNCTION IF EXISTS public.exclusive_correcao_rotulo(text);
COMMIT;
