-- Últimas dependências auxiliares da regra antiga.

create or replace function public.financeiro_distribuicao_vendas()
returns table (
  sale_id uuid,
  saldo_inicial_imobiliaria numeric,
  saldo_liquido_imobiliaria numeric
)
language sql stable security invoker set search_path = public
as $$
  select s.id,
    coalesce((d.resultado->>'saldo_inicial_imobiliaria')::numeric, 0),
    coalesce((d.resultado->>'saldo_liquido_imobiliaria')::numeric, 0)
  from public.vendas_comerciais_validas() v
  join public.sales s on s.id = v.sale_id
  cross join lateral (select public.calcular_distribuicao_venda(s.*) resultado) d
  where public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]);
$$;

create or replace function public.comparativo_comissao_6pct_inconsistencias()
returns table (sale_id uuid, codigo_interno text, modalidade text, motivo text)
language plpgsql stable security invoker set search_path = public
as $$
begin
  if not public.has_any_role((select auth.uid()), array['admin','super_admin','financeiro']::public.app_role[]) then
    raise exception 'Acesso não autorizado ao Comparativo de Comissão.' using errcode = '42501';
  end if;
  return query
  select s.id, s.codigo_interno, s.modalidade::text, 'valores_invalidos'::text
  from public.vendas_comerciais_validas() v
  join public.sales s on s.id = v.sale_id
  where not (s.valor_negociado is not null and s.valor_negociado > 0
    and s.valor_total_comissao is not null and s.valor_total_comissao > 0);
end;
$$;

-- Substituída por resumo_desempenho_periodo e sem consumidores no código atual.
drop function if exists public.resumo_desempenho_30d();

revoke execute on function public.financeiro_distribuicao_vendas() from public, anon;
revoke execute on function public.comparativo_comissao_6pct_inconsistencias() from public, anon;
grant execute on function public.financeiro_distribuicao_vendas() to authenticated;
grant execute on function public.comparativo_comissao_6pct_inconsistencias() to authenticated;
