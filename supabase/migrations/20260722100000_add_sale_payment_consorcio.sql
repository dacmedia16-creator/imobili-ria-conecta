ALTER TABLE public.sale_payment
  ADD COLUMN IF NOT EXISTS consorcio_nome text,
  ADD COLUMN IF NOT EXISTS consorcio_grupo text,
  ADD COLUMN IF NOT EXISTS consorcio_cota text;

COMMENT ON COLUMN public.sale_payment.consorcio_nome IS 'Preenchido quando tipo_pagamento = consorcio: nome da administradora do consórcio.';
