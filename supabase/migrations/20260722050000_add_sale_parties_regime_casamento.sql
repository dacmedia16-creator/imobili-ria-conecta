ALTER TABLE public.sale_parties
  ADD COLUMN IF NOT EXISTS regime_casamento text;

COMMENT ON COLUMN public.sale_parties.regime_casamento IS 'Regime de bens do casamento (comunhão parcial, universal, separação total...), preenchido manualmente ou extraído automaticamente da certidão de casamento anexada.';
