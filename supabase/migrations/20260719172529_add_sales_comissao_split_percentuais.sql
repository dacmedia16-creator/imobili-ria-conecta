ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS percentual_comissao_captador numeric(6,3),
  ADD COLUMN IF NOT EXISTS percentual_comissao_vendedor numeric(6,3);

COMMENT ON COLUMN public.sales.percentual_comissao_captador IS 'Percentual da comissão do corretor captador, calculado/editado junto com valor_comissao_captador.';
COMMENT ON COLUMN public.sales.percentual_comissao_vendedor IS 'Percentual da comissão do corretor vendedor, calculado/editado junto com valor_comissao_vendedor.';
