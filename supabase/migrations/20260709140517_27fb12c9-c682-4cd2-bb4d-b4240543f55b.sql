
-- Amplia sale_documents.parte para aceitar comprador_1/2 e vendedor_1/2
ALTER TABLE public.sale_documents DROP CONSTRAINT IF EXISTS sale_documents_parte_check;

UPDATE public.sale_documents SET parte = 'comprador_1' WHERE parte = 'comprador';
UPDATE public.sale_documents SET parte = 'vendedor_1'  WHERE parte = 'vendedor';

ALTER TABLE public.sale_documents
  ADD CONSTRAINT sale_documents_parte_check
  CHECK (parte IN ('comprador_1','comprador_2','vendedor_1','vendedor_2','imovel','outros'));
