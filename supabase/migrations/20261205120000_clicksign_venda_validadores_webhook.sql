-- Clicksign na VENDA: o aviso da Clicksign (webhook, sem usuário logado) volta a mudar a etapa da venda,
-- e uma venda já assinada pela Clicksign não é enviada de novo. Cartão t_0c874b61 (causa: t_57d68ded),
-- autorizado por Denis em 19/11 no tópico 6238. PREPARADA: aplicar em produção só com o "pode publicar".
--
-- Causa: validar_participantes_internos_venda e validar_composicao_pagamento_venda têm dono mt_1b_definer
-- (fase 1b da multiempresa). Esse papel não ignora a RLS e herda as políticas RESTRICTIVE de
-- "authenticated" (org_isolation: organization_id = current_org_id()). Sem JWT (webhook da Clicksign),
-- current_org_id() é NULL, a função não enxerga a venda e responde "Venda não encontrada.". Os gatilhos
-- trg_bloquear_participante_sem_cadastro / trg_bloquear_pagamento_inconsistente chamam essas funções em
-- toda troca de etapa, então clicksign_sale_mark_sent / clicksign_sale_attach_signed não conseguiam
-- mover a venda (7 envelopes com error_code "status_failed:Venda não encontrada.").
--
-- Correção:
-- 1) As duas funções passam a ter dono postgres (como as demais funções da Clicksign) e a trava da
--    imobiliária fica ESCRITA na função: public.mt_1b_gate(organização da venda).
--      - usuário logado: só a venda da própria imobiliária (mesma regra de antes, current_org_id());
--        perfil só fotógrafo / só locação continua sem acesso (políticas zz_*_fora);
--      - servidor (service_role, ex.: webhook) ou postgres: passa, como em qualquer gatilho do servidor;
--      - sem JWT e sem ser servidor (anon): "Venda não encontrada.".
--    As leituras de profiles / sale_payment / sale_commission_extras ficam presas à organização da
--    venda (antes isso vinha da RLS). As regras de validação não mudam.
-- 2) clicksign_sale_authorize recusa novo envio quando a venda já tem envelope ASSINADO pela Clicksign
--    para a versão atual do contrato (PDF assinado anexado e não excluído). Envelope em envio/assinatura
--    já era recusado. Nova versão do contrato pelo jurídico continua podendo ir à Clicksign.
--
-- Não altera dados, gatilhos, políticas nem outras funções.
-- Rollback: docs/sql/rollback/20261205120000_clicksign_venda_validadores_webhook.rollback.sql
-- Teste:    supabase/tests/run-clicksign-venda-validadores-webhook.sh (homologação, transação desfeita).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- ===== 1a) participantes =====
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
  -- t_0c874b61: dono postgres (ignora RLS). A trava da imobiliária é esta linha: usuário só a venda da
  -- própria imobiliária; servidor (webhook Clicksign) passa; anon não. Mesma mensagem nos dois casos.
  if not found
     or not public.mt_1b_gate(v_sale.organization_id)
     or (auth.uid() is not null
         and (public.eh_so_fotografo(auth.uid()) or public.eh_so_locacao(auth.uid()))) then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  for v_item in
    select * from (values
      ('Corretor responsável', nullif(trim(coalesce((select p.nome from public.profiles p where p.id = v_sale.corretor_id and p.organization_id = v_sale.organization_id), '')), ''), v_sale.corretor_id),
      ('Captador', nullif(trim(v_sale.corretor_captador), ''), v_sale.corretor_captador_id),
      ('Vendedor', nullif(trim(v_sale.corretor_vendedor), ''), v_sale.corretor_vendedor_id),
      ('Indicador do captador', nullif(trim(v_sale.indicador_captador), ''), v_sale.indicador_captador_id),
      ('Indicador do vendedor', nullif(trim(v_sale.indicador_vendedor), ''), v_sale.indicador_vendedor_id),
      ('Líder do captador', nullif(trim(v_sale.lider_captador_nome), ''), v_sale.lider_captador_id),
      ('Líder do vendedor', nullif(trim(v_sale.lider_vendedor_nome), ''), v_sale.lider_vendedor_id)
    ) as participantes(papel, nome, user_id)
  loop
    if v_item.user_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = v_item.user_id and p.ativo = true and p.organization_id = v_sale.organization_id
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
      and e.organization_id = v_sale.organization_id
      and nullif(trim(e.nome), '') is not null
      and coalesce(e.sem_cadastro_confirmado, false) = false
      and (
        e.user_id is null
        or not exists (select 1 from public.profiles p
                       where p.id = e.user_id and p.ativo = true
                         and p.organization_id = v_sale.organization_id)
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

-- ===== 1b) composição do pagamento =====
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
  -- t_0c874b61: mesma trava da imobiliária de validar_participantes_internos_venda.
  if not found
     or not public.mt_1b_gate(v_sale.organization_id)
     or (auth.uid() is not null
         and (public.eh_so_fotografo(auth.uid()) or public.eh_so_locacao(auth.uid()))) then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  select * into v_payment from public.sale_payment
    where sale_id = p_sale_id and organization_id = v_sale.organization_id;
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

ALTER FUNCTION public.validar_participantes_internos_venda(uuid) OWNER TO postgres;
ALTER FUNCTION public.validar_composicao_pagamento_venda(uuid) OWNER TO postgres;
-- Mesmos executores de antes (authenticated, service_role, mt_1b_definer); nunca PUBLIC/anon.
REVOKE ALL ON FUNCTION public.validar_participantes_internos_venda(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validar_composicao_pagamento_venda(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validar_participantes_internos_venda(uuid) TO authenticated, service_role, mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.validar_composicao_pagamento_venda(uuid) TO authenticated, service_role, mt_1b_definer;

-- ===== 1c) histórico da captação quando a venda vira "vendida" =====
-- Mesmo defeito, um passo depois: sales_captacao_historico (gatilho AFTER UPDATE OF status em sales, só
-- para venda que nasceu de captação) tem dono mt_1b_definer e, sem JWT, a política org_isolation de
-- exclusive_history recusa o INSERT (42501). Com dono postgres o INSERT passa pela RLS, mas a imobiliária
-- continua garantida pelos gatilhos da própria exclusive_history: trg_00_org (mt_1b_set_org) tira a org da
-- captação e recusa org diferente da do usuário logado; trg_01_pc_author_scope exige autor da mesma org.
-- Corpo da função não muda. Não é chamável por usuário (só gatilho; sem EXECUTE para authenticated).
ALTER FUNCTION public.sales_captacao_historico() OWNER TO postgres;

-- ===== 2) sem novo envio de contrato já assinado pela Clicksign =====
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
  -- t_0c874b61: esta versão do contrato já foi assinada por todos na Clicksign (PDF assinado anexado e
  -- não excluído). Não manda de novo às partes; nova versão do jurídico continua liberada.
  IF EXISTS (SELECT 1 FROM public.clicksign_envelopes e
      JOIN public.sale_documents d ON d.id = e.signed_document_id AND d.sale_id = _id
        AND d.tipo = 'contrato_assinado' AND d.deleted_at IS NULL
      WHERE e.sale_id = _id AND e.source_document_id = _doc) THEN
    RAISE EXCEPTION 'Este contrato já foi assinado pela Clicksign: use "Marcar contrato assinado" em vez de enviar de novo';
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

COMMIT;
