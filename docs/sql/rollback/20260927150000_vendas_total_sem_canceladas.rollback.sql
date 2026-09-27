-- Rollback do grupo 4a: definições implantadas antes (pg_get_functiondef em 27/09/2026).

-- args: _page integer, _page_size integer, _status text, _statuses text[], _desde date, _ate date, _q text, _corretor_ids uuid[]
CREATE OR REPLACE FUNCTION public.list_vendas_comerciais_paginadas(_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, _statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- args: _page integer, _page_size integer, _status text, _statuses text[], _desde date, _ate date, _q text, _corretor_ids uuid[]
CREATE OR REPLACE FUNCTION public.list_vendas_comerciais_paginadas_fila(_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, _statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH assinaturas AS (
    SELECT o.sale_id, max(o.data_assinatura) AS data_assinatura
    FROM public.occurrences o
    GROUP BY o.sale_id
  ), base AS (
    SELECT
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
      CASE
        WHEN s.modalidade::text = 'lancamento' THEN
          coalesce(s.data_assinatura, (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        ELSE coalesce(a.data_assinatura, s.data_assinatura, (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
      END AS data_venda
    FROM public.sales s
    LEFT JOIN assinaturas a ON a.sale_id = s.id
    WHERE (_status IS NULL OR s.status::text = _status)
      AND (_statuses IS NULL OR s.status::text = ANY(_statuses))
      AND (_corretor_ids IS NULL OR s.corretor_id = ANY(_corretor_ids))
  ), filtradas AS (
    SELECT b.*
    FROM base b
    WHERE b.data_venda IS NOT NULL
      AND (_desde IS NULL OR b.data_venda >= _desde)
      AND (_ate IS NULL OR b.data_venda <= _ate)
      AND (
        nullif(trim(_q), '') IS NULL
        OR b.imovel_id ILIKE '%' || trim(_q) || '%'
        OR b.codigo_interno ILIKE '%' || trim(_q) || '%'
        OR b.corretor_captador ILIKE '%' || trim(_q) || '%'
        OR b.corretor_vendedor ILIKE '%' || trim(_q) || '%'
        OR EXISTS (
          SELECT 1
          FROM public.sale_parties sp
          WHERE sp.sale_id = b.id
            AND sp.nome ILIKE '%' || trim(_q) || '%'
        )
      )
      AND (
        (
          b.status::text IN ('rascunho', 'devolvida_ajuste', 'contrato_conferencia_corretor')
          AND b.corretor_id = auth.uid()
        )
        OR (
          b.status::text IN (
            'enviada_revisao', 'contrato_conferencia_gestor', 'contrato_ok_corretor',
            'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
            'ocorrencia_devolvida_gestor'
          )
          AND has_any_role(auth.uid(), ARRAY['gestor', 'team_leader']::app_role[])
          AND (is_lead_of(auth.uid(), b.corretor_id) OR b.corretor_id = auth.uid())
        )
        OR (
          b.status::text IN ('aprovada_gestor', 'enviada_juridico', 'em_elaboracao_contrato')
          AND has_role(auth.uid(), 'juridico'::app_role)
        )
        OR (
          b.status::text = 'ocorrencia_analise_financeiro'
          AND has_role(auth.uid(), 'financeiro'::app_role)
        )
      )
  ), pagina AS (
    SELECT *
    FROM filtradas
    ORDER BY data_venda DESC, id
    LIMIT least(greatest(coalesce(_page_size, 10), 1), 50)
    OFFSET greatest(coalesce(_page, 0), 0) * least(greatest(coalesce(_page_size, 10), 1), 50)
  ), totais AS (
    SELECT count(*)::integer AS total_count, coalesce(sum(coalesce(valor_negociado, 0)), 0) AS total_valor
    FROM filtradas
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.data_venda DESC, p.id) FROM pagina p), '[]'::jsonb),
    'total_count', totais.total_count,
    'total_valor', totais.total_valor
  )
  FROM totais;
$function$
;
