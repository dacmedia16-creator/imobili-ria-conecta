-- CATCH-UP: sale_payment.tipo_pagamento existe em produção (text NOT NULL, confirmado via
-- information_schema) mas nenhuma migration deste repositório a criava — a migration seguinte
-- (20260810160000_sale_payment_libera_consorcio_no_check.sql) já tenta DROPar a check constraint
-- original dela (sale_payment_tipo_pagamento_check) pra liberar 'consorcio', quebrando um replay
-- do zero com "constraint ... does not exist".
--
-- Recriada aqui com a constraint ORIGINAL (só vista/financiamento, sem consorcio) — a migration
-- seguinte, que já existe, troca pra incluir 'consorcio' logo depois, então esta migration não
-- duplica essa decisão. DEFAULT 'vista' incluído pra bater com produção (information_schema
-- confirma esse default hoje; nenhuma migration deste repo o define — mesmo padrão de coluna
-- criada fora do histórico, mas o default em si não quebra o replay, só reduz fidelidade se
-- omitido).
ALTER TABLE public.sale_payment
  ADD COLUMN IF NOT EXISTS tipo_pagamento text NOT NULL DEFAULT 'vista'
    CHECK (tipo_pagamento = ANY (ARRAY['vista'::text, 'financiamento'::text]));
