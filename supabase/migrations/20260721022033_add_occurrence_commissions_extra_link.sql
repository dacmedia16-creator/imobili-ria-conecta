-- Recuperado de supabase_migrations.schema_migrations (versão 20260721022033) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

alter table public.occurrence_commissions
  add column sale_commission_extra_id uuid references public.sale_commission_extras(id) on delete set null;
