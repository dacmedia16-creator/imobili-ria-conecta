ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS contrato_pendencia_descricao text,
  ADD COLUMN IF NOT EXISTS contrato_libera_assinatura boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.sales.contrato_pendencia_descricao IS 'Preenchido pelo jurídico ao anexar o contrato: descrição livre do que ainda falta (documento, certidão etc.), null quando nada falta.';
COMMENT ON COLUMN public.sales.contrato_libera_assinatura IS 'Jurídico marca false quando a pendência impede o gestor de mandar o contrato para assinatura; default true (nada bloqueia).';
