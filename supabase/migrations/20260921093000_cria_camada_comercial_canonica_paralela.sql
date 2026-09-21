-- Camada canônica paralela para relatórios comerciais.
-- Não altera Dashboard, Equipes, Produção ou Financeiro nesta migration.
-- Retorna uma linha por venda comercial válida, com métricas próprias da REMAX.

create or replace function public.vendas_comerciais_canonicas()
returns table (
  sale_id uuid,
  venda_em timestamptz,
  modalidade text,
  status text,
  codigo_interno text,
  imovel_id text,
  valor_negociado numeric,
  comissao_bruta numeric,
  parceria_externa numeric,
  vgv_proprio numeric,
  comissao_propria numeric,
  occurrence_count bigint,
  occurrence_concluida_count bigint
)
language sql
stable
security invoker
set search_path = public
as $function$
  with metricas as (
    select * from public.metricas_venda_sem_parceria()
  )
  select
    v.sale_id,
    v.venda_em,
    s.modalidade::text,
    s.status::text,
    s.codigo_interno,
    s.imovel_id,
    m.vgv,
    m.comissao_bruta,
    m.parceria_externa,
    case
      when m.comissao_bruta > 0 then
        m.vgv * least(greatest(m.comissao_bruta - m.parceria_externa, 0) / m.comissao_bruta, 1)
      else 0
    end as vgv_proprio,
    greatest(m.comissao_bruta - m.parceria_externa, 0) as comissao_propria,
    coalesce(o.occurrence_count, 0),
    coalesce(o.occurrence_concluida_count, 0)
  from public.vendas_comerciais_validas() v
  join public.sales s on s.id = v.sale_id
  join metricas m on m.sale_id = v.sale_id
  left join lateral (
    select
      count(*) as occurrence_count,
      count(*) filter (where oc.status = 'concluida') as occurrence_concluida_count
    from public.occurrences oc
    where oc.sale_id = s.id
  ) o on true
  where s.status::text not in ('cancelada', 'arquivada')
    and s.valor_negociado > 0
    and s.valor_total_comissao > 0;
$function$;

revoke execute on function public.vendas_comerciais_canonicas() from public, anon;
grant execute on function public.vendas_comerciais_canonicas() to authenticated;