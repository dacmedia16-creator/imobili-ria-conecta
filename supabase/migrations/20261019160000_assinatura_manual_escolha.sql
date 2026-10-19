-- Assinatura manual (papel) ao lado da Clicksign, na VENDA e na CAPTAÇÃO (cartão t_e6f778ac; maquete
-- aprovada por Denis em 19/10/2026, t_4a04f9ac / t_2f88691b).
-- Rollback: supabase/rollback/20261019160000_assinatura_manual_escolha.sql
--
-- O que muda:
-- 1) validate_sale_status_transition (cópia da versão vigente 20261018200000 + um bloco): o JURÍDICO
--    também leva a venda para aguardando_assinatura (escolha "Manual – papel" em contrato_ok_corretor),
--    marca o contrato assinado (aguardando_assinatura → contrato_assinado → ocorrencia_pendente, a mesma
--    transação de marcar_contrato_assinado_e_criar_ocorrencia). Gestor/team leader seguem iguais; admin
--    e super_admin já passavam. Corretor: nada muda. A regra da data da venda NÃO muda.
-- 2) Upload do contrato assinado pelo jurídico SEM abrir can_edit_sale_stage (que liberaria todos os
--    documentos e a própria venda nessa etapa): duas policies estreitas (sale_documents e storage) só
--    para tipo 'contrato_assinado', parte 'outros', venda em aguardando_assinatura, que o jurídico já vê
--    (can_view_sale, mesma organização), e não travada pelo financeiro.
-- 3) Trocar de ideia sem envio em dobro:
--    - manual → Clicksign: clicksign_sale_authorize/clicksign_capture_authorize aceitam também a venda
--      em aguardando_assinatura / a captação em em_assinatura, desde que NÃO haja envelope em andamento
--      e o assinado no papel ainda não tenha sido anexado;
--    - Clicksign → manual: o envelope é cancelado na Clicksign antes (edge function) e o registro
--      mantém a venda em aguardando_assinatura (motivo 'papel' em clicksign_sale_canceled) / a captação
--      em em_assinatura (clicksign_capture_canceled_papel, nova).
-- Não mexe em dashboard_stats, vendas_comerciais_canonicas nem financeiro_distribuicao_vendas.
BEGIN;

