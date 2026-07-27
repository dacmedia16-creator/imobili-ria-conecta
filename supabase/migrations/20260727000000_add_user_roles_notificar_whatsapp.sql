-- Permite cada usuário ligar/desligar aviso por WhatsApp por papel (útil pra quem acumula vários
-- papéis, como Denis, e não quer ser avisado por todos). A preferência é por (user_id, role), não
-- por usuário, já que uma conta pode ter vários papéis com preferências diferentes.
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS notificar_whatsapp boolean NOT NULL DEFAULT true;

-- Permite o próprio usuário atualizar sua linha (pra alterar notificar_whatsapp). Como essa policy
-- é combinada em OR com user_roles_admin_write, a trigger abaixo bloqueia troca de role/user_id
-- quando o ator é o dono da linha -- senão reabriria a auto-promoção que user_roles_admin_write
-- já bloqueia (o mesmo tipo de brecha corrigida em fix_user_roles_admin_all_privilege_escalation).
DROP POLICY IF EXISTS user_roles_self_update_notif ON public.user_roles;
CREATE POLICY user_roles_self_update_notif ON public.user_roles FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.enforce_user_roles_self_update_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.user_id IS DISTINCT FROM OLD.user_id)
     AND auth.uid() = OLD.user_id THEN
    RAISE EXCEPTION 'Você não pode alterar seu próprio papel -- só a preferência de notificação.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_user_roles_self_update_lock ON public.user_roles;
CREATE TRIGGER trg_enforce_user_roles_self_update_lock
BEFORE UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION enforce_user_roles_self_update_lock();
