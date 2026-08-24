-- Venda 630601113-11: a observação registra entrada de R$ 20.000 mais
-- 60 parcelas mensais de R$ 1.000, mas o valor das parcelas não estava
-- preenchido. Registra os R$ 60.000 na 1ª parcela e preserva os demais dados.
-- Reversão: restaurar parcela1_valor = null e
-- parcela1_data = 'Vide campo observações' para o sale_id abaixo.

do $$
declare
  v_payment public.sale_payment%rowtype;
begin
  select * into v_payment
  from public.sale_payment
  where sale_id = '6bc95764-6f6f-40d7-9f69-c65ccb77f11f'
  for update;

  if not found then
    raise exception 'Venda 630601113-11 sem forma de pagamento.';
  end if;

  if v_payment.tipo_pagamento = 'vista'
     and v_payment.entrada_valor = 20000
     and v_payment.parcela1_valor is null
     and v_payment.parcela1_data = 'Vide campo observações'
     and v_payment.parcela2_valor is null
     and coalesce(v_payment.pagamento_final_valor, 0) = 0
     and v_payment.observacoes ilike '%60 PARCELAS MENSAIS DE 1.000,00%' then
    update public.sale_payment
    set parcela1_valor = 60000,
        parcela1_data = '60 parcelas mensais de R$ 1.000,00'
    where sale_id = v_payment.sale_id;
  elsif not (
    v_payment.tipo_pagamento = 'vista'
    and v_payment.entrada_valor = 20000
    and v_payment.parcela1_valor = 60000
    and v_payment.parcela1_data = '60 parcelas mensais de R$ 1.000,00'
    and v_payment.parcela2_valor is null
    and coalesce(v_payment.pagamento_final_valor, 0) = 0
  ) then
    raise exception 'Os valores atuais da venda 630601113-11 não correspondem ao estado auditado; nada foi alterado.';
  end if;
end;
$$;
