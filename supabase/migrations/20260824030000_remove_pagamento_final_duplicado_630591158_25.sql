-- Venda 630591158-25: os mesmos R$ 273.000 estavam gravados como financiamento
-- e como pagamento final. Mantém o financiamento e remove somente a duplicação.
-- Reversão: restaurar pagamento_final_valor = 273000 e
-- pagamento_final_data = 'NA LIBERAÇÃO DO FINANCIAMENTO' para o sale_id abaixo.

do $$
declare
  v_payment public.sale_payment%rowtype;
begin
  select * into v_payment
  from public.sale_payment
  where sale_id = '4a6f1ec4-c871-430a-8fb0-1a17c09944aa'
  for update;

  if not found then
    raise exception 'Venda 630591158-25 sem forma de pagamento.';
  end if;

  if v_payment.tipo_pagamento = 'financiamento'
     and v_payment.financiamento_valor = 273000
     and v_payment.pagamento_final_valor = 273000 then
    update public.sale_payment
    set pagamento_final_valor = null,
        pagamento_final_data = null
    where sale_id = v_payment.sale_id;
  elsif not (
    v_payment.tipo_pagamento = 'financiamento'
    and v_payment.financiamento_valor = 273000
    and v_payment.pagamento_final_valor is null
  ) then
    raise exception 'Os valores atuais da venda 630591158-25 não correspondem ao estado auditado; nada foi alterado.';
  end if;
end;
$$;
