-- Gestor/Team Leader pode cancelar ou arquivar somente uma venda de corretor que ele lidera e
-- somente quando o status atual representa uma etapa sob responsabilidade do gestor. Admin e
-- super_admin mantêm a permissão global. O motivo passa a ser obrigatório também no banco, não só
-- no formulário, e change_sale_status continua gravando histórico + activity_log na transação.

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
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF public.has_any_role(actor, ARRAY['admin','super_admin']::app_role[]) THEN RETURN NEW; END IF;

  IF to_status IN ('cancelada', 'arquivada')
     AND public.has_any_role(actor, ARRAY['gestor','team_leader']::app_role[])
     AND public.is_lead_of(actor, OLD.corretor_id)
     AND from_status IN (
       'enviada_revisao', 'contrato_conferencia_gestor', 'contrato_ok_corretor',
       'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
       'ocorrencia_devolvida_gestor'
     ) THEN
    RETURN NEW;
  END IF;

  IF is_owner AND (from_status, to_status) IN (
    ('rascunho', 'enviada_revisao'), ('devolvida_ajuste', 'enviada_revisao'),
    ('contrato_conferencia_corretor', 'contrato_ok_corretor'),
    ('contrato_conferencia_corretor', 'contrato_conferencia_gestor')
  ) THEN allowed := true; END IF;

  IF NOT allowed AND is_owner AND public.has_any_role(actor, ARRAY['gestor','team_leader']::app_role[]) AND (from_status, to_status) IN (
    ('rascunho', 'aprovada_gestor'), ('devolvida_ajuste', 'aprovada_gestor')
  ) THEN allowed := true; END IF;

  IF NOT allowed AND is_owner AND public.has_role(actor, 'lancamento'::app_role) AND (from_status, to_status) IN (
    ('rascunho', 'ocorrencia_analise_financeiro'),
    ('devolvida_ajuste', 'ocorrencia_analise_financeiro')
  ) THEN allowed := true; END IF;

  IF NOT allowed AND public.has_any_role(actor, ARRAY['gestor','team_leader']::app_role[]) AND (from_status, to_status) IN (
    ('enviada_revisao', 'aprovada_gestor'), ('enviada_revisao', 'devolvida_ajuste'),
    ('contrato_conferencia_gestor', 'contrato_conferencia_corretor'),
    ('contrato_conferencia_gestor', 'aguardando_assinatura'),
    ('contrato_conferencia_gestor', 'em_elaboracao_contrato'),
    ('contrato_ok_corretor', 'aguardando_assinatura'),
    ('contrato_ok_corretor', 'contrato_conferencia_corretor'),
    ('aguardando_assinatura', 'contrato_assinado'),
    ('aguardando_assinatura', 'em_elaboracao_contrato'),
    ('contrato_assinado', 'ocorrencia_pendente'), ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'aguardando_assinatura'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida')
  ) THEN allowed := true; END IF;

  IF NOT allowed AND public.has_role(actor, 'juridico') AND (from_status, to_status) IN (
    ('aprovada_gestor', 'em_elaboracao_contrato'), ('aprovada_gestor', 'enviada_revisao'),
    ('aprovada_gestor', 'devolvida_ajuste'),
    ('em_elaboracao_contrato', 'contrato_conferencia_gestor'),
    ('em_elaboracao_contrato', 'enviada_revisao'), ('em_elaboracao_contrato', 'devolvida_ajuste')
  ) THEN allowed := true; END IF;

  IF NOT allowed AND public.has_role(actor, 'financeiro') AND (from_status, to_status) IN (
    ('ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor'),
    ('ocorrencia_analise_financeiro', 'ocorrencia_concluida'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida'),
    ('ocorrencia_concluida', 'ocorrencia_pendente')
  ) THEN allowed := true; END IF;

  IF NOT allowed AND public.has_role(actor, 'financeiro') AND NEW.modalidade = 'lancamento' AND (from_status, to_status) IN (
    ('ocorrencia_analise_financeiro', 'devolvida_ajuste'),
    ('ocorrencia_concluida', 'ocorrencia_analise_financeiro')
  ) THEN allowed := true; END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Transição de status não permitida para este usuário: % -> %', from_status, to_status USING ERRCODE = '42501';
  END IF;

  IF from_status = 'aguardando_assinatura' AND to_status = 'contrato_assinado'
     AND NOT EXISTS (SELECT 1 FROM public.sale_documents d WHERE d.sale_id = OLD.id AND d.tipo = 'contrato_assinado') THEN
    RAISE EXCEPTION 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.change_sale_status(_sale_id uuid, _new_status text, _motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _prev_status text;
BEGIN
  IF NOT public.can_view_sale(auth.uid(), _sale_id) THEN RAISE EXCEPTION 'Sem permissão para acessar esta venda.'; END IF;
  SELECT status::text INTO _prev_status FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF _prev_status IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF _new_status IN ('cancelada', 'arquivada') AND NULLIF(btrim(_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para cancelar ou arquivar a venda.' USING ERRCODE = '23514';
  END IF;
  IF _new_status IN ('ocorrencia_pendente', 'ocorrencia_analise_financeiro') THEN
    PERFORM public.criar_ocorrencia_completa(_sale_id);
  END IF;
  UPDATE public.sales SET status = _new_status::sale_status WHERE id = _sale_id;
  INSERT INTO public.sale_status_history (sale_id, de, para, autor_id, motivo)
  VALUES (_sale_id, _prev_status::sale_status, _new_status::sale_status, auth.uid(), _motivo);
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload)
  VALUES (auth.uid(), _sale_id, 'status_change', jsonb_build_object('de', _prev_status, 'para', _new_status, 'motivo', _motivo));
END;
$function$;
