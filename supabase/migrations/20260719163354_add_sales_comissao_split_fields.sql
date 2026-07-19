ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS valor_comissao_captador numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_comissao_vendedor numeric(14,2),
  ADD COLUMN IF NOT EXISTS valor_comissao_imobiliaria numeric(14,2);

COMMENT ON COLUMN public.sales.valor_comissao_captador IS 'Comissão do corretor captador, definida pelo gestor na revisão inicial.';
COMMENT ON COLUMN public.sales.valor_comissao_vendedor IS 'Comissão do corretor vendedor, definida pelo gestor na revisão inicial.';
COMMENT ON COLUMN public.sales.valor_comissao_imobiliaria IS 'Valor da comissão que fica para a imobiliária, calculado automaticamente (total - captador - vendedor).';
