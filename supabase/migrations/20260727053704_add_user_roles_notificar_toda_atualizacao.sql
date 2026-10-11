-- Preferência separada de notificar_whatsapp: corretor (dono da venda) e gestor (líder da equipe
-- do corretor) podem escolher receber WhatsApp em TODA atualização de status da venda, não só
-- quando for a vez deles agir. Reaproveita a mesma policy/trigger de auto-edição já criada pra
-- notificar_whatsapp (user_roles_self_update_notif + enforce_user_roles_self_update_lock), que só
-- trava troca de role/user_id -- a nova coluna já pode ser auto-editada sem RLS nova.
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS notificar_toda_atualizacao boolean NOT NULL DEFAULT true;
