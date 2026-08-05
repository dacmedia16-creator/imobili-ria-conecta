-- Remove "WhatsApp" da lista fixa (nenhuma venda usava). "C2S" sai do dropdown do formulário
-- (ver MIDIA_OPTIONS em src/lib/status.ts) mas continua válido aqui no CHECK porque a venda
-- 46412525-5c89-4234-a1ff-eeb512585e15 já tem esse valor — não dá pra travar sem quebrar o dado
-- existente ou apagá-lo, e a decisão foi manter o dado como está.
ALTER TABLE public.sales DROP CONSTRAINT sales_midia_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_midia_check
  CHECK (midia IS NULL OR midia = ANY (ARRAY['Instagram','Facebook','Portal','Site Remax','Tráfego Pago','C2S','Indicação','Placa','Imovelweb','Chaves na Mão','Outro']::text[]));

ALTER TABLE public.occurrences DROP CONSTRAINT occurrences_midia_check;
ALTER TABLE public.occurrences ADD CONSTRAINT occurrences_midia_check
  CHECK (midia IS NULL OR midia = ANY (ARRAY['Instagram','Facebook','Portal','Site Remax','Tráfego Pago','C2S','Indicação','Placa','Imovelweb','Chaves na Mão','Outro']::text[]));
