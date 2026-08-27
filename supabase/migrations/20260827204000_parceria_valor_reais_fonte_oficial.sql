-- O valor da parceria externa em reais e a fonte oficial. O percentual e apenas referencia.
-- Corrige diferencas no total distribuido quando o percentual exibido e arredondado.
do $migration$
declare
  v_definition text;
  v_old text := $old$  if v_sale.parceria_tipo is null then
    v_parceria := 0;
  elsif v_sale.parceria_percentual is not null and v_negociado > 0 then
    v_parceria := round(v_sale.parceria_percentual / 100 * v_negociado, 2);
  else
    v_parceria := coalesce(v_sale.parceria_valor, 0);
  end if;$old$;
  v_new text := $new$  if v_sale.parceria_tipo is null then
    v_parceria := 0;
  elsif v_sale.parceria_valor is not null then
    v_parceria := round(v_sale.parceria_valor, 2);
  elsif v_sale.parceria_percentual is not null and v_negociado > 0 then
    v_parceria := round(v_sale.parceria_percentual / 100 * v_negociado, 2);
  else
    v_parceria := 0;
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

