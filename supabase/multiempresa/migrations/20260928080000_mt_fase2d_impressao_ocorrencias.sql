-- Fase 2d (somente clone/homologação até aprovação de Denis): isolamento da impressão integral
-- de ocorrências concluídas. Obrigatória junto da 1b.
--
-- Defeito: `imprimir_ocorrencias_concluidas(uuid[])` (20260924160000) é SECURITY DEFINER e só
-- exige papel gestor/team_leader ativo. Não confere agência nem liderança sobre a venda.
--  * Com dono BYPASSRLS (produção atual, ou rollback parcial da 1b): gestor da agência B imprime o
--    documento completo (partes, CPF/CNPJ, dados bancários) de vendas da agência A pelo ID.
--  * Com dono mt_1b_definer (após 1b): a RLS esconde a outra agência por acaso, mas um gestor sem
--    liderança sobre a venda, na mesma agência, continua imprimindo o documento completo.
--
-- Correção: antes de montar qualquer documento, TODAS as vendas pedidas precisam ser
--   (a) da agência do chamador (`current_org_id()`, que exige perfil e agência ativos) e
--   (b) visíveis ao chamador pela mesma regra da ocorrência (policies occ_view e
--       occurrences_co_leader_principal_read): `can_view_sale` ou leitura de co-líder.
-- Qualquer ID fora disso (inclusive inexistente) recusa o lote inteiro com 42501 e mensagem única,
-- sem revelar se a venda existe. Papel exigido, limites e contrato JSON ficam iguais.
-- Dono (mt_1b_definer) e ACL são preservados pelo CREATE OR REPLACE.
BEGIN;
CREATE TABLE public.mt_2d_function_backup (signature text PRIMARY KEY, ddl text NOT NULL, owner_name text NOT NULL);
REVOKE ALL ON public.mt_2d_function_backup FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.mt_2d_function_backup(signature, ddl, owner_name)
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text
  FROM pg_proc p WHERE p.oid = 'public.imprimir_ocorrencias_concluidas(uuid[])'::regprocedure;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_2d_function_backup) <> 1 THEN
    RAISE EXCEPTION 'Funcao de impressao ausente; abortando 2d';
  END IF;
  IF to_regprocedure('public.current_org_id()') IS NULL
    OR to_regprocedure('public.can_view_sale(uuid,uuid)') IS NULL
    OR to_regprocedure('public.can_read_principal_sale_as_co_leader(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pre-requisitos 1a/1b ausentes; abortando 2d';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.imprimir_ocorrencias_concluidas(p_sale_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  caller_org uuid := public.current_org_id();
  result jsonb;
BEGIN
  IF caller_id IS NULL OR caller_org IS NULL
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

  -- Falha fechada: uma venda fora da agência ou da visibilidade do chamador recusa o lote inteiro.
  IF EXISTS (
    SELECT 1 FROM unnest(p_sale_ids) AS ids(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = ids.id
        AND s.organization_id = caller_org
        AND (public.can_view_sale(caller_id, s.id)
          OR public.can_read_principal_sale_as_co_leader(s.id))
    )
  ) THEN
    RAISE EXCEPTION 'Acesso não autorizado à impressão de ocorrências concluídas' USING ERRCODE = '42501';
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
      ) ORDER BY p.papel, p.id) FROM public.sale_parties p
        WHERE p.sale_id = s.id AND p.organization_id = caller_org), '[]'::jsonb),
      'commissions', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', c.id, 'occurrence_id', c.occurrence_id, 'papel', c.papel,
        'nome', c.nome, 'percentual', c.percentual, 'valor', c.valor,
        'managed_by_sale', c.managed_by_sale, 'sale_commission_extra_id', c.sale_commission_extra_id
      ) ORDER BY c.created_at, c.id) FROM public.occurrence_commissions c
        WHERE c.occurrence_id = o.id AND c.organization_id = caller_org), '[]'::jsonb),
      'partners', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'occurrence_id', p.occurrence_id, 'tipo', p.tipo, 'nome', p.nome,
        'cpf_cnpj', p.cpf_cnpj, 'percentual', p.percentual, 'valor', p.valor,
        'banco', p.banco, 'agencia', p.agencia, 'conta', p.conta
      ) ORDER BY p.created_at, p.id) FROM public.occurrence_partners p
        WHERE p.occurrence_id = o.id AND p.organization_id = caller_org), '[]'::jsonb),
      'distribuicao', public.calcular_distribuicao_venda(s.id)
    ) AS document
    FROM selecionadas sel
    JOIN public.sales s ON s.id = sel.sale_id AND s.organization_id = caller_org
    JOIN public.occurrences o ON o.sale_id = s.id AND o.status = 'concluida'
      AND o.organization_id = caller_org
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(document ORDER BY ord), '[]'::jsonb)
  INTO result FROM documentos;

  IF pg_catalog.jsonb_array_length(result) <> cardinality(p_sale_ids) THEN
    RAISE EXCEPTION 'Uma ou mais ocorrências selecionadas não estão concluídas' USING ERRCODE = '22023';
  END IF;
  RETURN result;
END;
$function$;

-- CREATE OR REPLACE preserva dono e ACL; conferir para falhar fechado se algo divergir.
DO $$ BEGIN
  IF (SELECT proowner::regrole::text FROM pg_proc
       WHERE oid = 'public.imprimir_ocorrencias_concluidas(uuid[])'::regprocedure)
     <> (SELECT owner_name FROM public.mt_2d_function_backup) THEN
    RAISE EXCEPTION 'Dono da funcao de impressao mudou; abortando 2d';
  END IF;
  IF has_function_privilege('anon', 'public.imprimir_ocorrencias_concluidas(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon nao pode executar a impressao; abortando 2d';
  END IF;
END $$;
COMMIT;
