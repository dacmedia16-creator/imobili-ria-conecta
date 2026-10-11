-- Recuperado de supabase_migrations.schema_migrations (versão 20260720021510) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

ALTER TABLE public.sale_payment ADD COLUMN IF NOT EXISTS financiamento_banco text;
