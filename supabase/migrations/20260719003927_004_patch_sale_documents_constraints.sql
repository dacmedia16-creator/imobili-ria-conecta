-- Recuperado de supabase_migrations.schema_migrations (versão 20260719003927) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

ALTER TABLE public.sale_documents DROP CONSTRAINT IF EXISTS sale_documents_extraction_status_check;
ALTER TABLE public.sale_documents ADD CONSTRAINT sale_documents_extraction_status_check
  CHECK (extraction_status IN ('none','pending','done','failed'));

ALTER TABLE public.sale_documents DROP CONSTRAINT IF EXISTS sale_documents_parte_check;
ALTER TABLE public.sale_documents ADD CONSTRAINT sale_documents_parte_check
  CHECK (parte IN ('comprador_1','comprador_2','vendedor_1','vendedor_2','imovel','outros'));
