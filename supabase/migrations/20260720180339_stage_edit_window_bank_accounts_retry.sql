-- Recuperado de supabase_migrations.schema_migrations (versão 20260720180339) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

drop policy if exists "sale_bank_rw" on public.sale_bank_accounts;

create policy "sale_bank_select" on public.sale_bank_accounts
for select using (public.can_view_sale(auth.uid(), sale_id));

create policy "sale_bank_insert" on public.sale_bank_accounts
for insert with check (
  public.can_view_sale(auth.uid(), sale_id)
  and ((not public.is_sale_locked(sale_id)) or public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]))
  and public.can_edit_sale_stage(auth.uid(), sale_id)
);

create policy "sale_bank_update" on public.sale_bank_accounts
for update using (public.can_view_sale(auth.uid(), sale_id))
with check (
  public.can_view_sale(auth.uid(), sale_id)
  and ((not public.is_sale_locked(sale_id)) or public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]))
  and public.can_edit_sale_stage(auth.uid(), sale_id)
);

create policy "sale_bank_delete" on public.sale_bank_accounts
for delete using (
  public.can_view_sale(auth.uid(), sale_id)
  and ((not public.is_sale_locked(sale_id)) or public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]))
  and public.can_edit_sale_stage(auth.uid(), sale_id)
);
