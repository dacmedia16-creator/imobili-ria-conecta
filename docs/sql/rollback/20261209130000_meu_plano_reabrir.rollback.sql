-- Rollback de 20261209130000_meu_plano_reabrir (cartão t_495e4305).
-- Remove só a função de reabrir. Nenhum dado é apagado: planos já reabertos continuam "em preenchimento"
-- (para voltar uma assinatura, use a data anterior gravada em activity_logs, acao 'meu_plano_reaberto').
BEGIN;
DROP FUNCTION IF EXISTS public.carreira_plano_reabrir(uuid, integer, text);
COMMIT;
