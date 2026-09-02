-- Mantém a previsão da ocorrência alinhada à venda somente enquanto ela ainda está
-- na etapa "Ocorrência pendente". Depois do envio ao Financeiro, a ocorrência passa
-- a ser a fonte de verdade e eventuais ajustes financeiros não são sobrescritos.

create or replace function public.sincronizar_previsao_ocorrencia_pendente(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.occurrences o
  set
    prev_recebimento_valor = s.previsao_recebimento_valor,
    prev_recebimento_data = s.previsao_recebimento_data,
    prev_recebimento_forma = s.previsao_recebimento_forma,
    prev_recebimento2_valor = s.previsao_recebimento2_valor,
    prev_recebimento2_data = s.previsao_recebimento2_data,
    prev_recebimento2_forma = s.previsao_recebimento2_forma,
    prev_recebimento3_valor = s.previsao_recebimento3_valor,
    prev_recebimento3_data = s.previsao_recebimento3_data,
    prev_recebimento3_forma = s.previsao_recebimento3_forma
  from public.sales s
  where s.id = p_sale_id
    and o.sale_id = s.id
    and s.status::text = 'ocorrencia_pendente'
    and o.status = 'pendente';
end;
$function$;

comment on function public.sincronizar_previsao_ocorrencia_pendente(uuid) is
  'Sincroniza as três parcelas previstas da venda com a ocorrência antes do envio ao Financeiro.';

create or replace function public.trg_sincronizar_previsao_ocorrencia_pendente()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.sincronizar_previsao_ocorrencia_pendente(new.id);
  return new;
end;
$function$;

drop trigger if exists trg_sales_sync_previsao_ocorrencia_pendente on public.sales;
create trigger trg_sales_sync_previsao_ocorrencia_pendente
after update of
  previsao_recebimento_valor,
  previsao_recebimento_data,
  previsao_recebimento_forma,
  previsao_recebimento2_valor,
  previsao_recebimento2_data,
  previsao_recebimento2_forma,
  previsao_recebimento3_valor,
  previsao_recebimento3_data,
  previsao_recebimento3_forma
on public.sales
for each row
when (old is distinct from new)
execute function public.trg_sincronizar_previsao_ocorrencia_pendente();

-- Repara casos já existentes, inclusive a venda que revelou o problema. O filtro
-- deliberadamente não alcança ocorrências já enviadas ou concluídas pelo Financeiro.
do $function$
declare
  v_sale_id uuid;
begin
  for v_sale_id in
    select s.id
    from public.sales s
    join public.occurrences o on o.sale_id = s.id
    where s.status::text = 'ocorrencia_pendente'
      and o.status = 'pendente'
      and row(
        o.prev_recebimento_valor, o.prev_recebimento_data, o.prev_recebimento_forma,
        o.prev_recebimento2_valor, o.prev_recebimento2_data, o.prev_recebimento2_forma,
        o.prev_recebimento3_valor, o.prev_recebimento3_data, o.prev_recebimento3_forma
      ) is distinct from row(
        s.previsao_recebimento_valor, s.previsao_recebimento_data, s.previsao_recebimento_forma,
        s.previsao_recebimento2_valor, s.previsao_recebimento2_data, s.previsao_recebimento2_forma,
        s.previsao_recebimento3_valor, s.previsao_recebimento3_data, s.previsao_recebimento3_forma
      )
  loop
    perform public.sincronizar_previsao_ocorrencia_pendente(v_sale_id);
  end loop;
end;
$function$;
