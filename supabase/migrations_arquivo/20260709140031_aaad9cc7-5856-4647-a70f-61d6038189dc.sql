ALTER TABLE public.sale_documents ADD COLUMN IF NOT EXISTS parte text NOT NULL DEFAULT 'outros';
ALTER TABLE public.sale_documents DROP CONSTRAINT IF EXISTS sale_documents_parte_check;
ALTER TABLE public.sale_documents ADD CONSTRAINT sale_documents_parte_check CHECK (parte IN ('comprador','vendedor','imovel','outros'));
CREATE INDEX IF NOT EXISTS sale_documents_sale_parte_idx ON public.sale_documents(sale_id, parte);