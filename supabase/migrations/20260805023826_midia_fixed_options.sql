-- sales.midia e occurrences.midia eram texto livre — "Instagram", "instagram", "Insta" viravam
-- categorias diferentes no relatório e fragmentavam a análise de canal. Trava numa lista fixa via
-- CHECK (mesmo padrão já usado em sale_payment.tipo_pagamento e sale_parties.tipo_pessoa), sem
-- precisar de enum novo. Os 5 valores hoje em uso (Tráfego Pago, C2S, Site Remax, Facebook, Portal)
-- já batem exatamente com a lista, então não precisou normalizar nada existente.
ALTER TABLE public.sales ADD CONSTRAINT sales_midia_check
  CHECK (midia IS NULL OR midia = ANY (ARRAY['Instagram','Facebook','Portal','Site Remax','Tráfego Pago','C2S','Indicação','Placa','WhatsApp','Outro']::text[]));

ALTER TABLE public.occurrences ADD CONSTRAINT occurrences_midia_check
  CHECK (midia IS NULL OR midia = ANY (ARRAY['Instagram','Facebook','Portal','Site Remax','Tráfego Pago','C2S','Indicação','Placa','WhatsApp','Outro']::text[]));
