-- "A cada atualização" passa a existir também pra jurídico/financeiro (antes só corretor/gestor
-- viam essa opção). Usuários já existentes desses dois papéis começam DESLIGADOS: financeiro vê
-- toda venda do sistema, então ligado por padrão inundaria de aviso quem nunca escolheu isso.
-- Corretor/gestor não são afetados (continuam ligados, como já eram).
UPDATE public.user_roles SET notificar_toda_atualizacao = false WHERE role IN ('juridico', 'financeiro');
