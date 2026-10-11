-- Recuperado de supabase_migrations.schema_migrations (versão 20260720175720) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

drop policy if exists "sales_update_owner_draft" on public.sales;
create policy "sales_update_owner_draft" on public.sales
for update
using (
  public.can_view_sale(auth.uid(), id)
  and ((not public.is_sale_locked(id)) or public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]))
)
with check (
  public.can_view_sale(auth.uid(), id)
  and ((not public.is_sale_locked(id)) or public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]))
  and public.can_edit_sale_stage(auth.uid(), id)
);
