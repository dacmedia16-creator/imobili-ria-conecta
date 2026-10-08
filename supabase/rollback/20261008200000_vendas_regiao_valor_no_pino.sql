-- Rollback de 20261008200000_vendas_regiao_valor_no_pino.sql
-- Volta vendas_por_regiao_todos() ao corpo de 20261008150000 (pino com valor NULL). Mesma assinatura:
-- dono, SECURITY DEFINER e grants preservados. O front novo também funciona com este corpo (a linha
-- "Valor" do popup só aparece quando o valor vem preenchido), então o rollback do front é opcional.
-- Depois de rodar, remover a linha 20261008200000 de supabase_migrations.schema_migrations.
BEGIN;

CREATE OR REPLACE FUNCTION public.vendas_por_regiao_todos(_de date DEFAULT NULL, _ate date DEFAULT NULL)
 RETURNS TABLE (
  tipo text,
  sale_id uuid,
  data_fechamento date,
  modalidade text,
  codigo text,
  qtd integer,
  valor numeric,
  imovel_endereco text,
  imovel_bairro text,
  imovel_cidade text,
  imovel_uf text,
  geo_key text,
  geo_lat double precision,
  geo_lon double precision
 )
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF NOT public.relatorio_regiao_permitido() THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH v AS (
    SELECT c.sale_id, c.data_fechamento, c.modalidade, coalesce(c.valor_negociado, 0) AS valor,
           coalesce(nullif(c.codigo_interno, ''), c.imovel_id) AS codigo,
           s.imovel_endereco, s.imovel_bairro, s.imovel_cidade, s.imovel_uf,
           g.geo_key, g.geo_lat, g.geo_lon,
           coalesce(public.can_view_sale(auth.uid(), c.sale_id), false) AS det
    FROM public.vendas_comerciais_canonicas() c
    JOIN public.sales s ON s.id = c.sale_id AND s.organization_id = _org
    LEFT JOIN public.sale_geo g ON g.sale_id = s.id AND g.organization_id = _org
    WHERE (_de IS NULL OR c.data_fechamento >= _de)
      AND (_ate IS NULL OR c.data_fechamento <= _ate)
  )
  SELECT 'venda'::text, v.sale_id, v.data_fechamento, v.modalidade, v.codigo, 1, v.valor,
         v.imovel_endereco, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, v.geo_key, v.geo_lat, v.geo_lon
    FROM v WHERE v.det
  UNION ALL
  SELECT 'grupo'::text, NULL::uuid, NULL::date, NULL::text, NULL::text, count(*)::integer, sum(v.valor),
         NULL::text, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, NULL::text, NULL::double precision,
         NULL::double precision
    FROM v WHERE NOT v.det
    GROUP BY v.imovel_bairro, v.imovel_cidade, v.imovel_uf
  UNION ALL
  SELECT 'pino'::text, NULL::uuid, NULL::date, v.modalidade, NULL::text, 1, NULL::numeric,
         NULL::text, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, NULL::text,
         round(v.geo_lat::numeric, 3)::double precision, round(v.geo_lon::numeric, 3)::double precision
    FROM v WHERE NOT v.det AND v.geo_lat IS NOT NULL AND v.geo_lon IS NOT NULL;
END $function$;

REVOKE ALL ON FUNCTION public.vendas_por_regiao_todos(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendas_por_regiao_todos(date, date) TO authenticated, service_role;

COMMIT;
