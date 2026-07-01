
-- 1. Ocorrência: reabertura com justificativa obrigatória (colunas dedicadas)
ALTER TABLE public.occurrences
  ADD COLUMN IF NOT EXISTS reopen_reason text,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES auth.users(id);

-- 2. Endurecer política de notificações: usuário só pode inserir notificação para si
--    OU para participantes de uma venda que ele mesmo pode ver, se ele for staff.
DROP POLICY IF EXISTS notif_insert ON public.notifications;
CREATE POLICY notif_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.has_any_role(auth.uid(),
         ARRAY['admin','financeiro','gestor','coordenador','juridico']::public.app_role[])
  );

-- 3. Impedir auto-escalonamento: usuário não pode alterar o próprio papel.
--    Admin pode alterar de outros, mas nem admin pode alterar o próprio conjunto.
DROP POLICY IF EXISTS user_roles_admin_all ON public.user_roles;
CREATE POLICY user_roles_admin_write ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') AND user_id <> auth.uid())
  WITH CHECK (public.has_role(auth.uid(),'admin') AND user_id <> auth.uid());

-- 4. Logar mudanças de papel automaticamente em activity_logs
CREATE OR REPLACE FUNCTION public.log_role_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload)
  VALUES (
    auth.uid(), NULL,
    CASE WHEN TG_OP = 'INSERT' THEN 'role_granted' ELSE 'role_revoked' END,
    jsonb_build_object(
      'target_user', COALESCE(NEW.user_id, OLD.user_id),
      'role', COALESCE(NEW.role, OLD.role)::text
    )
  );
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_log_role_change_ins ON public.user_roles;
DROP TRIGGER IF EXISTS trg_log_role_change_del ON public.user_roles;
CREATE TRIGGER trg_log_role_change_ins AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.log_role_change();
CREATE TRIGGER trg_log_role_change_del AFTER DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, lida, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_target
  ON public.activity_logs((payload->>'target_user'));
