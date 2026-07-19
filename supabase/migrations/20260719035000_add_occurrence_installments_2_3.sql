ALTER TABLE public.occurrences
  ADD COLUMN IF NOT EXISTS prev_recebimento2_valor numeric,
  ADD COLUMN IF NOT EXISTS prev_recebimento2_data date,
  ADD COLUMN IF NOT EXISTS prev_recebimento2_forma text,
  ADD COLUMN IF NOT EXISTS prev_recebimento3_valor numeric,
  ADD COLUMN IF NOT EXISTS prev_recebimento3_data date,
  ADD COLUMN IF NOT EXISTS prev_recebimento3_forma text;

COMMENT ON COLUMN public.occurrences.prev_recebimento_valor IS '1ª parcela de recebimento da comissão';
COMMENT ON COLUMN public.occurrences.prev_recebimento2_valor IS '2ª parcela de recebimento da comissão';
COMMENT ON COLUMN public.occurrences.prev_recebimento3_valor IS '3ª parcela de recebimento da comissão';
