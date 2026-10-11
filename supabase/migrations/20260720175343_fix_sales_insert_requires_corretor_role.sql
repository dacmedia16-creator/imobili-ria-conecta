-- Recuperado de supabase_migrations.schema_migrations (versão 20260720175343) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

drop policy if exists "sales_insert_corretor" on public.sales;

create policy "sales_insert_corretor" on public.sales
for insert
with check (
  corretor_id = auth.uid()
  and public.has_role(auth.uid(), 'corretor')
);
