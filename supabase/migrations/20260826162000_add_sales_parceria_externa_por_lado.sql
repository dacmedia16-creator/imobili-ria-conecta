ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS parceria_externa_captacao boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parceria_externa_venda boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sales.parceria_externa_captacao IS
  'Quando true, a captação é externa e não deve ter corretor, gestor ou indicador interno selecionado.';
COMMENT ON COLUMN public.sales.parceria_externa_venda IS
  'Quando true, a venda é externa e não deve ter corretor, gestor ou indicador interno selecionado.';
