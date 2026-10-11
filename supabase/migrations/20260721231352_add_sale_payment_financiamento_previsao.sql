-- Recuperado de supabase_migrations.schema_migrations (versão 20260721231352) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

alter table public.sale_payment add column if not exists financiamento_previsao date;
