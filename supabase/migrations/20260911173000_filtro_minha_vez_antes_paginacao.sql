-- Aplica "Só minha vez" antes da paginação.
-- A RPC original continua disponível para a listagem geral; esta variante usa
-- auth.uid() e a mesma matriz de próximo responsável da interface para montar
-- a fila completa antes de limitar as linhas da página.

create or replace function public.list_vendas_comerciais_paginadas_fila(
  _page integer default 0,
  _page_size integer default 10,
  _status text default null,
  _statuses text[] default null,
  _desde date default null,
  _ate date default null,
  _q text default null,
  _corretor_ids uuid[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with assinaturas as (
    select o.sale_id, max(o.data_assinatura) as data_assinatura
    from public.occurrences o
    group by o.sale_id
  ), base as (
    select
      s.id,
      s.status,
      s.valor_negociado,
      s.imovel_id,
      s.codigo_interno,
      s.corretor_captador,
      s.corretor_vendedor,
      s.updated_at,
      s.created_at,
      s.corretor_id,
      s.modalidade,
      s.data_assinatura,
      case
        when s.modalidade::text = 'lancamento' then
          coalesce(
            s.data_assinatura,
            (s.created_at at time zone 'America/Sao_Paulo')::date
          )
        else
          coalesce(
            a.data_assinatura,
            s.data_assinatura,
            (s.created_at at time zone 'America/Sao_Paulo')::date
          )
      end as data_venda
    from public.sales s
    left join assinaturas a on a.sale_id = s.id
    where (_status is null or s.status::text = _status)
      and (_statuses is null or s.status::text = any(_statuses))
      and (_corretor_ids is null or s.corretor_id = any(_corretor_ids))
  ), filtradas as (
    select b.*
    from base b
    where b.data_venda is not null
      and (_desde is null or b.data_venda >= _desde)
      and (_ate is null or b.data_venda <= _ate)
      and (
        nullif(trim(_q), '') is null
        or b.imovel_id ilike '%' || trim(_q) || '%'
        or b.codigo_interno ilike '%' || trim(_q) || '%'
        or b.corretor_captador ilike '%' || trim(_q) || '%'
        or b.corretor_vendedor ilike '%' || trim(_q) || '%'
        or exists (
          select 1
          from public.sale_parties sp
          where sp.sale_id = b.id
            and sp.nome ilike '%' || trim(_q) || '%'
        )
      )
      and (
        (
          b.status::text in ('rascunho', 'devolvida_ajuste', 'contrato_conferencia_corretor')
          and b.corretor_id = auth.uid()
        )
        or (
          b.status::text in (
            'enviada_revisao', 'contrato_conferencia_gestor', 'contrato_ok_corretor',
            'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
            'ocorrencia_devolvida_gestor'
          )
          and has_any_role(auth.uid(), array['gestor', 'team_leader']::app_role[])
          and is_lead_of(auth.uid(), b.corretor_id)
        )
        or (
          b.status::text in ('aprovada_gestor', 'enviada_juridico', 'em_elaboracao_contrato')
          and has_role(auth.uid(), 'juridico'::app_role)
        )
        or (
          b.status::text = 'ocorrencia_analise_financeiro'
          and has_role(auth.uid(), 'financeiro'::app_role)
        )
      )
  ), pagina as (
    select *
    from filtradas
    order by data_venda desc, id
    limit least(greatest(coalesce(_page_size, 10), 1), 50)
    offset greatest(coalesce(_page, 0), 0) * least(greatest(coalesce(_page_size, 10), 1), 50)
  ), totais as (
    select
      count(*)::integer as total_count,
      coalesce(sum(coalesce(valor_negociado, 0)), 0) as total_valor
    from filtradas
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.data_venda desc, p.id) from pagina p),
      '[]'::jsonb
    ),
    'total_count', totais.total_count,
    'total_valor', totais.total_valor
  )
  from totais;
$$;

revoke execute on function public.list_vendas_comerciais_paginadas_fila(integer, integer, text, text[], date, date, text, uuid[]) from public, anon;
grant execute on function public.list_vendas_comerciais_paginadas_fila(integer, integer, text, text[], date, date, text, uuid[]) to authenticated;
