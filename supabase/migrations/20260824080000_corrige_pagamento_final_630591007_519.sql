-- Venda 630591007-519: com valor negociado de R$ 380.000 e entrada de
-- R$ 167.000, o pagamento final correto é R$ 213.000. Corrige apenas os
-- R$ 300 excedentes no pagamento final e preserva os demais dados.
-- Reversão: restaurar pagamento_final_valor = 213300 para o sale_id abaixo.

do $$
declare
  v_payment public.sale_payment%rowtype;
begin
  select * into v_payment
  from public.sale_payment
  where sale_id = 'f50d94f4-cd68-4798-b519-a3de0c23eea8'
  for update;

  if not found then
    raise exception 'Venda 630591007-519 sem forma de pagamento.';
  end if;

  if v_payment.tipo_pagamento = 'vista'
     and v_payment.entrada_valor = 167000
     and v_payment.parcela1_valor is null
     and v_payment.parcela2_valor is null
     and v_payment.pagamento_final_valor = 213300
     and v_payment.pagamento_final_data = 'ato da escritura ' then
    update public.sale_payment
    set pagamento_final_valor = 213000
    where sale_id = v_payment.sale_id;
  elsif not (
    v_payment.tipo_pagamento = 'vista'
    and v_payment.entrada_valor = 167000
    and v_payment.parcela1_valor is null
    and v_payment.parcela2_valor is null
    and v_payment.pagamento_final_valor = 213000
    and v_payment.pagamento_final_data = 'ato da escritura '
  ) then
    raise exception 'Os valores atuais da venda 630591007-519 não correspondem ao estado auditado; nada foi alterado.';
  end if;
end;
$$;
