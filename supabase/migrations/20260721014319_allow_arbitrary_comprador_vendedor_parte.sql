-- Recuperado de supabase_migrations.schema_migrations (versão 20260721014319) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

alter table public.sale_documents drop constraint sale_documents_parte_check;
alter table public.sale_documents add constraint sale_documents_parte_check
  check (parte ~ '^(comprador|vendedor)_[1-9][0-9]*$' or parte in ('imovel','outros','juridico'));