-- ===== 1) Transições do jurídico na assinatura =====
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

  -- 18/10/2026 (t_70734b3a): Clicksign na venda. Só o servidor (sem usuário logado), dentro de
  -- clicksign_sale_set_status (marca local clicksign.sale = id da venda), e só nestas transições.
  if actor is null
     and current_setting('clicksign.sale', true) = old.id::text
     and (from_status, to_status) in (
       ('contrato_ok_corretor', 'aguardando_assinatura'),
       ('aguardando_assinatura', 'contrato_ok_corretor'),
       -- atalho do gestor (o gestor já tem conferencia_gestor → aguardando no fluxo manual)
       ('contrato_conferencia_gestor', 'aguardando_assinatura'),
       ('aguardando_assinatura', 'contrato_conferencia_gestor'),
       ('aguardando_assinatura', 'contrato_assinado'),
       ('contrato_assinado', 'ocorrencia_pendente')
     ) then
    if to_status = 'contrato_assinado'
       and not exists (select 1 from public.sale_documents d where d.sale_id = old.id and d.tipo = 'contrato_assinado') then
      raise exception 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.' using errcode = '23514';
    end if;
    return new;
  end if;

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

  -- 09/10/2026 (Denis, tópico 6238): desarquivar. Além de admin/super_admin (já retornaram acima),
  -- quem criou a venda (sales.corretor_id) e o gestor/team leader que lidera o criador ou um
  -- responsável podem tirar a venda de 'arquivada', mas SOMENTE de volta para a etapa em que ela
  -- estava quando foi arquivada (último registro do histórico). Motivo obrigatório na tela.
  if from_status = 'arquivada' then
    if actor is not null
       and to_status = (
         select h.de::text from public.sale_status_history h
         where h.sale_id = old.id and h.para = 'arquivada'
         order by h.created_at desc limit 1
       )
       and public.can_view_sale(actor, old.id)
       and (
         old.corretor_id = actor
         or (public.has_any_role(actor, array['gestor','team_leader']::app_role[])
             and (public.is_lead_of(actor, old.corretor_id)
                  or public.is_lead_of_sale_responsavel(actor, old.id)))
       ) then
      return new;
    end if;
    raise exception 'Desarquivar: só quem criou a venda, o gestor/team leader dela ou o admin, e apenas de volta para a etapa anterior ao arquivamento.' using errcode = '42501';
  end if;

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

  -- Denis 09/10/2026: quem cadastrou a venda (corretor_id) também envia para revisão.
  if old.corretor_id = actor and actor is not null and (from_status, to_status) in (
    ('rascunho', 'enviada_revisao'), ('devolvida_ajuste', 'enviada_revisao')
  ) then allowed := true; end if;

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

  -- 19/10/2026 (Denis, t_e6f778ac): assinatura manual (papel). O jurídico também escolhe o papel em
  -- contrato_ok_corretor e marca o contrato assinado (que já cria a ocorrência, mesma transação de
  -- marcar_contrato_assinado_e_criar_ocorrencia). A organização e a visibilidade continuam sendo
  -- conferidas em change_sale_status (can_view_sale); aqui é só a transição permitida.
  if not allowed and public.has_role(actor, 'juridico') and (from_status, to_status) in (
    ('contrato_ok_corretor', 'aguardando_assinatura'),
    ('aguardando_assinatura', 'contrato_assinado'),
    ('contrato_assinado', 'ocorrencia_pendente')
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

-- ===== 2) Jurídico sobe o contrato assinado (só esse documento, só nessa etapa) =====
CREATE FUNCTION public.can_upload_contrato_assinado_juridico(_sale_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(public.is_active_user(auth.uid())
    AND public.has_role(auth.uid(), 'juridico'::public.app_role)
    AND EXISTS (SELECT 1 FROM public.sales s
      WHERE s.id = _sale_id AND s.organization_id = public.current_org_id()
        AND s.status::text = 'aguardando_assinatura')
    AND public.can_view_sale(auth.uid(), _sale_id)
    AND NOT public.is_sale_locked(_sale_id), false);
$$;
REVOKE ALL ON FUNCTION public.can_upload_contrato_assinado_juridico(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_upload_contrato_assinado_juridico(uuid) TO authenticated;

-- As policies antigas seguem intactas; estes ramos novos só somam o caso do jurídico.
CREATE POLICY juridico_contrato_assinado_insert ON public.sale_documents
FOR INSERT TO authenticated WITH CHECK (
  tipo = 'contrato_assinado' AND parte = 'outros'
  AND uploaded_by = (SELECT auth.uid())
  AND split_part(public.mt_1c_relative_path(storage_path), '/', 1) = sale_id::text
  AND split_part(public.mt_1c_relative_path(storage_path), '/', 2) = 'outros'
  AND split_part(public.mt_1c_relative_path(storage_path), '/', 3) = 'contrato_assinado'
  AND public.can_upload_contrato_assinado_juridico(sale_id)
);

CREATE POLICY juridico_contrato_assinado_storage_insert ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'sale-documents'
  AND split_part(public.mt_1c_relative_path(name), '/', 2) = 'outros'
  AND split_part(public.mt_1c_relative_path(name), '/', 3) = 'contrato_assinado'
  AND split_part(public.mt_1c_relative_path(name), '/', 4) <> ''
  AND split_part(public.mt_1c_relative_path(name), '/', 5) = ''
  AND EXISTS (SELECT 1 FROM public.sales s
    WHERE s.id::text = split_part(public.mt_1c_relative_path(name), '/', 1)
      AND public.can_upload_contrato_assinado_juridico(s.id))
);

-- ===== 3) Trocar de ideia sem envio em dobro =====
-- manual → Clicksign (venda): cópia de 20261018200000 + aguardando_assinatura sem envelope ativo.
CREATE OR REPLACE FUNCTION public.clicksign_sale_authorize(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _sale public.sales%ROWTYPE; _doc uuid;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_sender_ok(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas gestor, jurídico ou admin da imobiliária pode enviar pela Clicksign';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clicksign_org_settings s WHERE s.organization_id = _org
      AND s.enabled AND s.sale_enabled AND s.access_token_secret_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Envio pela Clicksign não está habilitado para esta imobiliária';
  END IF;
  SELECT * INTO _sale FROM public.sales WHERE id = _id AND organization_id = _org;
  IF NOT FOUND OR NOT coalesce(public.can_view_sale(auth.uid(), _id), false) THEN
    RAISE EXCEPTION 'Venda não disponível';
  END IF;
  -- contrato_conferencia_gestor = atalho "Enviar direto para assinatura" do gestor (t_2284ea8b): mesma
  -- regra do fluxo manual (gestor/team leader/admin; o jurídico não pula a conferência).
  -- aguardando_assinatura = estava na assinatura manual (papel) e trocou para a Clicksign
  -- (t_e6f778ac). Envelope em andamento continua barrado logo abaixo (sem envio em dobro).
  IF NOT (_sale.status::text IN ('contrato_ok_corretor', 'aguardando_assinatura')
      OR (_sale.status::text = 'contrato_conferencia_gestor'
          AND public.has_any_role(auth.uid(),
            ARRAY['gestor','team_leader','admin','super_admin']::public.app_role[]))) THEN
    RAISE EXCEPTION 'A venda precisa estar com o contrato conferido pelo corretor para ir à Clicksign';
  END IF;
  IF _sale.contrato_libera_assinatura IS NOT DISTINCT FROM false THEN
    RAISE EXCEPTION 'O jurídico bloqueou a assinatura deste contrato';
  END IF;
  _doc := public.clicksign_sale_contrato(_id);
  IF _doc IS NULL THEN RAISE EXCEPTION 'O jurídico ainda não anexou o contrato'; END IF;
  IF EXISTS (SELECT 1 FROM public.clicksign_envelopes e WHERE e.sale_id = _id
      AND e.status IN ('sending','running')) THEN
    RAISE EXCEPTION 'Este contrato já está em envio ou em assinatura na Clicksign';
  END IF;
  -- Manual → Clicksign: com o contrato assinado no papel já anexado nesta etapa, não envia de novo
  -- (marque como assinado ou substitua o arquivo).
  IF _sale.status::text = 'aguardando_assinatura' AND EXISTS (
      SELECT 1 FROM public.sale_documents d
      WHERE d.sale_id = _id AND d.tipo = 'contrato_assinado' AND d.deleted_at IS NULL
        AND d.created_at >= coalesce((SELECT max(h.created_at) FROM public.sale_status_history h
          WHERE h.sale_id = _id AND h.para::text = 'aguardando_assinatura'), '-infinity'::timestamptz)) THEN
    RAISE EXCEPTION 'O contrato assinado no papel já foi anexado: marque o contrato como assinado em vez de enviar pela Clicksign';
  END IF;
  RETURN jsonb_build_object('org', _org, 'contrato', _doc);
END $$;

-- manual → Clicksign (captação): cópia de 20261019090000 + em_assinatura sem envelope ativo.
CREATE OR REPLACE FUNCTION public.clicksign_capture_authorize(_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _c public.exclusive_captures%ROWTYPE; _doc uuid;
  _gerado timestamptz;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_capture_sender_ok(auth.uid(), _id) THEN
    RAISE EXCEPTION 'Apenas gestor, team leader, jurídico ou admin da imobiliária pode enviar pela Clicksign';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clicksign_org_settings s WHERE s.organization_id = _org
      AND s.enabled AND s.access_token_secret_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Envio pela Clicksign não está habilitado para esta imobiliária';
  END IF;
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id AND organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  -- em_assinatura sem envelope ativo = assinatura manual (papel) que trocou para a Clicksign
  -- (t_e6f778ac). Envelope em andamento continua barrado logo abaixo (sem envio em dobro).
  IF _c.manual OR _c.status NOT IN ('enviada', 'em_assinatura') OR _c.archived_at IS NOT NULL
     OR _c.discarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'A captação precisa estar enviada ao gestor, com o contrato gerado, para ir à Clicksign';
  END IF;
  SELECT id, created_at INTO _doc, _gerado FROM public.exclusive_documents
    WHERE capture_id = _id AND kind = 'gerado';
  IF _doc IS NULL THEN RAISE EXCEPTION 'Gere o contrato antes de enviar para assinatura'; END IF;
  IF EXISTS (SELECT 1 FROM public.clicksign_envelopes e WHERE e.source_document_id = _doc
      AND e.status IN ('sending','running')) THEN
    RAISE EXCEPTION 'Este contrato já está em envio ou em assinatura na Clicksign';
  END IF;
  -- Manual → Clicksign com o assinado no papel já anexado: confira e aprove em vez de reenviar.
  IF _c.status = 'em_assinatura' AND EXISTS (SELECT 1 FROM public.exclusive_documents
      WHERE capture_id = _id AND kind = 'assinado' AND created_at >= _gerado) THEN
    RAISE EXCEPTION 'O contrato assinado já foi anexado: confira e aprove em vez de enviar pela Clicksign';
  END IF;
  RETURN _org;
END $$;

-- Clicksign → manual (venda): cópia de 20261018200000 + motivo 'papel' (cancelado para assinar no
-- papel): a venda fica em aguardando_assinatura, sem aviso de "envie de novo".
CREATE OR REPLACE FUNCTION public.clicksign_sale_canceled(_envelope uuid, _reason text, _actor uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _st text; _txt text;
BEGIN
  IF _reason NOT IN ('manual','nova_versao','status_mudou','cancel','deadline','refusal','papel') THEN
    RAISE EXCEPTION 'Motivo inválido';
  END IF;
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND OR _e.origem <> 'venda' THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _e.status IN ('canceled','closed','error') THEN RETURN 'already'; END IF;
  UPDATE public.clicksign_envelopes SET status = 'canceled', last_event = _reason,
    action_lock_until = NULL, updated_at = now() WHERE id = _envelope;
  _txt := CASE _reason
    WHEN 'manual' THEN 'Assinatura cancelada na Clicksign'
    WHEN 'papel' THEN 'Assinatura cancelada na Clicksign: segue a assinatura manual (papel)'
    WHEN 'nova_versao' THEN 'Assinatura cancelada na Clicksign: o jurídico subiu nova versão do contrato'
    WHEN 'status_mudou' THEN 'Assinatura cancelada na Clicksign: a venda saiu de aguardando assinatura'
    WHEN 'deadline' THEN 'Prazo da assinatura na Clicksign venceu'
    WHEN 'refusal' THEN 'Um signatário recusou a assinatura na Clicksign'
    ELSE 'Assinatura cancelada na Clicksign' END
    || CASE WHEN _e.is_test THEN ' (TESTE)' ELSE '' END;
  SELECT status::text INTO _st FROM public.sales WHERE id = _e.sale_id FOR UPDATE;
  IF _st = 'aguardando_assinatura' AND _reason <> 'papel' THEN
    -- Volta para a etapa de onde saiu (atalho do gestor = contrato_conferencia_gestor).
    PERFORM public.clicksign_sale_set_status(_e.sale_id, coalesce((
        SELECT CASE WHEN h.de::text = 'contrato_conferencia_gestor' THEN 'contrato_conferencia_gestor' END
        FROM public.sale_status_history h
        WHERE h.sale_id = _e.sale_id AND h.para::text = 'aguardando_assinatura'
        ORDER BY h.created_at DESC LIMIT 1), 'contrato_ok_corretor'),
      coalesce(_actor, _e.created_by), _txt);
  ELSE
    INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload)
      VALUES (coalesce(_actor, _e.created_by), _e.sale_id, 'clicksign_cancelado',
        jsonb_build_object('motivo', _reason, 'detalhe', _txt));
  END IF;
  IF _reason NOT IN ('manual', 'papel') THEN
    PERFORM public.clicksign_sale_notify(_e, 'Clicksign: envie o contrato de novo',
      _txt || '. Quando o contrato estiver pronto, use "Enviar pela Clicksign" de novo.');
  END IF;
  RETURN 'canceled';
END $$;
REVOKE ALL ON FUNCTION public.clicksign_sale_canceled(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_canceled(uuid, text, uuid) TO service_role;

-- Clicksign → manual (captação): o envelope já foi cancelado na Clicksign pela edge function
-- (clicksign-manage, ação cancel_papel). A captação continua em em_assinatura e o assinado no papel
-- segue pelo fluxo de sempre (anexar, data e aprovar). Idempotente. Retorna: canceled | already.
CREATE FUNCTION public.clicksign_capture_canceled_papel(_envelope uuid, _actor uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND OR _e.origem <> 'captacao' THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _e.status IN ('canceled','closed','error') THEN RETURN 'already'; END IF;
  UPDATE public.clicksign_envelopes SET status = 'canceled', last_event = 'papel',
    action_lock_until = NULL, updated_at = now() WHERE id = _envelope;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (_e.capture_id, coalesce(_actor, _e.created_by), 'clicksign_cancelado',
      'Assinatura cancelada na Clicksign: segue a assinatura manual (papel)'
        || CASE WHEN _e.is_test THEN ' (TESTE)' ELSE '' END);
  RETURN 'canceled';
END $$;
REVOKE ALL ON FUNCTION public.clicksign_capture_canceled_papel(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_capture_canceled_papel(uuid, uuid) TO service_role;

COMMIT;
