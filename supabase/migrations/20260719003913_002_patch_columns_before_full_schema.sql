-- Recuperado de supabase_migrations.schema_migrations (versão 20260719003913) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Colunas/valores que faltam nas tabelas já criadas pela migration inicial,
-- necessários antes de rodar o dump idempotente completo (que usa CREATE TABLE IF NOT EXISTS
-- e portanto não altera tabelas já existentes).

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';

ALTER TABLE public.occurrences
  ADD COLUMN IF NOT EXISTS reopen_reason text,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS aceita_financeiro boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aceita_financeiro_em timestamptz,
  ADD COLUMN IF NOT EXISTS aceita_financeiro_por uuid REFERENCES auth.users(id);

ALTER TABLE public.sale_documents
  ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS parte text NOT NULL DEFAULT 'outros';
