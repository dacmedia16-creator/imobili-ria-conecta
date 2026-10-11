-- Recuperado de supabase_migrations.schema_migrations (versão 20260804111516) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

CREATE OR REPLACE FUNCTION public.enforce_sale_comissao_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF (
    NEW.percentual_comissao_captador IS DISTINCT FROM OLD.percentual_comissao_captador
    OR NEW.valor_comissao_captador IS DISTINCT FROM OLD.valor_comissao_captador
    OR NEW.percentual_comissao_vendedor IS DISTINCT FROM OLD.percentual_comissao_vendedor
    OR NEW.valor_comissao_vendedor IS DISTINCT FROM OLD.valor_comissao_vendedor
    OR NEW.indicador IS DISTINCT FROM OLD.indicador
    OR NEW.indicador_lado IS DISTINCT FROM OLD.indicador_lado
    OR NEW.percentual_comissao_indicador IS DISTINCT FROM OLD.percentual_comissao_indicador
    OR NEW.valor_comissao_indicador IS DISTINCT FROM OLD.valor_comissao_indicador
    OR NEW.previsao_recebimento_valor IS DISTINCT FROM OLD.previsao_recebimento_valor
    OR NEW.previsao_recebimento_data IS DISTINCT FROM OLD.previsao_recebimento_data
    OR NEW.previsao_recebimento_forma IS DISTINCT FROM OLD.previsao_recebimento_forma
    OR NEW.previsao_recebimento2_valor IS DISTINCT FROM OLD.previsao_recebimento2_valor
    OR NEW.previsao_recebimento2_data IS DISTINCT FROM OLD.previsao_recebimento2_data
    OR NEW.previsao_recebimento2_forma IS DISTINCT FROM OLD.previsao_recebimento2_forma
    OR NEW.previsao_recebimento3_valor IS DISTINCT FROM OLD.previsao_recebimento3_valor
    OR NEW.previsao_recebimento3_data IS DISTINCT FROM OLD.previsao_recebimento3_data
    OR NEW.previsao_recebimento3_forma IS DISTINCT FROM OLD.previsao_recebimento3_forma
  ) AND NOT public.can_edit_sale_comissao(auth.uid(), OLD.id) THEN
    RAISE EXCEPTION 'Somente o gestor/team leader (ou financeiro/admin) pode editar a divisão da comissão desta venda.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_contrato_pendencia(_sale_id uuid, _pendencia_descricao text, _libera_assinatura boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_view_sale(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Sem permissão para editar esta venda.';
  END IF;

  IF NOT public.has_any_role(auth.uid(), ARRAY['gestor','team_leader','juridico','financeiro','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Somente gestor, team leader, jurídico, financeiro ou admin podem editar a pendência do contrato.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id
    AND s.status::text = ANY(ARRAY[
      'em_elaboracao_contrato','contrato_conferencia_gestor','contrato_conferencia_corretor',
      'contrato_ok_corretor','aguardando_assinatura'
    ])
  ) THEN
    RAISE EXCEPTION 'A pendência do contrato só pode ser editada durante as etapas de elaboração/conferência/assinatura do contrato.';
  END IF;

  UPDATE public.sales
  SET contrato_pendencia_descricao = _pendencia_descricao,
      contrato_libera_assinatura = _libera_assinatura
  WHERE id = _sale_id;
END;
$function$;
