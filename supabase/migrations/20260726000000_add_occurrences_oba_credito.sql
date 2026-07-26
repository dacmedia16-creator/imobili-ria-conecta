ALTER TABLE public.occurrences
  ADD COLUMN IF NOT EXISTS oba_credito boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.occurrences.oba_credito IS 'Espelha sale_payment.oba_credito — sinalizado no Pagamento da Resumo, financeiro acompanha aqui na Ocorrência.';
