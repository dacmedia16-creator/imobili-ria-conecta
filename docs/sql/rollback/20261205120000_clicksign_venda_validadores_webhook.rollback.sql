-- Rollback de 20261205120000_clicksign_venda_validadores_webhook.sql (t_0c874b61).
-- Volta as 3 funções (e o dono de sales_captacao_historico) ao texto, dono e permissões de PRODUÇÃO lidos em 19/11/2026 (pg_get_functiondef).
-- Atenção: com o rollback o aviso da Clicksign volta a falhar com "Venda não encontrada.".
-- Nenhum dado é alterado.
BEGIN;
CREATE OR REPLACE FUNCTION public.validar_participantes_internos_venda(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale public.sales%rowtype;
  v_inconsistencias jsonb := '[]'::jsonb;
  v_item record;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  for v_item in
    select * from (values
      ('Corretor responsável', nullif(trim(coalesce((select p.nome from public.profiles p where p.id = v_sale.corretor_id), '')), ''), v_sale.corretor_id),
      ('Captador', nullif(trim(v_sale.corretor_captador), ''), v_sale.corretor_captador_id),
      ('Vendedor', nullif(trim(v_sale.corretor_vendedor), ''), v_sale.corretor_vendedor_id),
      ('Indicador do captador', nullif(trim(v_sale.indicador_captador), ''), v_sale.indicador_captador_id),
      ('Indicador do vendedor', nullif(trim(v_sale.indicador_vendedor), ''), v_sale.indicador_vendedor_id),
      ('Líder do captador', nullif(trim(v_sale.lider_captador_nome), ''), v_sale.lider_captador_id),
      ('Líder do vendedor', nullif(trim(v_sale.lider_vendedor_nome), ''), v_sale.lider_vendedor_id)
    ) as participantes(papel, nome, user_id)
  loop
    if v_item.user_id is not null and not exists (
      select 1 from public.profiles p where p.id = v_item.user_id and p.ativo = true
    ) then
      v_inconsistencias := v_inconsistencias || jsonb_build_array(
        v_item.papel || case when v_item.nome is not null then ' "' || v_item.nome || '"' else '' end ||
        ' está sem cadastro ativo no sistema.'
      );
    elsif v_item.nome is not null and v_item.user_id is null then
      v_inconsistencias := v_inconsistencias || jsonb_build_array(
        v_item.papel || ' "' || v_item.nome || '" está sem conta vinculada no sistema.'
      );
    end if;
  end loop;

  for v_item in
    select e.nome, e.papel, e.user_id
    from public.sale_commission_extras e
    where e.sale_id = p_sale_id
      and nullif(trim(e.nome), '') is not null
      and coalesce(e.sem_cadastro_confirmado, false) = false
      and (
        e.user_id is null
        or not exists (select 1 from public.profiles p where p.id = e.user_id and p.ativo = true)
      )
  loop
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      coalesce(initcap(replace(v_item.papel, '_', ' ')), 'Participante') ||
      ' "' || trim(v_item.nome) || '" está sem conta ativa vinculada no sistema.'
    );
  end loop;

  return jsonb_build_object(
    'valido', jsonb_array_length(v_inconsistencias) = 0,
    'inconsistencias', v_inconsistencias
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.validar_composicao_pagamento_venda(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale public.sales%rowtype;
  v_payment public.sale_payment%rowtype;
  v_tipo text;
  v_total numeric := 0;
  v_diferenca numeric := 0;
  v_mensagem text;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  select * into v_payment from public.sale_payment where sale_id = p_sale_id;
  if not found then
    return jsonb_build_object('valido', false, 'mensagem', 'Falta detalhar a forma de pagamento.');
  end if;

  if coalesce(v_sale.valor_negociado, 0) <= 0 then
    return jsonb_build_object('valido', false, 'mensagem', 'Falta informar o valor negociado.');
  end if;

  v_tipo := coalesce(v_payment.tipo_pagamento, 'vista');
  if v_tipo = 'financiamento' and coalesce(v_payment.financiamento_valor, 0) <= 0 then
    return jsonb_build_object('valido', false, 'mensagem', 'Informe o valor financiado.');
  end if;
  if v_tipo = 'consorcio' and coalesce(v_payment.consorcio_valor, 0) <= 0 then
    return jsonb_build_object('valido', false, 'mensagem', 'Informe o valor da carta de consórcio.');
  end if;

  v_total :=
    coalesce(v_payment.entrada_valor, 0) +
    coalesce(v_payment.parcela1_valor, 0) +
    coalesce(v_payment.parcela2_valor, 0) +
    coalesce(v_payment.pagamento_final_valor, 0) +
    case when coalesce(v_payment.fgts, false) then coalesce(v_payment.fgts_valor, 0) else 0 end +
    case when v_tipo = 'financiamento' then coalesce(v_payment.financiamento_valor, 0) else 0 end +
    case when v_tipo = 'consorcio' then coalesce(v_payment.consorcio_valor, 0) else 0 end;

  v_diferenca := round(v_sale.valor_negociado - v_total, 2);
  if abs(v_diferenca) <= 0.01 then
    return jsonb_build_object('valido', true, 'total', v_total, 'diferenca', v_diferenca);
  end if;

  v_mensagem := case when v_diferenca > 0 then
    'A composição do pagamento está R$ ' || to_char(v_diferenca, 'FM999G999G999G990D00') || ' abaixo do valor da venda.'
  else
    'A composição do pagamento está R$ ' || to_char(abs(v_diferenca), 'FM999G999G999G990D00') || ' acima do valor da venda.'
  end;
  return jsonb_build_object('valido', false, 'mensagem', v_mensagem, 'total', v_total, 'diferenca', v_diferenca);
end;
$function$;

CREATE OR REPLACE FUNCTION public.clicksign_sale_authorize(_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

-- Dono original (fase 1b). Em produção o ALTER OWNER exige CREATE no schema durante a troca.
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.validar_participantes_internos_venda(uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.validar_composicao_pagamento_venda(uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.sales_captacao_historico() OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.validar_participantes_internos_venda(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validar_composicao_pagamento_venda(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validar_participantes_internos_venda(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validar_composicao_pagamento_venda(uuid) TO authenticated, service_role;
COMMIT;
