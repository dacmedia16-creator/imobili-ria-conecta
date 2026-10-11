-- Recuperado de supabase_migrations.schema_migrations (versão 20260719003921) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'contrato_conferencia_gestor';
ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'contrato_conferencia_corretor';
ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'contrato_ok_corretor';
ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'ocorrencia_analise_financeiro';
ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'ocorrencia_devolvida_gestor';
