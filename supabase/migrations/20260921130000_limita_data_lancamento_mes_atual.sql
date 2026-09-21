-- Em Lançamento, data_assinatura representa a data da venda (não uma assinatura
-- contratual). Novos preenchimentos/edições devem permanecer no mês comercial atual.
-- Registros históricos fora do mês continuam consultáveis e não sofrem backfill.

create or replace function public.validar_data_venda_lancamento_mes_atual()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_mes_atual date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
begin
  if new.modalidade::text = 'lancamento'
     and new.data_assinatura is not null
     and date_trunc('month', new.data_assinatura)::date <> v_mes_atual then
    raise exception 'A data da venda de Lançamento deve estar dentro do mês atual (%).',
      to_char(v_mes_atual, 'MM/YYYY') using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_validar_data_venda_lancamento_mes_atual on public.sales;
create trigger trg_validar_data_venda_lancamento_mes_atual
before insert or update of modalidade, data_assinatura on public.sales
for each row execute function public.validar_data_venda_lancamento_mes_atual();
