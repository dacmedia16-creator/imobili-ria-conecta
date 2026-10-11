-- Adiciona "Imovelweb" e "Chaves na Mão" à lista fixa de canais em sales.midia/occurrences.midia
-- (CHECK criado em 20260805030000_midia_fixed_options.sql). CHECK não tem ALTER direto — precisa
-- dropar e recriar com a lista nova.
ALTER TABLE public.sales DROP CONSTRAINT sales_midia_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_midia_check
  CHECK (midia IS NULL OR midia = ANY (ARRAY['Instagram','Facebook','Portal','Site Remax','Tráfego Pago','C2S','Indicação','Placa','WhatsApp','Imovelweb','Chaves na Mão','Outro']::text[]));

ALTER TABLE public.occurrences DROP CONSTRAINT occurrences_midia_check;
ALTER TABLE public.occurrences ADD CONSTRAINT occurrences_midia_check
  CHECK (midia IS NULL OR midia = ANY (ARRAY['Instagram','Facebook','Portal','Site Remax','Tráfego Pago','C2S','Indicação','Placa','WhatsApp','Imovelweb','Chaves na Mão','Outro']::text[]));
