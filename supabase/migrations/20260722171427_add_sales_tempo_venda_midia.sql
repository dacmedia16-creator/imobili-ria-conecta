ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS tempo_venda text,
  ADD COLUMN IF NOT EXISTS midia text;

COMMENT ON COLUMN public.sales.tempo_venda IS 'Tempo que o imóvel levou para vender, preenchido pelo corretor no Resumo da venda; copiado para occurrences.tempo_venda ao gerar a ocorrência.';
COMMENT ON COLUMN public.sales.midia IS 'Mídia/canal que gerou a venda (Instagram, Portal, Placa...), preenchido pelo corretor no Resumo da venda; copiado para occurrences.midia ao gerar a ocorrência.';
