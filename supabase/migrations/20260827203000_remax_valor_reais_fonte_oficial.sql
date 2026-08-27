-- O valor da parcela REMAX em reais e a fonte oficial. O percentual e apenas referencia.
-- Corrige diferencas no saldo da imobiliaria quando o percentual exibido e arredondado.
do $migration$
declare
  v_definition text;
  v_old text := $old$  if v_sale.percentual_remax is not null and v_negociado > 0 then
    v_parte_remax := round(v_sale.percentual_remax / 100 * v_negociado, 2);
  else
    v_parte_remax := v_sale.valor_remax;
  end if;$old$;
  v_new text := $new$  if v_sale.valor_remax is not null then
    v_parte_remax := round(v_sale.valor_remax, 2);
  elsif v_sale.percentual_remax is not null and v_negociado > 0 then
    v_parte_remax := round(v_sale.percentual_remax / 100 * v_negociado, 2);
  else
    v_parte_remax := null;
  end if;$new$;
begin
  select pg_get_functiondef('public.calcular_distribuicao_venda(public.sales)'::regprocedure)
  into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Trecho esperado de calcular_distribuicao_venda nao encontrado; migration interrompida com seguranca.';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;

