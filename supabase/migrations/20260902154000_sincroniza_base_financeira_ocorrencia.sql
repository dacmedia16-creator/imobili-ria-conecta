-- Mantém a base financeira da ocorrência alinhada à revisão da venda.
-- Antes, o save da Resumo sincronizava apenas occurrence_commissions; o cabeçalho da ocorrência
-- (valor negociado, percentual e valor total da comissão) podia continuar com uma versão antiga.
-- Isso fazia os percentuais das mesmas linhas serem recalculados sobre uma base defasada.

create or replace function public.sincronizar_base_financeira_ocorrencia(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sale public.sales%rowtype;
begin
  select * into v_sale
  from public.sales
  where id = p_sale_id;

  if not found then
    return;
  end if;

  update public.occurrences
  set
    valor_anunciado = v_sale.valor_anunciado,
    valor_negociado = v_sale.valor_negociado,
    percentual_comissao = v_sale.percentual_comissao,
    valor_comissao = coalesce(
      v_sale.valor_total_comissao,
      case
        when v_sale.valor_negociado is not null and v_sale.percentual_comissao is not null
          then round(v_sale.valor_negociado * v_sale.percentual_comissao / 100, 2)
        else null
      end
    )
  where sale_id = p_sale_id;
end;
$function$;
comment on function public.sincronizar_base_financeira_ocorrencia(uuid) is
  'Sincroniza valor negociado e comissão da ocorrência com a revisão da venda.';

create or replace function public.trg_sincronizar_financeiro_ocorrencia_da_venda()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.sincronizar_base_financeira_ocorrencia(new.id);
  perform public.sync_occurrence_commissions(new.id);
  return new;
end;
$function$;

drop trigger if exists trg_sales_sync_financeiro_ocorrencia on public.sales;
create trigger trg_sales_sync_financeiro_ocorrencia
after update of
  valor_anunciado,
  valor_negociado,
  percentual_comissao,
  valor_total_comissao,
  valor_comissao_captador,
  valor_comissao_vendedor,
  valor_comissao_indicador_captador,
  valor_comissao_indicador_vendedor,
  valor_comissao_lider_captador,
  valor_comissao_lider_vendedor,
  parceria_tipo,
  parceria_percentual,
  parceria_valor,
  percentual_remax,
  valor_remax
on public.sales
for each row
when (old is distinct from new)
execute function public.trg_sincronizar_financeiro_ocorrencia_da_venda();

-- Corrige ocorrências já existentes que ficaram com a base antiga. Linhas manuais do financeiro
-- não são tocadas: sync_occurrence_commissions altera somente managed_by_sale = true.
do $function$
declare
  v_sale_id uuid;
begin
  for v_sale_id in
    select s.id
    from public.sales s
    join public.occurrences o on o.sale_id = s.id
    where
      o.valor_anunciado is distinct from s.valor_anunciado
      or o.valor_negociado is distinct from s.valor_negociado
      or o.percentual_comissao is distinct from s.percentual_comissao
      or o.valor_comissao is distinct from coalesce(
        s.valor_total_comissao,
        case
          when s.valor_negociado is not null and s.percentual_comissao is not null
            then round(s.valor_negociado * s.percentual_comissao / 100, 2)
          else null
        end
      )
  loop
    perform public.sincronizar_base_financeira_ocorrencia(v_sale_id);
    perform public.sync_occurrence_commissions(v_sale_id);
  end loop;
end;
$function$;
