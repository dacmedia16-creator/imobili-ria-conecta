-- Venda 630601126-81: entrada, 1ª parcela e financiamento já fecham os
-- R$ 230.000 negociados, mas o financiamento também estava repetido como
-- pagamento final. Mantém a composição correta e remove só a duplicação.
-- Reversão: restaurar pagamento_final_valor = 180000 e
-- pagamento_final_data = null para o sale_id abaixo.

do $$
declare
  v_payment public.sale_payment%rowtype;
begin
  select * into v_payment
  from public.sale_payment
  where sale_id = '65cdf990-afc9-45b7-a919-5eba99e6a7dc'
  for update;

  if not found then
    raise exception 'Venda 630601126-81 sem forma de pagamento.';
  end if;

  if v_payment.tipo_pagamento = 'financiamento'
     and v_payment.entrada_valor = 5000
     and v_payment.parcela1_valor = 45000
     and v_payment.parcela2_valor is null
     and v_payment.financiamento_valor = 180000
     and v_payment.pagamento_final_valor = 180000
     and v_payment.pagamento_final_data is null then
    update public.sale_payment
    set pagamento_final_valor = null,
        pagamento_final_data = null
    where sale_id = v_payment.sale_id;
  elsif not (
    v_payment.tipo_pagamento = 'financiamento'
    and v_payment.entrada_valor = 5000
    and v_payment.parcela1_valor = 45000
    and v_payment.parcela2_valor is null
    and v_payment.financiamento_valor = 180000
    and v_payment.pagamento_final_valor is null
  ) then
    raise exception 'Os valores atuais da venda 630601126-81 não correspondem ao estado auditado; nada foi alterado.';
  end if;
end;
$$;
