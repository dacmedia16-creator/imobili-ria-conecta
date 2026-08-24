-- Venda 630591260-38: entrada e parcelas já fecham os R$ 200.000 negociados,
-- mas o mesmo total também estava repetido como pagamento final.
-- Mantém entrada e parcelas e remove somente a duplicação.
-- Reversão: restaurar pagamento_final_valor = 200000 e
-- pagamento_final_data = null para o sale_id abaixo.

do $$
declare
  v_payment public.sale_payment%rowtype;
begin
  select * into v_payment
  from public.sale_payment
  where sale_id = '2de81b3b-496b-4d60-bc3e-57a65e5e3fa0'
  for update;

  if not found then
    raise exception 'Venda 630591260-38 sem forma de pagamento.';
  end if;

  if v_payment.tipo_pagamento = 'vista'
     and v_payment.entrada_valor = 2000
     and v_payment.parcela1_valor = 103000
     and v_payment.parcela2_valor = 95000
     and v_payment.pagamento_final_valor = 200000
     and v_payment.pagamento_final_data is null then
    update public.sale_payment
    set pagamento_final_valor = null,
        pagamento_final_data = null
    where sale_id = v_payment.sale_id;
  elsif not (
    v_payment.tipo_pagamento = 'vista'
    and v_payment.entrada_valor = 2000
    and v_payment.parcela1_valor = 103000
    and v_payment.parcela2_valor = 95000
    and v_payment.pagamento_final_valor is null
  ) then
    raise exception 'Os valores atuais da venda 630591260-38 não correspondem ao estado auditado; nada foi alterado.';
  end if;
end;
$$;
