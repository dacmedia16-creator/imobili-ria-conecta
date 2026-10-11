ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS imovel_endereco text;

COMMENT ON COLUMN public.sales.imovel_endereco IS 'Endereço completo do imóvel, preenchido manualmente ou extraído automaticamente da matrícula anexada.';
