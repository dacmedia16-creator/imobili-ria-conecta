-- Fonte única do resumo de Desempenho. Uma venda só é efetivada quando entra pela primeira vez
-- em ocorrencia_analise_financeiro. Histórico de contrato/ocorrência anterior não basta, pois a
-- venda pode voltar para aguardando_assinatura antes de ser enviada ao Financeiro.
create or replace function public.resumo_desempenho_30d()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with efetivadas as (
    select h.sale_id, min(h.created_at) as efetivada_em
    from sale_status_history h
    where h.para::text = 'ocorrencia_analise_financeiro'
    group by h.sale_id
  ), base as (
    select
      s.id,
      greatest(coalesce(s.valor_negociado, 0), 0) as vgv,
      greatest(coalesce((d.valor->>'comissao_bruta')::numeric, 0), 0) as comissao_bruta,
      greatest(coalesce((d.valor->>'parceria_externa')::numeric, 0), 0) as parceria_externa,
      greatest(coalesce((d.valor->>'saldo_inicial_imobiliaria')::numeric, 0), 0) as parte_unidade,
      greatest(coalesce((d.valor->>'saldo_liquido_imobiliaria')::numeric, 0), 0) as receita_liquida
    from efetivadas e
    join sales s on s.id = e.sale_id
    cross join lateral (
      select public.calcular_distribuicao_venda(s.id) as valor
    ) d
    where e.efetivada_em >= now() - interval '30 days'
      and s.status::text not in ('cancelada', 'arquivada')
  ), propria as (
    select *,
      greatest(comissao_bruta - parceria_externa, 0) as comissao_propria,
      case
        when comissao_bruta > 0 then
          vgv * least(greatest(comissao_bruta - parceria_externa, 0) / comissao_bruta, 1)
        else 0
      end as vgv_proprio
    from base
  ), evolucao as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', to_char(m.mes, 'YYYY-MM'),
      'vendas_fechadas', coalesce(x.quantidade, 0),
      'comissao', coalesce(x.comissao, 0)
    ) order by m.mes), '[]'::jsonb) as valor
    from generate_series(
      date_trunc('month', now()) - interval '11 months',
      date_trunc('month', now()),
      interval '1 month'
    ) m(mes)
    left join (
      select date_trunc('month', e.efetivada_em) as mes,
        count(*) as quantidade,
        sum(greatest(coalesce(s.valor_total_comissao, 0), 0)) as comissao
      from efetivadas e
      join sales s on s.id = e.sale_id
      where s.status::text not in ('cancelada', 'arquivada')
      group by 1
    ) x on x.mes = m.mes
  )
  select jsonb_build_object(
    'vgv_proprio', coalesce(sum(vgv_proprio), 0),
    'comissao_propria', coalesce(sum(comissao_propria), 0),
    'parte_unidade', coalesce(sum(parte_unidade), 0),
    'receita_liquida_imobiliaria', coalesce(sum(receita_liquida), 0),
    'quantidade_vendas', count(*),
    'evolucao_mensal', (select valor from evolucao)
  )
  from propria
  where has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

revoke execute on function public.resumo_desempenho_30d() from public, anon;
grant execute on function public.resumo_desempenho_30d() to authenticated;
