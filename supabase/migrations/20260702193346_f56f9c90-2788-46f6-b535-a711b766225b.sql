DROP POLICY IF EXISTS "delete_sales_por_papel" ON public.sales;
CREATE POLICY "delete_sales_por_papel" ON public.sales
FOR DELETE TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['super_admin','admin','financeiro']::public.app_role[])
  OR corretor_id = auth.uid()
  OR (public.has_role(auth.uid(),'gestor') AND public.is_lead_of(auth.uid(), corretor_id))
);