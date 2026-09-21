-- Faz os consumidores principais usarem a camada comercial canônica.
-- A camada mantém uma linha por venda e preserva os aliases usados pelo Financeiro.

DROP FUNCTION IF EXISTS public.vendas_comerciais_canonicas();

CREATE FUNCTION public.vendas_comerciais_canonicas()
RETURNS TABLE (
  sale_id uuid,
  venda_em timestamptz,
  data_fechamento date,
  modalidade text,
  status text,
  codigo_interno text,
  imovel_id text,
  corretor_id uuid,
  percentual_comissao numeric,
  valor_negociado numeric,
  valor_total_comissao numeric,
  comissao_bruta numeric,
  parceria_externa numeric,
  vgv_proprio numeric,
  comissao_propria numeric,
  occurrence_count bigint,
  occurrence_concluida_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH metricas AS (
    SELECT * FROM public.metricas_venda_sem_parceria()
  )
  SELECT
    v.sale_id,
    v.venda_em,
    v.venda_em::date AS data_fechamento,
    s.modalidade::text,
    s.status::text,
    s.codigo_interno,
    s.imovel_id,
    s.corretor_id,
    s.percentual_comissao,
    m.vgv AS valor_negociado,
    m.comissao_bruta AS valor_total_comissao,
    m.comissao_bruta,
    m.parceria_externa,
    CASE
      WHEN m.comissao_bruta > 0 THEN
        m.vgv * least(greatest(m.comissao_bruta - m.parceria_externa, 0) / m.comissao_bruta, 1)
      ELSE 0
    END AS vgv_proprio,
    greatest(m.comissao_bruta - m.parceria_externa, 0) AS comissao_propria,
    coalesce(o.occurrence_count, 0),
    coalesce(o.occurrence_concluida_count, 0)
  FROM public.vendas_comerciais_validas() v
  JOIN public.sales s ON s.id = v.sale_id
  JOIN metricas m ON m.sale_id = v.sale_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS occurrence_count,
      count(*) FILTER (WHERE oc.status = 'concluida') AS occurrence_concluida_count
    FROM public.occurrences oc
    WHERE oc.sale_id = s.id
  ) o ON true
  WHERE s.status::text NOT IN ('cancelada', 'arquivada')
    AND s.valor_negociado > 0
    AND s.valor_total_comissao > 0;
$function$;

REVOKE EXECUTE ON FUNCTION public.vendas_comerciais_canonicas() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vendas_comerciais_canonicas() TO authenticated;

-- Reescreve apenas consumidores já existentes, trocando a fonte de vendas pela
-- função canônica. A guarda evita duplicar a alteração em uma reaplicação.
DO $migrate$
DECLARE
  v_name text;
  v_args text;
  v_definition text;
  v_updated text;
BEGIN
  FOR v_name, v_args IN
    SELECT * FROM (VALUES
      ('participacoes_comerciais_validas', ''),
      ('resumo_desempenho_periodo', '_de date, _ate date'),
      ('desempenho_ranking_periodo', '_de date, _ate date'),
      ('producao_por_pessoa_dados', '')
    ) AS expected(name, args)
  LOOP
    SELECT pg_get_functiondef(p.oid)
      INTO v_definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = v_name
      AND pg_get_function_identity_arguments(p.oid) = v_args;

    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'Função esperada não encontrada: public.%(%)', v_name, v_args;
    END IF;

    v_updated := replace(
      v_definition,
      'from public.vendas_comerciais_validas() v',
      'from public.vendas_comerciais_canonicas() v'
    );

    IF v_updated <> v_definition THEN
      EXECUTE v_updated;
    END IF;
  END LOOP;
END
$migrate$;
