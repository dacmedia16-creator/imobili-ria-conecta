-- Recuperado de supabase_migrations.schema_migrations (versão 20260720175237) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

drop policy if exists "delete_sales_por_papel" on public.sales;

create policy "delete_sales_por_papel" on public.sales
for delete
using (
  public.has_any_role(auth.uid(), array['super_admin','admin','financeiro']::public.app_role[])
  or (corretor_id = auth.uid() and not public.is_sale_locked(id))
  or (public.has_role(auth.uid(),'gestor') and public.is_lead_of(auth.uid(), corretor_id) and not public.is_sale_locked(id))
);
