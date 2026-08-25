-- Fonte auditável da receita líquida por venda para o Financeiro e o Painel do Gestor.
-- Reutiliza calcular_distribuicao_venda(sales), a mesma fórmula já usada em Desempenho;
-- não cria uma segunda regra financeira.
create or replace function public.financeiro_distribuicao_vendas()
returns table (
  sale_id uuid,
  saldo_inicial_imobiliaria numeric,
  saldo_liquido_imobiliaria numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id,
    coalesce((d.resultado->>'saldo_inicial_imobiliaria')::numeric, 0),
    coalesce((d.resultado->>'saldo_liquido_imobiliaria')::numeric, 0)
  from public.sales s
  cross join lateral (
    select public.calcular_distribuicao_venda(s.*) as resultado
  ) d
  where s.status::text not in ('cancelada', 'arquivada')
    and exists (
      select 1
      from public.sale_status_history h
      where h.sale_id = s.id
        and h.para::text = 'ocorrencia_analise_financeiro'
    )
    and public.has_any_role(
      auth.uid(),
      array['financeiro','admin','super_admin']::public.app_role[]
    );
$$;

revoke execute on function public.financeiro_distribuicao_vendas() from public, anon;
grant execute on function public.financeiro_distribuicao_vendas() to authenticated;
