-- Alinha o resumo do Desempenho com o ranking e com o painel administrativo:
-- a venda pertence ao período desde o primeiro evento que confirma a assinatura.
-- Para Lançamento, que não passa por contrato_assinado, a confirmação continua sendo
-- a primeira entrada direta no financeiro.

create or replace function public.resumo_desempenho_periodo(_de date, _ate date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with assinadas as (
    select distinct on (h.sale_id)
      h.sale_id,
      h.created_at as assinada_em
    from sale_status_history h
    where h.para::text in (
      'contrato_assinado',
      'ocorrencia_pendente',
      'ocorrencia_analise_financeiro',
      'ocorrencia_devolvida_gestor',
      'ocorrencia_concluida'
    )
    order by h.sale_id, h.created_at asc
  ), base as (
    select
      s.id,
      greatest(coalesce(s.valor_negociado, 0), 0) as vgv,
      greatest(coalesce((d.valor->>'comissao_bruta')::numeric, 0), 0) as comissao_bruta,
      greatest(coalesce((d.valor->>'parceria_externa')::numeric, 0), 0) as parceria_externa,
      greatest(coalesce((d.valor->>'saldo_inicial_imobiliaria')::numeric, 0), 0) as parte_unidade,
      greatest(coalesce((d.valor->>'saldo_liquido_imobiliaria')::numeric, 0), 0) as receita_liquida
    from assinadas a
    join sales s on s.id = a.sale_id
    cross join lateral (select public.calcular_distribuicao_venda(s.id) as valor) d
    where a.assinada_em >= _de::timestamptz
      and a.assinada_em < (_ate + 1)::timestamptz
      and s.status::text not in ('cancelada', 'arquivada')
  ), propria as (
    select *,
      greatest(comissao_bruta - parceria_externa, 0) as comissao_propria,
      case when comissao_bruta > 0 then
        vgv * least(greatest(comissao_bruta - parceria_externa, 0) / comissao_bruta, 1)
      else 0 end as vgv_proprio
    from base
  )
  select jsonb_build_object(
    'vgv_proprio', coalesce(sum(vgv_proprio), 0),
    'comissao_propria', coalesce(sum(comissao_propria), 0),
    'parte_unidade', coalesce(sum(parte_unidade), 0),
    'receita_liquida_imobiliaria', coalesce(sum(receita_liquida), 0),
    'quantidade_vendas', count(*)
  )
  from propria
  where _de <= _ate
    and has_any_role(
      auth.uid(),
      array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]
    );
$$;

revoke execute on function public.resumo_desempenho_periodo(date, date) from public, anon;
grant execute on function public.resumo_desempenho_periodo(date, date) to authenticated;

