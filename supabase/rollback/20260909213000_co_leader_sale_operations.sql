BEGIN;
DROP POLICY "co_leader_activity_read" ON public."activity_logs";
DROP POLICY "co_leader_commissions_write" ON public."occurrence_commissions";
DROP POLICY "co_leader_partners_write" ON public."occurrence_partners";
DROP POLICY "co_leader_occurrence_write" ON public."occurrences";
DROP POLICY "co_leader_bank_read" ON public."sale_bank_accounts";
DROP POLICY "co_leader_bank_write" ON public."sale_bank_accounts";
DROP POLICY "co_leader_comments_insert" ON public."sale_comments";
DROP POLICY "co_leader_comments_read" ON public."sale_comments";
DROP POLICY "co_leader_extras_write" ON public."sale_commission_extras";
DROP POLICY "co_leader_documents_insert" ON public."sale_documents";
DROP POLICY "co_leader_documents_read" ON public."sale_documents";
DROP POLICY "co_leader_documents_update" ON public."sale_documents";
DROP POLICY "co_leader_parties_write" ON public."sale_parties";
DROP POLICY "co_leader_payment_write" ON public."sale_payment";
DROP POLICY "co_leader_history_read" ON public."sale_status_history";
DROP POLICY "co_leader_sale_update" ON public."sales";
DROP POLICY "co_leader_storage_insert" ON storage."objects";
DROP POLICY "co_leader_storage_read" ON storage."objects";
DROP POLICY "co_leader_storage_update" ON storage."objects";
DROP TRIGGER enforce_co_leader_sale_scope ON sales;
DROP FUNCTION enforce_co_leader_sale_scope();
DROP TRIGGER enforce_co_leader_occurrence_scope ON occurrences; DROP FUNCTION enforce_co_leader_occurrence_scope();
CREATE OR REPLACE FUNCTION public.change_sale_status(_sale_id uuid, _new_status text, _motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _prev_status text;
  _occ_id uuid;
  _conflito record;
begin
  if not public.can_view_sale(auth.uid(), _sale_id) then
    raise exception 'Sem permissão para acessar esta venda.';
  end if;

  select status::text into _prev_status
  from public.sales
  where id = _sale_id
  for update;

  if _prev_status is null then
    raise exception 'Venda não encontrada.';
  end if;

  if _new_status in ('cancelada', 'arquivada') and nullif(btrim(_motivo), '') is null then
    raise exception 'Informe o motivo para cancelar ou arquivar a venda.' using errcode = '23514';
  end if;

  if _new_status in ('ocorrencia_pendente', 'ocorrencia_analise_financeiro') then
    perform public.criar_ocorrencia_completa(_sale_id);
  end if;

  if _new_status = 'ocorrencia_analise_financeiro' then
    select id into _occ_id from public.occurrences where sale_id = _sale_id;

    select m.id, m.papel, m.nome, m.valor
    into _conflito
    from public.occurrence_commissions m
    where m.occurrence_id = _occ_id
      and m.managed_by_sale = false
      and m.user_id is null
      and coalesce(m.sem_cadastro_confirmado, false) = false
    limit 1;

    if found then
      raise exception 'Existe uma comissão manual incompleta na Ocorrência (% / %). Exclua-a ou escolha explicitamente o beneficiário antes de enviar ao Financeiro.',
        coalesce(_conflito.papel, 'sem papel'),
        coalesce(_conflito.valor::text, 'sem valor')
        using errcode = '23514';
    end if;

    select m.id, m.papel, m.nome, m.valor
    into _conflito
    from public.occurrence_commissions m
    join public.occurrence_commissions o
      on o.occurrence_id = m.occurrence_id
     and o.managed_by_sale = true
     and (
       (m.user_id is not null and o.user_id = m.user_id)
       or (
         nullif(btrim(m.nome), '') is not null
         and lower(btrim(o.nome)) = lower(btrim(m.nome))
       )
     )
    where m.occurrence_id = _occ_id
      and m.managed_by_sale = false
    limit 1;

    if found then
      raise exception 'Existe uma comissão manual duplicando um beneficiário da divisão oficial (% / %). Revise ou exclua a linha manual antes de enviar ao Financeiro.',
        coalesce(_conflito.nome, _conflito.papel, 'sem identificação'),
        coalesce(_conflito.valor::text, 'sem valor')
        using errcode = '23514';
    end if;
  end if;

  update public.sales set status = _new_status::sale_status where id = _sale_id;

  insert into public.sale_status_history (sale_id, de, para, autor_id, motivo)
  values (_sale_id, _prev_status::sale_status, _new_status::sale_status, auth.uid(), _motivo);

  insert into public.activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), _sale_id, 'status_change', jsonb_build_object('de', _prev_status, 'para', _new_status, 'motivo', _motivo));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_sale_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := auth.uid();
  is_owner boolean := (old.corretor_id = auth.uid());
  allowed boolean := false;
  from_status text := old.status::text;
  to_status text := new.status::text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if public.has_any_role(actor, array['admin','super_admin']::app_role[]) then return new; end if;

  if to_status in ('cancelada', 'arquivada')
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and public.is_lead_of(actor, old.corretor_id)
     and from_status in (
       'enviada_revisao', 'contrato_conferencia_gestor', 'contrato_ok_corretor',
       'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
       'ocorrencia_devolvida_gestor'
     ) then
    return new;
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
     and public.is_lead_of(actor, old.corretor_id) then
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
$function$
;
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
    OR NEW.indicador_captador IS DISTINCT FROM OLD.indicador_captador
    OR NEW.indicador_vendedor IS DISTINCT FROM OLD.indicador_vendedor
    OR NEW.valor_comissao_indicador_captador IS DISTINCT FROM OLD.valor_comissao_indicador_captador
    OR NEW.valor_comissao_indicador_vendedor IS DISTINCT FROM OLD.valor_comissao_indicador_vendedor
    OR NEW.valor_comissao_lider_captador IS DISTINCT FROM OLD.valor_comissao_lider_captador
    OR NEW.valor_comissao_lider_vendedor IS DISTINCT FROM OLD.valor_comissao_lider_vendedor
    OR NEW.percentual_remax IS DISTINCT FROM OLD.percentual_remax
    OR NEW.valor_remax IS DISTINCT FROM OLD.valor_remax
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
$function$
;
CREATE OR REPLACE FUNCTION public.archive_sale_document(_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sale_id uuid;
BEGIN
  SELECT sale_id INTO _sale_id FROM public.sale_documents WHERE id = _document_id;
  IF _sale_id IS NULL THEN
    RAISE EXCEPTION 'Documento não encontrado.';
  END IF;

  IF NOT public.can_view_sale(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Sem permissão para acessar esta venda.';
  END IF;

  IF public.is_sale_locked(_sale_id) AND NOT public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Venda travada — só financeiro/admin podem editar documentos agora.';
  END IF;

  IF NOT public.can_edit_sale_stage(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Você não pode editar documentos nesta etapa da venda.';
  END IF;

  DELETE FROM public.document_extractions WHERE document_id = _document_id;

  UPDATE public.sale_documents
  SET deleted_at = now(), deleted_by = auth.uid()
  WHERE id = _document_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.insert_sale_document(_sale_id uuid, _tipo text, _parte text, _storage_path text, _file_name text, _status doc_status DEFAULT 'enviado'::doc_status, _descricao text DEFAULT NULL::text, _extraction_status text DEFAULT 'none'::text)
 RETURNS sale_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.sale_documents;
BEGIN
  IF NOT public.can_view_sale(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Sem permissão para acessar esta venda.';
  END IF;

  IF public.is_sale_locked(_sale_id) AND NOT public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Venda travada — só financeiro/admin podem editar documentos agora.';
  END IF;

  IF NOT public.can_edit_sale_stage(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Você não pode editar documentos nesta etapa da venda.';
  END IF;

  INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, uploaded_by, status, descricao, extraction_status)
  VALUES (_sale_id, _tipo, _parte, _storage_path, _file_name, auth.uid(), _status, _descricao, _extraction_status)
  RETURNING * INTO _row;

  RETURN _row;
END;
$function$
;
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
$function$
;
DROP FUNCTION sale_management_capabilities(uuid); DROP FUNCTION can_edit_sale_as_co_leader(uuid); DROP FUNCTION can_manage_sale_as_co_leader(uuid); COMMIT;