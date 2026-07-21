-- Parceria externa (imobiliária externa ou outra unidade RE/MAX) sinalizada já na Resumo,
-- antes de a venda chegar à Ocorrência. A Ocorrência puxa esses dados automaticamente
-- (ver syncOccurrencePartnerFromSale / createOcc no front), sem precisar reentrar nada.
ALTER TABLE public.sales
  ADD COLUMN parceria_tipo TEXT CHECK (parceria_tipo IN ('imobiliaria_externa', 'remax_externa')),
  ADD COLUMN parceria_nome TEXT,
  ADD COLUMN parceria_cpf_cnpj TEXT,
  ADD COLUMN parceria_percentual NUMERIC(6,3),
  ADD COLUMN parceria_valor NUMERIC(14,2);

-- from_sale marca a linha de occurrence_partners que foi sincronizada a partir da Resumo,
-- pra sync/pull encontrarem essa linha sem duplicar quando o financeiro edita banco/agência/conta.
ALTER TABLE public.occurrence_partners
  ADD COLUMN tipo TEXT CHECK (tipo IN ('imobiliaria_externa', 'remax_externa')),
  ADD COLUMN from_sale BOOLEAN NOT NULL DEFAULT false;
