ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS parceria_banco text,
  ADD COLUMN IF NOT EXISTS parceria_agencia text,
  ADD COLUMN IF NOT EXISTS parceria_conta text,
  ADD COLUMN IF NOT EXISTS parceria_pix text;

ALTER TABLE public.occurrence_partners
  ADD COLUMN IF NOT EXISTS pix text;

COMMENT ON COLUMN public.sales.parceria_banco IS 'Dados bancários da parceria externa, preenchidos no Resumo. Só entram em occurrence_partners na criação da ocorrência — depois disso o financeiro é quem edita, sem ser sobrescrito por aqui.';
