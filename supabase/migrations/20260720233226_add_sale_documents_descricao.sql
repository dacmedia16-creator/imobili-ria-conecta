-- Recuperado de supabase_migrations.schema_migrations (versão 20260720233226) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

alter table public.sale_documents add column if not exists descricao text;
