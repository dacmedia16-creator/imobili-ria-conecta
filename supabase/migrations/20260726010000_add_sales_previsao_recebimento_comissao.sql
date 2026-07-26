ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS previsao_recebimento_valor numeric(14,2),
  ADD COLUMN IF NOT EXISTS previsao_recebimento_data date,
  ADD COLUMN IF NOT EXISTS previsao_recebimento_forma text;

COMMENT ON COLUMN public.sales.previsao_recebimento_valor IS 'Preenchido pelo gestor na Divisão da comissão — vira a 1ª parcela de prev_recebimento em occurrences quando a Ocorrência é criada.';
