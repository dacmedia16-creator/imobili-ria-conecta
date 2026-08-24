-- Venda 630601126-81: os R$ 6.900 pertencentes à Única Escolha devem ser
-- recebidos em duas parcelas iguais (50% + 50%), conforme a condição da comissão.
-- Preserva datas, formas de pagamento, comissão bruta e parceria externa.
--
-- Reversão específica: restaurar prev_recebimento_valor = 2500 e
-- prev_recebimento2_valor = 4400 para a ocorrência vinculada ao sale_id abaixo.

do $$
declare
  v_occ public.occurrences%rowtype;
begin
  select * into v_occ
  from public.occurrences
  where sale_id = '65cdf990-afc9-45b7-a919-5eba99e6a7dc'
  for update;

  if not found then
    raise exception 'Venda 630601126-81 sem ocorrência vinculada.';
  end if;

  if v_occ.valor_comissao = 13800
     and v_occ.prev_recebimento_valor = 2500
     and v_occ.prev_recebimento2_valor = 4400
     and v_occ.prev_recebimento3_valor is null then
    update public.occurrences
    set prev_recebimento_valor = 3450,
        prev_recebimento2_valor = 3450
    where id = v_occ.id;
  elsif not (
    v_occ.valor_comissao = 13800
    and v_occ.prev_recebimento_valor = 3450
    and v_occ.prev_recebimento2_valor = 3450
    and v_occ.prev_recebimento3_valor is null
  ) then
    raise exception 'A previsão atual da venda 630601126-81 não corresponde ao estado auditado; nada foi alterado.';
  end if;
end;
$$;
