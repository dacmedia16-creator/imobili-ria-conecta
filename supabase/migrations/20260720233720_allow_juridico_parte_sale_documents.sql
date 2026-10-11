-- Recuperado de supabase_migrations.schema_migrations (versão 20260720233720) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

alter table public.sale_documents drop constraint sale_documents_parte_check;
alter table public.sale_documents add constraint sale_documents_parte_check
  check (parte = any (array['comprador_1','comprador_2','vendedor_1','vendedor_2','imovel','outros','juridico']::text[]));
