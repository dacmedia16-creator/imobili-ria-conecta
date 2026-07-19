ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS indicador_lado text CHECK (indicador_lado IS NULL OR indicador_lado IN ('captador', 'vendedor'));

COMMENT ON COLUMN public.sales.indicador_lado IS 'De qual lado (captador ou vendedor) sai a comissão do indicador — o valor do indicador é descontado da comissão desse corretor, não do total.';
COMMENT ON COLUMN public.sales.percentual_comissao_indicador IS 'Percentual do indicador sobre a comissão do lado (captador/vendedor) indicado em indicador_lado — não sobre o valor total da comissão.';
