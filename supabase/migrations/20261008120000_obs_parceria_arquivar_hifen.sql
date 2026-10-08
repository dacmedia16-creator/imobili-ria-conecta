-- 20261008120000_obs_parceria_arquivar_hifen
-- Reunião de gestores/team leads/adm 08/10/2026 (decisões confirmadas por Denis, tópico 6238).
-- 1. sales.parceria_observacoes: texto livre opcional no fim do bloco de parceria. Lido pela mesma RLS
--    da venda (can_view_sale), gravado pelo mesmo UPDATE do Resumo; não entra em nenhum cálculo.
--    Exposto também no RPC de impressão de ocorrências concluídas.
-- 2. validate_sale_status_transition: só o bloco 'arquivada' muda (texto vigente lido da produção,
--    idêntico ao de 20260929100000_atribuicao_participantes.sql). Cancelar continua só do dono da plataforma.
-- 3. sales.codigo_interno ("Código interno"): 9 dígitos + hífen + 1 a 3 dígitos. Os registros fora do
--    padrão foram corrigidos antes (docs/sql/dados/20261008_codigo_interno_hifen.sql); a CHECK é
--    criada NOT VALID e validada em seguida (falha fechada se aparecer algum fora do padrão).
-- Rollback: docs/sql/rollback/20261008120000_obs_parceria_arquivar_hifen.rollback.sql

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS parceria_observacoes text;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_parceria_observacoes_tamanho;
ALTER TABLE public.sales ADD CONSTRAINT sales_parceria_observacoes_tamanho
  CHECK (parceria_observacoes IS NULL OR char_length(parceria_observacoes) <= 2000);
COMMENT ON COLUMN public.sales.parceria_observacoes IS
  'Observações da parceria (texto livre, opcional). Informativo: não altera comissão.';

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_codigo_interno_formato;
ALTER TABLE public.sales ADD CONSTRAINT sales_codigo_interno_formato
  CHECK (codigo_interno IS NULL OR codigo_interno ~ '^[0-9]{9}-[0-9]{1,3}$') NOT VALID;
ALTER TABLE public.sales VALIDATE CONSTRAINT sales_codigo_interno_formato;

CREATE OR REPLACE FUNCTION public.validate_sale_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := auth.uid();
  is_owner boolean := public.is_sale_responsavel(auth.uid(), old.id);
  allowed boolean := false;
  from_status text := old.status::text;
  to_status text := new.status::text;
