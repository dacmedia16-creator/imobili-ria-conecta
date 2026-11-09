-- ROLLBACK de 20261109200000_captacao_contato_signatario (t_867f464c).
-- Remove só as duas funções novas. Nada mais foi alterado pela migration.
-- Ficam (são registro de auditoria): histórico 'contato_corrigido', avisos
-- 'captacao_contato_assinatura' e os e-mails/telefones já gravados na captação.
-- Publicar ANTES o front e a edge clicksign-manage da versão anterior (sem "Corrigir contato" e sem
-- a sincronização), senão a tela mostra erro ao salvar.
BEGIN;
DROP FUNCTION IF EXISTS public.clicksign_capture_signer_sync(uuid, integer, text, uuid);
DROP FUNCTION IF EXISTS public.exclusive_contato_assinatura_salvar(uuid, integer, text, text);
COMMIT;
