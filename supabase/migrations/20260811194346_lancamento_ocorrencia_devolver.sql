-- Ocorrência de Lançamento hoje é uma via de mão única: cria automática no envio
-- (criar_ocorrencia_lancamento) e a tela (LancamentoDetail) só mostra "já foi enviado, não pode
-- editar por aqui" pra qualquer status depois de rascunho — financeiro não tem como devolver pro
-- corretor/coordenador corrigir, nem reabrir depois de concluída (as vendas normais têm as duas
-- ações). Como Lançamento não passa por gestor, "devolver" aqui volta pro dono da venda (corretor/
-- coordenador que enviou), não pro gestor — decisão do usuário.

-- 1) Transições novas na trigger, todas restritas a modalidade = 'lancamento' pra não interferir
-- nas regras já existentes do fluxo padrão (que usam ocorrencia_devolvida_gestor/ocorrencia_pendente
-- como alvo, não devolvida_ajuste).
CREATE OR REPLACE FUNCTION public.validate_sale_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  is_owner boolean := (OLD.corretor_id = auth.uid());
  allowed boolean := false;
  from_status text := OLD.status::text;
  to_status text := NEW.status::text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF public.has_any_role(actor, ARRAY['admin','super_admin']::app_role[]) THEN
    RETURN NEW;
  END IF;

  IF is_owner AND (from_status, to_status) IN (
    ('rascunho', 'enviada_revisao'),
    ('devolvida_ajuste', 'enviada_revisao'),
    ('contrato_conferencia_corretor', 'contrato_ok_corretor'),
    ('contrato_conferencia_corretor', 'contrato_conferencia_gestor')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND is_owner AND public.has_any_role(actor, ARRAY['gestor','team_leader']::app_role[]) AND (from_status, to_status) IN (
    ('rascunho', 'aprovada_gestor'),
    ('devolvida_ajuste', 'aprovada_gestor')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND is_owner AND public.has_role(actor, 'lancamento'::app_role) AND (from_status, to_status) IN (
    ('rascunho', 'ocorrencia_analise_financeiro'),
    ('devolvida_ajuste', 'ocorrencia_analise_financeiro')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_any_role(actor, ARRAY['gestor','team_leader']::app_role[]) AND (from_status, to_status) IN (
    ('enviada_revisao', 'aprovada_gestor'),
    ('enviada_revisao', 'devolvida_ajuste'),
    ('contrato_conferencia_gestor', 'contrato_conferencia_corretor'),
    ('contrato_conferencia_gestor', 'aguardando_assinatura'),
    ('contrato_conferencia_gestor', 'em_elaboracao_contrato'),
    ('contrato_ok_corretor', 'aguardando_assinatura'),
    ('contrato_ok_corretor', 'contrato_conferencia_corretor'),
    ('aguardando_assinatura', 'contrato_assinado'),
    ('contrato_assinado', 'ocorrencia_pendente'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_role(actor, 'juridico') AND (from_status, to_status) IN (
    ('aprovada_gestor', 'em_elaboracao_contrato'),
    ('aprovada_gestor', 'enviada_revisao'),
    ('aprovada_gestor', 'devolvida_ajuste'),
    ('em_elaboracao_contrato', 'contrato_conferencia_gestor'),
    ('em_elaboracao_contrato', 'enviada_revisao'),
    ('em_elaboracao_contrato', 'devolvida_ajuste')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_role(actor, 'financeiro') AND (from_status, to_status) IN (
    ('ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor'),
    ('ocorrencia_analise_financeiro', 'ocorrencia_concluida'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida'),
    ('ocorrencia_concluida', 'ocorrencia_pendente')
  ) THEN
    allowed := true;
  END IF;

  -- Devolver/reabrir de Lançamento: mesmos papéis (financeiro) e mesma trava de "é venda de
  -- Lançamento mesmo" (NEW.modalidade, não muda entre OLD/NEW) — alvo é devolvida_ajuste (volta pro
  -- dono da venda) e ocorrencia_analise_financeiro (reabrir), nunca ocorrencia_devolvida_gestor/
  -- ocorrencia_pendente (que pressupõem a etapa de gestor que Lançamento não tem).
  IF NOT allowed AND public.has_role(actor, 'financeiro') AND NEW.modalidade = 'lancamento' AND (from_status, to_status) IN (
    ('ocorrencia_analise_financeiro', 'devolvida_ajuste'),
    ('ocorrencia_concluida', 'ocorrencia_analise_financeiro')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Transição de status não permitida para este usuário: % -> %', from_status, to_status
      USING ERRCODE = '42501';
  END IF;

  IF from_status = 'aguardando_assinatura' AND to_status = 'contrato_assinado' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sale_documents d
      WHERE d.sale_id = OLD.id AND d.tipo = 'contrato_assinado'
    ) THEN
      RAISE EXCEPTION 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Corretor/coordenador de lançamento também pode editar a divisão de comissão quando a venda
-- volta devolvida (antes só liberava em rascunho).
CREATE OR REPLACE FUNCTION public.can_edit_sale_comissao(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_active_user(_user) AND (
      public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (
        public.has_any_role(_user, ARRAY['gestor','team_leader']::public.app_role[])
        AND NOT public.is_sale_locked(_sale_id)
        AND EXISTS (
          SELECT 1 FROM public.sales s
          WHERE s.id = _sale_id
          AND s.status::text = ANY(ARRAY[
            'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
            'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor'
          ])
        )
      )
      OR (
        public.has_role(_user, 'lancamento'::public.app_role)
        AND EXISTS (
          SELECT 1 FROM public.sales s
          WHERE s.id = _sale_id
          AND s.corretor_id = _user
          AND s.modalidade = 'lancamento'
          AND s.status::text = ANY(ARRAY['rascunho','devolvida_ajuste'])
        )
      )
    );
$function$;

-- 3) criar_ocorrencia_lancamento passa a servir tanto o envio inicial (rascunho, cria a Ocorrência)
-- quanto o reenvio depois de devolvida (devolvida_ajuste, atualiza a Ocorrência e ressincroniza as
-- linhas de comissão a partir de sale_commission_extras — única fonte pro Lançamento, mesmo padrão
-- do envio original, nunca usa sync_occurrence_commissions/calcular_distribuicao_venda, que são do
-- motor captador/vendedor e não se aplicam aqui).
CREATE OR REPLACE FUNCTION public.criar_ocorrencia_lancamento(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale sales%rowtype;
  v_comprador_nome text;
  v_extras_count integer;
  v_occ_id uuid;
  v_is_resend boolean;
BEGIN
  IF NOT public.can_view_sale(auth.uid(), p_sale_id) THEN
    RAISE EXCEPTION 'Sem permissão para acessar esta venda.';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_sale.modalidade <> 'lancamento' THEN
    RAISE EXCEPTION 'Esta venda não é uma venda de Lançamento.' USING ERRCODE = '23514';
  END IF;

  v_is_resend := v_sale.status::text = 'devolvida_ajuste';
  IF v_sale.status::text <> 'rascunho' AND NOT v_is_resend THEN
    RAISE EXCEPTION 'Esta venda já foi enviada ao financeiro.' USING ERRCODE = '23505';
  END IF;

  IF v_sale.valor_negociado IS NULL OR v_sale.valor_negociado <= 0 THEN
    RAISE EXCEPTION 'Informe o valor negociado antes de enviar ao financeiro.' USING ERRCODE = '23514';
  END IF;

  IF v_sale.valor_total_comissao IS NULL OR v_sale.valor_total_comissao <= 0 THEN
    RAISE EXCEPTION 'Informe o valor total da comissão antes de enviar ao financeiro.' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_extras_count FROM sale_commission_extras WHERE sale_id = p_sale_id;
  IF v_extras_count = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos uma linha na divisão da comissão antes de enviar ao financeiro.' USING ERRCODE = '23514';
  END IF;

  SELECT nome INTO v_comprador_nome FROM sale_parties WHERE sale_id = p_sale_id AND papel = 'comprador_1';

  IF v_is_resend THEN
    SELECT id INTO v_occ_id FROM occurrences WHERE sale_id = p_sale_id;
    IF v_occ_id IS NULL THEN
      RAISE EXCEPTION 'Ocorrência desta venda não encontrada.' USING ERRCODE = 'P0002';
    END IF;

    UPDATE occurrences SET
      codigo_imovel = coalesce(v_sale.imovel_id, v_sale.codigo_interno),
      data_assinatura = v_sale.data_assinatura,
      tempo_venda_dias = v_sale.tempo_venda_dias,
      midia = v_sale.midia,
      valor_anunciado = v_sale.valor_anunciado,
      valor_negociado = v_sale.valor_negociado,
      percentual_comissao = v_sale.percentual_comissao,
      valor_comissao = v_sale.valor_total_comissao,
      premio_valor = v_sale.premio_valor,
      nota_fiscal_obrigatoria = v_sale.nota_fiscal_obrigatoria,
      prev_recebimento_valor = v_sale.previsao_recebimento_valor,
      prev_recebimento_data = v_sale.previsao_recebimento_data,
      prev_recebimento_forma = v_sale.previsao_recebimento_forma,
      prev_recebimento2_valor = v_sale.previsao_recebimento2_valor,
      prev_recebimento2_data = v_sale.previsao_recebimento2_data,
      prev_recebimento2_forma = v_sale.previsao_recebimento2_forma,
      prev_recebimento3_valor = v_sale.previsao_recebimento3_valor,
      prev_recebimento3_data = v_sale.previsao_recebimento3_data,
      prev_recebimento3_forma = v_sale.previsao_recebimento3_forma,
      observacoes = coalesce(
        v_sale.negociacao_observacoes,
        nullif(concat_ws(' | ', case when v_comprador_nome is not null then 'Comprador: ' || v_comprador_nome end), '')
      )
    WHERE id = v_occ_id;

    -- Ressincroniza as linhas de comissão vindas de sale_commission_extras (mesma fonte do envio
    -- original) — apaga só as linhas ligadas a um extra (sale_commission_extra_id preenchido) e
    -- recria, preservando qualquer linha manual que o financeiro tenha adicionado direto na
    -- Ocorrência (sale_commission_extra_id nulo, fora do escopo do formulário de Lançamento).
    DELETE FROM occurrence_commissions WHERE occurrence_id = v_occ_id AND sale_commission_extra_id IS NOT NULL;
    INSERT INTO occurrence_commissions (occurrence_id, papel, nome, user_id, percentual, valor, sale_commission_extra_id, managed_by_sale)
    SELECT v_occ_id, e.papel, e.nome, e.user_id, e.percentual, e.valor, e.id, true
    FROM sale_commission_extras e
    WHERE e.sale_id = p_sale_id;
  ELSE
    IF EXISTS (SELECT 1 FROM occurrences WHERE sale_id = p_sale_id) THEN
      RAISE EXCEPTION 'Esta venda já tem uma Ocorrência criada.' USING ERRCODE = '23505';
    END IF;

    INSERT INTO occurrences (
      sale_id, codigo_imovel, data_assinatura, tempo_venda_dias, midia,
      valor_anunciado, valor_negociado, percentual_comissao, valor_comissao, premio_valor,
      nota_fiscal_obrigatoria,
      prev_recebimento_valor, prev_recebimento_data, prev_recebimento_forma,
      prev_recebimento2_valor, prev_recebimento2_data, prev_recebimento2_forma,
      prev_recebimento3_valor, prev_recebimento3_data, prev_recebimento3_forma,
      observacoes, status
    ) VALUES (
      p_sale_id, coalesce(v_sale.imovel_id, v_sale.codigo_interno), v_sale.data_assinatura, v_sale.tempo_venda_dias, v_sale.midia,
      v_sale.valor_anunciado, v_sale.valor_negociado, v_sale.percentual_comissao, v_sale.valor_total_comissao, v_sale.premio_valor,
      v_sale.nota_fiscal_obrigatoria,
      v_sale.previsao_recebimento_valor, v_sale.previsao_recebimento_data, v_sale.previsao_recebimento_forma,
      v_sale.previsao_recebimento2_valor, v_sale.previsao_recebimento2_data, v_sale.previsao_recebimento2_forma,
      v_sale.previsao_recebimento3_valor, v_sale.previsao_recebimento3_data, v_sale.previsao_recebimento3_forma,
      coalesce(
        v_sale.negociacao_observacoes,
        nullif(concat_ws(' | ', case when v_comprador_nome is not null then 'Comprador: ' || v_comprador_nome end), '')
      ),
      'pendente'
    )
    RETURNING id INTO v_occ_id;

    INSERT INTO occurrence_commissions (occurrence_id, papel, nome, user_id, percentual, valor, sale_commission_extra_id, managed_by_sale)
    SELECT v_occ_id, e.papel, e.nome, e.user_id, e.percentual, e.valor, e.id, true
    FROM sale_commission_extras e
    WHERE e.sale_id = p_sale_id;
  END IF;

  UPDATE sales SET status = 'ocorrencia_analise_financeiro' WHERE id = p_sale_id;

  INSERT INTO sale_status_history (sale_id, de, para, autor_id, motivo)
  VALUES (p_sale_id, v_sale.status, 'ocorrencia_analise_financeiro'::sale_status, auth.uid(),
    CASE WHEN v_is_resend THEN 'Reenvio ao financeiro após ajuste (Lançamento)' ELSE 'Envio direto ao financeiro (Lançamento)' END);

  INSERT INTO activity_logs (autor_id, sale_id, acao, payload)
  VALUES (auth.uid(), p_sale_id, 'status_change', jsonb_build_object('de', v_sale.status, 'para', 'ocorrencia_analise_financeiro', 'motivo',
    CASE WHEN v_is_resend THEN 'Reenvio ao financeiro após ajuste (Lançamento)' ELSE 'Envio direto ao financeiro (Lançamento)' END));

  IF NOT v_is_resend THEN
    INSERT INTO activity_logs (autor_id, sale_id, acao, payload)
    VALUES (auth.uid(), p_sale_id, 'occurrence_created', jsonb_build_object('occurrence_id', v_occ_id, 'modalidade', 'lancamento'));
  END IF;

  RETURN jsonb_build_object('occurrence_id', v_occ_id);
END;
$function$;
