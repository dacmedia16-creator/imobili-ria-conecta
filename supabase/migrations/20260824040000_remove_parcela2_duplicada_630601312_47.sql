-- Venda 630601312-47: o financiamento de R$ 257.156,95 também estava repetido
-- como 2ª parcela. Mantém o financiamento e remove somente a duplicação.
-- Reversão: restaurar parcela2_valor = 257156.95 e
-- parcela2_data = 'Financiamento bancário' para o sale_id abaixo.

do $$
declare
  v_payment public.sale_payment%rowtype;
begin
  select * into v_payment
  from public.sale_payment
  where sale_id = '9f0e5224-3bcc-4ae1-977d-350d0530d2f8'
  for update;

  if not found then
    raise exception 'Venda 630601312-47 sem forma de pagamento.';
  end if;

  if v_payment.tipo_pagamento = 'financiamento'
     and v_payment.financiamento_valor = 257156.95
     and v_payment.parcela2_valor = 257156.95 then
    update public.sale_payment
    set parcela2_valor = null,
        parcela2_data = null
    where sale_id = v_payment.sale_id;
  elsif not (
    v_payment.tipo_pagamento = 'financiamento'
    and v_payment.financiamento_valor = 257156.95
    and v_payment.parcela2_valor is null
  ) then
    raise exception 'Os valores atuais da venda 630601312-47 não correspondem ao estado auditado; nada foi alterado.';
  end if;
end;
$$;