begin
  if new.status is not distinct from old.status then return new; end if;

  -- Fase 2f: cancelar venda = só o dono da plataforma, via platform_cancel_sale, depois do rascunho.
  if to_status = 'cancelada' then
    if from_status = 'rascunho' then
      raise exception 'Venda em rascunho não é cancelada: use Excluir venda.' using errcode = '42501';
    end if;
    if actor is not null
       and public.is_platform_super_admin(actor)
       and current_setting('mt.platform_cancel_sale', true) = old.id::text then
      return new;
    end if;
    raise exception 'Somente o dono da plataforma cancela venda.' using errcode = '42501';
  end if;

  if public.has_any_role(actor, array['admin','super_admin']::app_role[]) then return new; end if;

  -- Reunião de gestores 08/10/2026: arquivar é liberado a quem já vê/opera a venda (mesmo gate de
  -- change_sale_status), inclusive o corretor, em qualquer etapa ANTES da assinatura do contrato.
  -- Do contrato assinado em diante ninguém arquiva (admin/super_admin já retornaram acima).
  if to_status = 'arquivada' then
    if from_status in (
         'rascunho', 'enviada_revisao', 'devolvida_ajuste', 'aprovada_gestor', 'enviada_juridico',
         'em_elaboracao_contrato', 'contrato_conferencia_gestor', 'contrato_conferencia_corretor',
         'contrato_ok_corretor', 'aguardando_assinatura'
       )
       and actor is not null
       and (public.can_view_sale(actor, old.id) or public.can_edit_sale_as_co_leader(old.id)) then
      return new;
    end if;
    raise exception 'Arquivar só é permitido antes da assinatura do contrato.' using errcode = '42501';
  end if;

  if is_owner and (from_status, to_status) in (
    ('rascunho', 'enviada_revisao'), ('devolvida_ajuste', 'enviada_revisao'),
    ('contrato_conferencia_corretor', 'contrato_ok_corretor'),
    ('contrato_conferencia_corretor', 'contrato_conferencia_gestor')
  ) then allowed := true; end if;

  if not allowed and is_owner and public.has_any_role(actor, array['gestor','team_leader']::app_role[]) and (from_status, to_status) in (
    ('rascunho', 'aprovada_gestor'), ('devolvida_ajuste', 'aprovada_gestor')
  ) then allowed := true; end if;

  if not allowed
     and from_status = 'rascunho'
     and to_status = 'aprovada_gestor'
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and public.is_lead_of_sale_responsavel(actor, old.id) then
    allowed := true;
  end if;

  if not allowed and is_owner and public.has_role(actor, 'lancamento'::app_role) and (from_status, to_status) in (
    ('rascunho', 'ocorrencia_analise_financeiro'),
    ('devolvida_ajuste', 'ocorrencia_analise_financeiro')
  ) then allowed := true; end if;

  if not allowed and public.has_any_role(actor, array['gestor','team_leader']::app_role[]) and (from_status, to_status) in (
    ('enviada_revisao', 'aprovada_gestor'), ('enviada_revisao', 'devolvida_ajuste'),
    ('contrato_conferencia_gestor', 'contrato_conferencia_corretor'),
    ('contrato_conferencia_gestor', 'aguardando_assinatura'),
    ('contrato_conferencia_gestor', 'em_elaboracao_contrato'),
    ('contrato_ok_corretor', 'aguardando_assinatura'),
    ('contrato_ok_corretor', 'contrato_conferencia_corretor'),
    ('contrato_ok_corretor', 'em_elaboracao_contrato'),
    ('aguardando_assinatura', 'contrato_assinado'),
    ('aguardando_assinatura', 'em_elaboracao_contrato'),
    ('contrato_assinado', 'ocorrencia_pendente'), ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'aguardando_assinatura'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida')
  ) then allowed := true; end if;

  if not allowed and public.has_role(actor, 'juridico') and (from_status, to_status) in (
    ('aprovada_gestor', 'em_elaboracao_contrato'), ('aprovada_gestor', 'enviada_revisao'),
    ('aprovada_gestor', 'devolvida_ajuste'),
    ('em_elaboracao_contrato', 'contrato_conferencia_gestor'),
    ('em_elaboracao_contrato', 'enviada_revisao'), ('em_elaboracao_contrato', 'devolvida_ajuste')
  ) then allowed := true; end if;

  if not allowed and public.has_role(actor, 'financeiro') and (from_status, to_status) in (
    ('ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor'),
    ('ocorrencia_analise_financeiro', 'ocorrencia_concluida'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida'),
    ('ocorrencia_concluida', 'ocorrencia_pendente')
  ) then allowed := true; end if;

  if not allowed and public.has_role(actor, 'financeiro') and new.modalidade = 'lancamento' and (from_status, to_status) in (
    ('ocorrencia_analise_financeiro', 'devolvida_ajuste'),
    ('ocorrencia_concluida', 'ocorrencia_analise_financeiro')
  ) then allowed := true; end if;

  if not allowed then
    raise exception 'Transição de status não permitida para este usuário: % -> %', from_status, to_status using errcode = '42501';
  end if;

  if from_status = 'aguardando_assinatura' and to_status = 'contrato_assinado'
     and not exists (select 1 from public.sale_documents d where d.sale_id = old.id and d.tipo = 'contrato_assinado') then
    raise exception 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.imprimir_ocorrencias_concluidas(p_sale_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  caller_org uuid := public.current_org_id();
  result jsonb;
BEGIN
  IF caller_id IS NULL OR caller_org IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = caller_id AND p.ativo IS TRUE)
    OR NOT public.has_any_role(caller_id, ARRAY['gestor','team_leader']::public.app_role[]) THEN
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
        'valor_remax', s.valor_remax, 'parceria_observacoes', s.parceria_observacoes),
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
