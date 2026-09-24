-- Documento completo da ocorrência listada no relatório global. Não altera RLS nem ACL de tabelas.
-- Rollback: DROP FUNCTION public.imprimir_ocorrencias_concluidas(uuid[]);
BEGIN;
CREATE FUNCTION public.imprimir_ocorrencias_concluidas(p_sale_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  result jsonb;
BEGIN
  IF caller_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = caller_id AND p.ativo IS TRUE)
    OR NOT EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = caller_id
        AND ur.role = ANY (ARRAY['gestor', 'team_leader']::public.app_role[])
    ) THEN
    RAISE EXCEPTION 'Acesso não autorizado à impressão de ocorrências concluídas' USING ERRCODE = '42501';
  END IF;
  IF p_sale_ids IS NULL OR cardinality(p_sale_ids) < 1 OR cardinality(p_sale_ids) > 50
    OR array_position(p_sale_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Selecione entre 1 e 50 ocorrências' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT id) FROM unnest(p_sale_ids) AS ids(id)) <> cardinality(p_sale_ids) THEN
    RAISE EXCEPTION 'Seleção contém ocorrências repetidas' USING ERRCODE = '22023';
  END IF;

  -- Só vendas com ocorrência concluída; dados relacionados não atravessam outras vendas.
  WITH selecionadas AS (
    SELECT ids.id AS sale_id, ids.ord
    FROM unnest(p_sale_ids) WITH ORDINALITY AS ids(id, ord)
  ), documentos AS (
    SELECT sel.ord, pg_catalog.jsonb_build_object(
      'sale', pg_catalog.jsonb_build_object(
        'id', s.id, 'modalidade', s.modalidade, 'imovel_id', s.imovel_id,
        'codigo_interno', s.codigo_interno, 'valor_anunciado', s.valor_anunciado,
        'valor_negociado', s.valor_negociado, 'percentual_comissao', s.percentual_comissao,
        'valor_total_comissao', s.valor_total_comissao, 'percentual_remax', s.percentual_remax,
        'valor_remax', s.valor_remax),
      'occ', pg_catalog.jsonb_build_object(
        'id', o.id, 'sale_id', o.sale_id, 'status', o.status,
        'tempo_venda_dias', o.tempo_venda_dias, 'data_assinatura', o.data_assinatura,
        'nota_fiscal_obrigatoria', o.nota_fiscal_obrigatoria, 'midia', o.midia,
        'valor_anunciado', o.valor_anunciado, 'valor_negociado', o.valor_negociado,
        'percentual_comissao', o.percentual_comissao, 'valor_comissao', o.valor_comissao,
        'premio_valor', o.premio_valor, 'financiamento', o.financiamento,
        'financiamento_valor', o.financiamento_valor, 'financiamento_banco', o.financiamento_banco,
        'financiamento_correspondente', o.financiamento_correspondente,
        'financiamento_previsao', o.financiamento_previsao, 'oba_credito', o.oba_credito,
        'prev_recebimento_valor', o.prev_recebimento_valor,
        'prev_recebimento_data', o.prev_recebimento_data,
        'prev_recebimento_forma', o.prev_recebimento_forma,
        'prev_recebimento2_valor', o.prev_recebimento2_valor,
        'prev_recebimento2_data', o.prev_recebimento2_data,
        'prev_recebimento2_forma', o.prev_recebimento2_forma,
        'prev_recebimento3_valor', o.prev_recebimento3_valor,
        'prev_recebimento3_data', o.prev_recebimento3_data,
        'prev_recebimento3_forma', o.prev_recebimento3_forma,
        'observacoes', o.observacoes),
      'parties', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'sale_id', p.sale_id, 'papel', p.papel, 'nome', p.nome,
        'razao_social', p.razao_social, 'cpf_cnpj', p.cpf_cnpj, 'cnpj', p.cnpj,
        'email', p.email, 'rg', p.rg, 'telefone', p.telefone, 'endereco', p.endereco
      ) ORDER BY p.papel, p.id) FROM public.sale_parties p WHERE p.sale_id = s.id), '[]'::jsonb),
      'commissions', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', c.id, 'occurrence_id', c.occurrence_id, 'papel', c.papel,
        'nome', c.nome, 'percentual', c.percentual, 'valor', c.valor,
        'managed_by_sale', c.managed_by_sale, 'sale_commission_extra_id', c.sale_commission_extra_id
      ) ORDER BY c.created_at, c.id) FROM public.occurrence_commissions c
        WHERE c.occurrence_id = o.id), '[]'::jsonb),
      'partners', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'occurrence_id', p.occurrence_id, 'tipo', p.tipo, 'nome', p.nome,
        'cpf_cnpj', p.cpf_cnpj, 'percentual', p.percentual, 'valor', p.valor,
        'banco', p.banco, 'agencia', p.agencia, 'conta', p.conta
      ) ORDER BY p.created_at, p.id) FROM public.occurrence_partners p
        WHERE p.occurrence_id = o.id), '[]'::jsonb),
      'distribuicao', public.calcular_distribuicao_venda(s.id)
    ) AS document
    FROM selecionadas sel
    JOIN public.sales s ON s.id = sel.sale_id
    JOIN public.occurrences o ON o.sale_id = s.id AND o.status = 'concluida'
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(document ORDER BY ord), '[]'::jsonb)
  INTO result FROM documentos;

  IF pg_catalog.jsonb_array_length(result) <> cardinality(p_sale_ids) THEN
    RAISE EXCEPTION 'Uma ou mais ocorrências selecionadas não estão concluídas' USING ERRCODE = '22023';
  END IF;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.imprimir_ocorrencias_concluidas(uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.imprimir_ocorrencias_concluidas(uuid[]) TO authenticated;
COMMIT;
