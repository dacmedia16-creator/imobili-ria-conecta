-- Venda 630601126-81: a previsão de recebimento deve registrar somente a
-- metade da comissão pertencente à Única Escolha. A outra metade (R$ 6.900)
-- pertence ao parceiro externo e não transita pela imobiliária.
--
-- Reversão específica: restaurar prev_recebimento_valor = 5000 e
-- prev_recebimento2_valor = 8800 para a ocorrência vinculada ao sale_id abaixo.

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
     and v_occ.prev_recebimento_valor = 5000
     and v_occ.prev_recebimento2_valor = 8800
     and v_occ.prev_recebimento3_valor is null then
    update public.occurrences
    set prev_recebimento_valor = 2500,
        prev_recebimento2_valor = 4400
    where id = v_occ.id;
  elsif not (
    v_occ.valor_comissao = 13800
    and v_occ.prev_recebimento_valor = 2500
    and v_occ.prev_recebimento2_valor = 4400
    and v_occ.prev_recebimento3_valor is null
  ) then
    raise exception 'A previsão atual da venda 630601126-81 não corresponde ao estado auditado; nada foi alterado.';
  end if;
end;
$$;
