-- Entrada do preenchimento das vendas antigas (somente leitura). Uma linha JSON com todas as vendas
-- não arquivadas/canceladas e as leituras JÁ gravadas da matrícula e do IPTU (sem reler nada).
-- Só campos de área/tipo/descrição: nenhum dado de proprietário ou comprador sai daqui.
SELECT coalesce(jsonb_agg(v ORDER BY v->>'codigo'), '[]'::jsonb) AS vendas FROM (
  SELECT jsonb_build_object(
    'id', s.id,
    'codigo', coalesce(nullif(btrim(s.codigo_interno), ''), nullif(btrim(s.imovel_id), ''), upper(left(s.id::text, 8))),
    'corretor', nullif(btrim(p.nome), ''),
    'tipo_imovel', NULL, 'area_util_m2', NULL, 'area_construida_m2', NULL, 'area_terreno_m2', NULL,
    'extracoes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('tipo', d.tipo, 'raw', jsonb_build_object(
          'area_total', e.raw_json->>'area_total',
          'area_construida', e.raw_json->>'area_construida',
          'area_privativa', e.raw_json->>'area_privativa',
          'observacoes_imovel', CASE WHEN d.tipo = 'matricula' THEN e.raw_json->>'observacoes_imovel' END))
        ORDER BY e.created_at DESC)
      FROM public.document_extractions e
      JOIN public.sale_documents d ON d.id = e.document_id
      WHERE d.sale_id = s.id AND d.tipo IN ('matricula', 'iptu') AND d.deleted_at IS NULL
        AND e.status = 'done' AND e.raw_json IS NOT NULL), '[]'::jsonb)) AS v
  FROM public.sales s
  LEFT JOIN public.profiles p ON p.id = s.corretor_id
  WHERE s.status NOT IN ('arquivada', 'cancelada')
) x;
