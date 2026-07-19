ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS valor_comissao_indicador numeric(14,2),
  ADD COLUMN IF NOT EXISTS percentual_comissao_indicador numeric(6,3);

COMMENT ON COLUMN public.sales.valor_comissao_indicador IS 'Comissão do indicador, definida pelo gestor na revisão inicial.';
COMMENT ON COLUMN public.sales.percentual_comissao_indicador IS 'Percentual da comissão do indicador, calculado/editado junto com valor_comissao_indicador.';
