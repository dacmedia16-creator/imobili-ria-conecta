-- A migration 20260722100000_add_sale_payment_consorcio.sql adicionou consorcio_nome/
-- consorcio_grupo/consorcio_cota e o dropdown de "Forma de pagamento" já oferece a opção
-- "Consórcio" desde então (PaymentStep.tsx), mas o check constraint de tipo_pagamento nunca foi
-- atualizado — continuava só aceitando 'vista'/'financiamento', fazendo todo salvamento com
-- Consórcio falhar com "new row for relation sale_payment violates check constraint
-- sale_payment_tipo_pagamento_check".
ALTER TABLE public.sale_payment
  DROP CONSTRAINT sale_payment_tipo_pagamento_check;

ALTER TABLE public.sale_payment
  ADD CONSTRAINT sale_payment_tipo_pagamento_check
  CHECK (tipo_pagamento = ANY (ARRAY['vista'::text, 'financiamento'::text, 'consorcio'::text]));
