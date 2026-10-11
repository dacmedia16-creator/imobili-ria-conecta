
-- Corrige policy permissiva demais em notifications
DROP POLICY IF EXISTS notif_insert ON public.notifications;
CREATE POLICY notif_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Destinatário é o próprio usuário OU o remetente pode ver a venda relacionada
    user_id = auth.uid()
    OR (sale_id IS NOT NULL AND public.can_view_sale(auth.uid(), sale_id))
    OR public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role,'financeiro'::public.app_role,'gestor'::public.app_role,'coordenador'::public.app_role,'juridico'::public.app_role])
  );

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_sales_corretor_status ON public.sales(corretor_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_status ON public.sales(status);
CREATE INDEX IF NOT EXISTS idx_occurrences_sale ON public.occurrences(sale_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_lida ON public.notifications(user_id, lida);
CREATE INDEX IF NOT EXISTS idx_status_history_sale ON public.sale_status_history(sale_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_sale_tipo ON public.sale_documents(sale_id, tipo);
