-- Clicksign na VENDA (cartão t_70734b3a; decisões de Denis em 18/10/2026, maquete t_385add37).
-- Reaproveita a base da captação (clicksign_envelopes, webhook, editar signatário, reenviar aviso).
-- Rollback: supabase/rollback/20261018200000_clicksign_venda.sql
--
-- O que muda:
-- 1) clicksign_envelopes aceita origem 'venda' (sale_id; capture_id passa a ser opcional, com CHECK de
--    exclusividade). Leitura da venda pelo mesmo critério de can_view_sale (o corretor acompanha).
-- 2) Quem envia/cancela: gestor, jurídico, admin e super_admin (clicksign_sender_ok), só em
--    contrato_ok_corretor, com a liberação do jurídico (contrato_libera_assinatura <> false) e o
--    contrato vigente = último sale_documents tipo 'contrato' não apagado (ninguém sobe de novo).
-- 3) Mudanças de status feitas pelo servidor (envio → aguardando_assinatura; fechou → contrato_assinado
--    + ocorrencia_pendente; cancelou → volta a contrato_ok_corretor) via liberação pontual em
--    validate_sale_status_transition: só sem usuário logado (service_role) e com a marca local
--    clicksign.sale = id da venda, como o platform_cancel_sale.
-- 4) Fechou: anexa o contrato_assinado e marca a venda automaticamente, na mesma transação, com lock
--    no envelope (idempotente: webhook repetido devolve 'already' e não cria ocorrência de novo). Se a
--    marcação falhar (ex.: validação da venda), o PDF fica anexado e o gestor é avisado para marcar.
-- 5) Nova versão do contrato ou venda saindo de aguardando_assinatura com envelope aberto: o envelope
--    fica marcado para cancelamento (cancel_requested_at) e quem enviou é avisado; a tela cancela na
--    Clicksign sozinha e o botão "Cancelar assinatura" resolve se a chamada automática falhar.
-- 6) E-mail do parceiro: occurrence_partners.email e sales.parceria_email (aditivas, sem preencher nada).
-- 7) criar_ocorrencia_completa e sincronizar_ocorrencia_antes_financeiro copiam parceria_email (sem apagar
--    e-mail do Financeiro quando a venda não tem).
-- Nenhum e-mail em claro entra no banco pelo envelope: signers guarda só o sha256.

-- ===== 1) Envelope da venda =====
ALTER TABLE public.clicksign_envelopes
  DROP CONSTRAINT IF EXISTS clicksign_envelopes_origem_check,
  ALTER COLUMN capture_id DROP NOT NULL,
  ADD COLUMN sale_id uuid,
  ADD COLUMN cancel_requested_at timestamptz,
  ADD COLUMN cancel_reason text CHECK (cancel_reason IS NULL OR cancel_reason IN
    ('nova_versao','status_mudou','manual')),
  ADD CONSTRAINT clicksign_envelopes_origem_check CHECK (origem IN ('captacao','venda')),
  ADD CONSTRAINT clicksign_envelopes_alvo_check CHECK (
    (origem = 'captacao' AND capture_id IS NOT NULL AND sale_id IS NULL)
    OR (origem = 'venda' AND sale_id IS NOT NULL AND capture_id IS NULL)),
  ADD CONSTRAINT clicksign_envelopes_sale_fk FOREIGN KEY (sale_id, organization_id)
    REFERENCES public.sales(id, organization_id) ON DELETE CASCADE;
-- Um único envelope em andamento por venda (além do índice por documento, que já existe).
CREATE UNIQUE INDEX clicksign_envelopes_venda_um_ativo ON public.clicksign_envelopes (sale_id)
  WHERE sale_id IS NOT NULL AND status IN ('sending','running');
CREATE INDEX clicksign_envelopes_sale_idx
  ON public.clicksign_envelopes (organization_id, sale_id, created_at DESC) WHERE sale_id IS NOT NULL;
GRANT SELECT (origem, sale_id, cancel_requested_at, cancel_reason)
  ON public.clicksign_envelopes TO authenticated;
CREATE POLICY clicksign_envelopes_read_venda ON public.clicksign_envelopes FOR SELECT TO authenticated
USING (sale_id IS NOT NULL AND organization_id = (SELECT public.current_org_id())
  AND public.can_view_sale((SELECT auth.uid()), sale_id));

-- ===== 6) E-mail do parceiro (aditivo) =====
ALTER TABLE public.occurrence_partners ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS parceria_email text;

-- ===== Leitura e autorização (com o JWT do usuário) =====

-- Contrato vigente da venda: o último tipo 'contrato' não apagado que o jurídico subiu.
CREATE FUNCTION public.clicksign_sale_contrato(_sale uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.id FROM public.sale_documents d
  WHERE d.sale_id = _sale AND d.tipo = 'contrato' AND d.deleted_at IS NULL
    AND d.storage_path IS NOT NULL
  ORDER BY d.created_at DESC, d.id DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.clicksign_sale_contrato(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_contrato(uuid) TO service_role;

-- Configuração para a TELA da venda (sem segredo e sem e-mail). enabled=false esconde tudo.
CREATE FUNCTION public.clicksign_sale_config(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _s public.clicksign_org_settings%ROWTYPE;
  _sale public.sales%ROWTYPE; _can boolean; _doc uuid;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL THEN RETURN jsonb_build_object('enabled', false); END IF;
  SELECT * INTO _s FROM public.clicksign_org_settings WHERE organization_id = _org;
  IF NOT FOUND OR NOT _s.enabled OR _s.access_token_secret_id IS NULL THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  SELECT * INTO _sale FROM public.sales WHERE id = _id AND organization_id = _org;
  IF NOT FOUND OR NOT coalesce(public.can_view_sale(auth.uid(), _id), false) THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;
  _can := public.clicksign_sender_ok(auth.uid());
  _doc := public.clicksign_sale_contrato(_id);
  RETURN jsonb_build_object(
    'enabled', true,
    'test_mode', _s.test_mode,
    'can_send', _can,
    'witnesses', 2,
    'deadline_days', _s.deadline_days,
    'libera_assinatura', _sale.contrato_libera_assinatura IS DISTINCT FROM false,
    'contrato', (SELECT jsonb_build_object('id', d.id, 'file_name', d.file_name,
        'created_at', d.created_at) FROM public.sale_documents d WHERE d.id = _doc),
    'imobiliaria', CASE WHEN _can THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', v.id, 'nome', v.nome) ORDER BY v.nome)
      FROM public.clicksign_imobiliaria_signers(_org) v), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'corretores', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', p.nome,
        'email_ok', nullif(trim(coalesce(p.email, '')), '') IS NOT NULL) ORDER BY p.nome)
      FROM public.sale_corretores(_id) c JOIN public.profiles p ON p.id = c), '[]'::jsonb),
    'envelope', (SELECT jsonb_build_object('status', e.status, 'is_test', e.is_test,
        'created_at', e.created_at, 'error_code', e.error_code,
        'signed', e.signed_document_id IS NOT NULL,
        'last_event', e.last_event,
        'last_notified_at', e.last_notified_at,
        'notify_available_at', e.last_notified_at + interval '10 minutes',
        'cancel_requested_at', e.cancel_requested_at,
        'cancel_reason', e.cancel_reason,
        'contrato_atual', e.source_document_id IS NOT DISTINCT FROM _doc)
      FROM public.clicksign_envelopes e WHERE e.sale_id = _id AND e.organization_id = _org
      ORDER BY e.created_at DESC LIMIT 1));
END $$;
REVOKE ALL ON FUNCTION public.clicksign_sale_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_config(uuid) TO authenticated;

-- Autorização do ENVIO da venda. Devolve {org, contrato}; falha = exceção com mensagem clara.
CREATE FUNCTION public.clicksign_sale_authorize(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _sale public.sales%ROWTYPE; _doc uuid;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_sender_ok(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas gestor, jurídico ou admin da imobiliária pode enviar pela Clicksign';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clicksign_org_settings s WHERE s.organization_id = _org
      AND s.enabled AND s.access_token_secret_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Envio pela Clicksign não está habilitado para esta imobiliária';
  END IF;
  SELECT * INTO _sale FROM public.sales WHERE id = _id AND organization_id = _org;
  IF NOT FOUND OR NOT coalesce(public.can_view_sale(auth.uid(), _id), false) THEN
    RAISE EXCEPTION 'Venda não disponível';
  END IF;
  -- contrato_conferencia_gestor = atalho "Enviar direto para assinatura" do gestor (t_2284ea8b): mesma
  -- regra do fluxo manual (gestor/team leader/admin; o jurídico não pula a conferência).
  IF NOT (_sale.status::text = 'contrato_ok_corretor'
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
  RETURN jsonb_build_object('org', _org, 'contrato', _doc);
END $$;
REVOKE ALL ON FUNCTION public.clicksign_sale_authorize(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_authorize(uuid) TO authenticated;

-- Autorização para gerenciar/cancelar o envelope em assinatura da venda. Devolve {org, envelope}.
CREATE FUNCTION public.clicksign_sale_manage_authorize(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_sender_ok(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas gestor, jurídico ou admin da imobiliária pode gerenciar a assinatura';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clicksign_org_settings s WHERE s.organization_id = _org
      AND s.enabled AND s.access_token_secret_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Clicksign não está habilitada para esta imobiliária';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE id = _id AND organization_id = _org)
     OR NOT coalesce(public.can_view_sale(auth.uid(), _id), false) THEN
    RAISE EXCEPTION 'Venda não disponível';
  END IF;
  SELECT * INTO _e FROM public.clicksign_envelopes e
    WHERE e.sale_id = _id AND e.organization_id = _org ORDER BY e.created_at DESC LIMIT 1;
  IF NOT FOUND OR _e.status <> 'running' OR _e.envelope_key IS NULL OR _e.document_key IS NULL THEN
    RAISE EXCEPTION 'Não há contrato em assinatura na Clicksign para esta venda';
  END IF;
  RETURN jsonb_build_object('org', _org, 'envelope', _e.id);
END $$;
REVOKE ALL ON FUNCTION public.clicksign_sale_manage_authorize(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_manage_authorize(uuid) TO authenticated;

-- Partes extras "do sistema": corretores da org e parceiros já cadastrados (com e-mail). A tela
-- recebe só ref, nome e e-mail mascarado; o servidor resolve o e-mail pela ref no envio.
CREATE FUNCTION public.clicksign_sale_extra_candidates(_id uuid, _q text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id();
  _like text := '%' || replace(replace(coalesce(trim(_q), ''), '%', ''), '_', '') || '%';
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT public.clicksign_sender_ok(auth.uid())
     OR NOT EXISTS (SELECT 1 FROM public.sales WHERE id = _id AND organization_id = _org)
     OR NOT coalesce(public.can_view_sale(auth.uid(), _id), false) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((SELECT jsonb_agg(t.x ORDER BY t.x->>'tipo', t.x->>'nome') FROM (
    (SELECT jsonb_build_object('ref', 'corretor:' || p.id, 'tipo', 'corretor', 'nome', p.nome,
      'email', public.clicksign_mask_email(p.email)) AS x
    FROM public.profiles p
    JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
    WHERE p.ativo IS TRUE AND nullif(trim(coalesce(p.email, '')), '') IS NOT NULL
      AND nullif(trim(coalesce(p.nome, '')), '') IS NOT NULL AND p.nome ILIKE _like
    ORDER BY p.nome LIMIT 20)
    UNION ALL
    (SELECT pa.x FROM (
      SELECT DISTINCT ON (lower(trim(op.email))) jsonb_build_object('ref', 'parceiro:' || op.id,
        'tipo', 'parceiro', 'nome', op.nome, 'email', public.clicksign_mask_email(op.email)) AS x
      FROM public.occurrence_partners op
      WHERE op.organization_id = _org AND nullif(trim(coalesce(op.email, '')), '') IS NOT NULL
        AND nullif(trim(coalesce(op.nome, '')), '') IS NOT NULL AND op.nome ILIKE _like
      ORDER BY lower(trim(op.email)), op.created_at DESC) pa LIMIT 20)
    UNION ALL
    (SELECT jsonb_build_object('ref', 'parceria:' || s.id, 'tipo', 'parceiro', 'nome', s.parceria_nome,
      'email', public.clicksign_mask_email(s.parceria_email))
    FROM public.sales s
    WHERE s.id = _id AND nullif(trim(coalesce(s.parceria_email, '')), '') IS NOT NULL
      AND nullif(trim(coalesce(s.parceria_nome, '')), '') IS NOT NULL AND s.parceria_nome ILIKE _like)
  ) t), '[]'::jsonb);
END $$;

-- "ed***@example.com" (nunca o e-mail inteiro para a tela).
CREATE FUNCTION public.clicksign_mask_email(_e text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN position('@' IN coalesce(trim(_e), '')) > 1
    THEN left(lower(trim(_e)), least(2, position('@' IN trim(_e)) - 1)) || '***'
      || substr(lower(trim(_e)), position('@' IN trim(_e)))
    ELSE '' END
$$;
REVOKE ALL ON FUNCTION public.clicksign_mask_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_mask_email(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.clicksign_sale_extra_candidates(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_extra_candidates(uuid, text) TO authenticated;

-- Passo "Documento assinado" da venda: quem assinou (nome e papel, sem e-mail), quando fechou e se a
-- venda foi marcada sozinha. NULL = o contrato_assinado atual não veio da Clicksign.
CREATE FUNCTION public.clicksign_sale_signed(_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('document_id', d.id, 'is_test', e.is_test, 'closed_at', e.updated_at,
    'auto_marked', e.last_event = 'document_closed',
    'signers', coalesce((SELECT jsonb_agg(jsonb_build_object('papel', x->>'papel',
        'label', x->>'label', 'nome', x->>'nome')) FROM jsonb_array_elements(e.signers) x), '[]'::jsonb))
  FROM public.clicksign_envelopes e
  JOIN public.sale_documents d ON d.id = e.signed_document_id AND d.tipo = 'contrato_assinado'
    AND d.deleted_at IS NULL
  WHERE e.sale_id = _id AND e.organization_id = public.current_org_id()
    AND auth.uid() IS NOT NULL AND public.can_view_sale(auth.uid(), _id)
  ORDER BY e.updated_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.clicksign_sale_signed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_signed(uuid) TO authenticated;

-- ===== Somente service_role (edge functions clicksign-sale e clicksign-webhook) =====

-- Dados das partes extras "do sistema" pela ref escolhida na tela (sempre da mesma org).
CREATE FUNCTION public.clicksign_sale_resolve_extras(_org uuid, _sale uuid, _refs text[])
RETURNS TABLE (ref text, nome text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT 'corretor:' || p.id, p.nome, lower(trim(p.email))
  FROM public.profiles p
  JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
  WHERE p.ativo IS TRUE AND ('corretor:' || p.id) = ANY (_refs)
  UNION ALL
  SELECT 'parceiro:' || op.id, op.nome, lower(trim(op.email))
  FROM public.occurrence_partners op
  WHERE op.organization_id = _org AND ('parceiro:' || op.id) = ANY (_refs)
  UNION ALL
  SELECT 'parceria:' || s.id, s.parceria_nome, lower(trim(s.parceria_email))
  FROM public.sales s
  WHERE s.id = _sale AND s.organization_id = _org AND ('parceria:' || s.id) = ANY (_refs)
$$;
REVOKE ALL ON FUNCTION public.clicksign_sale_resolve_extras(uuid, uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_resolve_extras(uuid, uuid, text[]) TO service_role;

-- Troca o status da venda pelo servidor (mesma lógica de change_sale_status: ocorrência ao entrar em
-- ocorrencia_pendente, histórico e log), com a liberação pontual da trigger de transição.
CREATE FUNCTION public.clicksign_sale_set_status(_sale uuid, _to text, _actor uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _prev text;
BEGIN
  SELECT status::text INTO _prev FROM public.sales WHERE id = _sale FOR UPDATE;
  IF _prev IS NULL THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  IF _to = 'ocorrencia_pendente' THEN PERFORM public.criar_ocorrencia_completa(_sale); END IF;
  PERFORM set_config('clicksign.sale', _sale::text, true);
  UPDATE public.sales SET status = _to::public.sale_status WHERE id = _sale;
  PERFORM set_config('clicksign.sale', '', true);
  INSERT INTO public.sale_status_history (sale_id, de, para, autor_id, motivo)
    VALUES (_sale, _prev::public.sale_status, _to::public.sale_status, _actor, _motivo);
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload)
    VALUES (_actor, _sale, 'status_change',
      jsonb_build_object('de', _prev, 'para', _to, 'motivo', _motivo, 'origem', 'clicksign'));
END $$;
REVOKE ALL ON FUNCTION public.clicksign_sale_set_status(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_set_status(uuid, text, uuid, text) TO service_role;

-- Aviso no sino para quem enviou o envelope (sem e-mail no texto).
CREATE FUNCTION public.clicksign_sale_notify(_e public.clicksign_envelopes, _titulo text, _msg text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (user_id, organization_id, sale_id, tipo, titulo, mensagem)
  VALUES (_e.created_by, _e.organization_id, _e.sale_id, 'clicksign', _titulo, _msg)
$$;
REVOKE ALL ON FUNCTION public.clicksign_sale_notify(public.clicksign_envelopes, text, text)
  FROM PUBLIC, anon, authenticated;

-- Envelope ativado: running e venda contrato_ok_corretor → aguardando_assinatura. O envelope JÁ está
-- rodando na Clicksign: se a troca de status for recusada por uma validação da venda, o envelope
-- continua running (não libera reenvio em dobro) e quem enviou é avisado para ajustar a etapa.
CREATE FUNCTION public.clicksign_sale_mark_sent(_envelope uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _st text; _err text;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND OR _e.origem <> 'venda' OR _e.status <> 'sending' OR _e.envelope_key IS NULL THEN
    RAISE EXCEPTION 'Envelope em estado inválido';
  END IF;
  UPDATE public.clicksign_envelopes SET status = 'running', updated_at = now() WHERE id = _envelope;
  SELECT status::text INTO _st FROM public.sales WHERE id = _e.sale_id FOR UPDATE;
  IF _st IN ('contrato_ok_corretor', 'contrato_conferencia_gestor') THEN
    BEGIN
      PERFORM public.clicksign_sale_set_status(_e.sale_id, 'aguardando_assinatura', _e.created_by,
        'Enviado pela Clicksign' || CASE WHEN _e.is_test THEN ' (TESTE)' ELSE '' END);
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
      UPDATE public.clicksign_envelopes SET error_code = left('status_failed:' || _err, 120)
        WHERE id = _envelope;
      PERFORM public.clicksign_sale_notify(_e, 'Clicksign: contrato enviado, etapa não mudou',
        left('O contrato foi enviado pela Clicksign, mas a venda não pôde ir para aguardando assinatura: '
          || _err, 500));
    END;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_sale_mark_sent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_mark_sent(uuid) TO service_role;

-- Envelope cancelado (botão, nova versão ou evento cancel/deadline/refusal do webhook). Idempotente.
-- Se a venda ainda estava aguardando_assinatura, volta para contrato_ok_corretor (gestor reenvia).
-- Retorna: canceled | already.
CREATE FUNCTION public.clicksign_sale_canceled(_envelope uuid, _reason text, _actor uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _st text; _txt text;
BEGIN
  IF _reason NOT IN ('manual','nova_versao','status_mudou','cancel','deadline','refusal') THEN
    RAISE EXCEPTION 'Motivo inválido';
  END IF;
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND OR _e.origem <> 'venda' THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _e.status IN ('canceled','closed','error') THEN RETURN 'already'; END IF;
  UPDATE public.clicksign_envelopes SET status = 'canceled', last_event = _reason,
    action_lock_until = NULL, updated_at = now() WHERE id = _envelope;
  _txt := CASE _reason
    WHEN 'manual' THEN 'Assinatura cancelada na Clicksign'
    WHEN 'nova_versao' THEN 'Assinatura cancelada na Clicksign: o jurídico subiu nova versão do contrato'
    WHEN 'status_mudou' THEN 'Assinatura cancelada na Clicksign: a venda saiu de aguardando assinatura'
    WHEN 'deadline' THEN 'Prazo da assinatura na Clicksign venceu'
    WHEN 'refusal' THEN 'Um signatário recusou a assinatura na Clicksign'
    ELSE 'Assinatura cancelada na Clicksign' END
    || CASE WHEN _e.is_test THEN ' (TESTE)' ELSE '' END;
  SELECT status::text INTO _st FROM public.sales WHERE id = _e.sale_id FOR UPDATE;
  IF _st = 'aguardando_assinatura' THEN
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
  IF _reason <> 'manual' THEN
    PERFORM public.clicksign_sale_notify(_e, 'Clicksign: envie o contrato de novo',
      _txt || '. Quando o contrato estiver pronto, use "Enviar pela Clicksign" de novo.');
  END IF;
  RETURN 'canceled';
END $$;
REVOKE ALL ON FUNCTION public.clicksign_sale_canceled(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_canceled(uuid, text, uuid) TO service_role;

-- Anexa o contrato assinado que chegou pelo webhook e marca a venda como assinada (contrato_assinado
-- → ocorrencia_pendente), na mesma transação. Idempotente pelo lock + signed_document_id.
-- Retorna: attached (anexou e marcou) | attached_only (anexou; marcação falhou ou venda em outra
-- etapa — gestor avisado) | already | stale (contrato trocado ou venda cancelada/arquivada) |
-- manual_exists (já havia assinado anexado à mão depois do envio).
CREATE FUNCTION public.clicksign_sale_attach_signed(_envelope uuid, _path text, _file_name text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE; _st text; _doc uuid; _mime text; _err text;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND OR _e.origem <> 'venda' THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _e.signed_document_id IS NOT NULL THEN RETURN 'already'; END IF;
  SELECT status::text INTO _st FROM public.sales WHERE id = _e.sale_id FOR UPDATE;
  IF _st IS NULL OR _st IN ('cancelada','arquivada')
     OR _e.source_document_id IS DISTINCT FROM public.clicksign_sale_contrato(_e.sale_id) THEN
    UPDATE public.clicksign_envelopes SET status = 'closed', last_event = 'stale', updated_at = now()
      WHERE id = _envelope;
    RETURN 'stale';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sale_documents d WHERE d.sale_id = _e.sale_id
      AND d.tipo = 'contrato_assinado' AND d.deleted_at IS NULL AND d.created_at >= _e.created_at) THEN
    UPDATE public.clicksign_envelopes SET status = 'closed', last_event = 'manual_exists',
      updated_at = now() WHERE id = _envelope;
    RETURN 'manual_exists';
  END IF;
  IF _path !~ ('^' || _e.organization_id::text || '/' || _e.sale_id::text
                || '/outros/contrato_assinado/[0-9a-f-]{36}[.]pdf$')
     OR _file_name IS NULL OR length(trim(_file_name)) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'Documento inválido';
  END IF;
  SELECT metadata->>'mimetype' INTO _mime FROM storage.objects
    WHERE bucket_id = 'sale-documents' AND name = _path;
  IF _mime IS DISTINCT FROM 'application/pdf' THEN RAISE EXCEPTION 'Arquivo ausente ou formato inválido'; END IF;
  INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, uploaded_by,
      status, descricao)
    VALUES (_e.sale_id, 'contrato_assinado', 'outros', _path, trim(_file_name), _e.created_by,
      'enviado', 'Assinado pela Clicksign' || CASE WHEN _e.is_test THEN ' (TESTE)' ELSE '' END)
    RETURNING id INTO _doc;
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload)
    VALUES (_e.created_by, _e.sale_id, 'document_uploaded', jsonb_build_object('tipo',
      'contrato_assinado', 'parte', 'outros', 'origem', 'clicksign', 'teste', _e.is_test));
  UPDATE public.clicksign_envelopes SET status = 'closed', signed_document_id = _doc,
    last_event = 'attached_only', updated_at = now() WHERE id = _envelope;
  IF _st <> 'aguardando_assinatura' THEN
    PERFORM public.clicksign_sale_notify(_e, 'Clicksign: contrato assinado anexado',
      'Todos assinaram e o contrato assinado foi anexado. A venda não estava aguardando assinatura; confira e marque manualmente.');
    RETURN 'attached_only';
  END IF;
  BEGIN
    PERFORM public.clicksign_sale_set_status(_e.sale_id, 'contrato_assinado', _e.created_by,
      'Automático: todos assinaram na Clicksign' || CASE WHEN _e.is_test THEN ' (TESTE)' ELSE '' END);
    PERFORM public.clicksign_sale_set_status(_e.sale_id, 'ocorrencia_pendente', _e.created_by,
      'Automático: contrato assinado');
    UPDATE public.clicksign_envelopes SET last_event = 'document_closed' WHERE id = _envelope;
    RETURN 'attached';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS _err = MESSAGE_TEXT;
    UPDATE public.clicksign_envelopes SET error_code = left('mark_failed:' || _err, 120)
      WHERE id = _envelope;
    PERFORM public.clicksign_sale_notify(_e, 'Clicksign: marque o contrato como assinado',
      left('Todos assinaram e o contrato assinado foi anexado, mas a venda não pôde ser marcada sozinha: '
        || _err || '. Corrija e use "Marcar contrato assinado".', 500));
    RETURN 'attached_only';
  END;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_sale_attach_signed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_attach_signed(uuid, text, text) TO service_role;

-- Gestão (reenviar aviso/editar signatário): histórico da venda vai para activity_logs.
CREATE OR REPLACE FUNCTION public.clicksign_manage_done(_envelope uuid, _actor uuid, _action text,
  _detail text DEFAULT NULL, _signers jsonb DEFAULT NULL, _notified boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.clicksign_envelopes WHERE id = _envelope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Envelope inexistente'; END IF;
  IF _action IS NOT NULL AND _action NOT IN ('clicksign_aviso','clicksign_signatario') THEN
    RAISE EXCEPTION 'Ação inválida';
  END IF;
  IF _signers IS NOT NULL AND (jsonb_typeof(_signers) <> 'array'
      OR jsonb_array_length(_signers) <> jsonb_array_length(_e.signers) OR _signers::text ~ '@') THEN
    RAISE EXCEPTION 'Signatários inválidos';
  END IF;
  IF _detail IS NOT NULL AND (length(_detail) > 500 OR _detail ~ '@') THEN
    RAISE EXCEPTION 'Detalhe inválido';
  END IF;
  UPDATE public.clicksign_envelopes SET
    action_lock_until = NULL,
    signers = coalesce(_signers, signers),
    last_notified_at = CASE WHEN _notified THEN now() ELSE last_notified_at END,
    error_code = CASE WHEN _notified AND error_code LIKE 'notify_failed:%' THEN NULL ELSE error_code END,
    updated_at = now()
  WHERE id = _envelope;
  IF _action IS NOT NULL THEN
    IF _e.origem = 'venda' THEN
      INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload)
        VALUES (coalesce(_actor, _e.created_by), _e.sale_id, _action,
          jsonb_build_object('detalhe', _detail));
    ELSE
      INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
        VALUES (_e.capture_id, coalesce(_actor, _e.created_by), _action, _detail);
    END IF;
  END IF;
END $$;

-- ===== 5) Envelope aberto com nova versão do contrato ou venda saindo da assinatura =====
CREATE FUNCTION public.clicksign_sale_request_cancel(_sale uuid, _reason text, _keep_doc uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  FOR _e IN SELECT * FROM public.clicksign_envelopes
      WHERE sale_id = _sale AND status IN ('sending','running') AND cancel_requested_at IS NULL
        AND source_document_id IS DISTINCT FROM _keep_doc FOR UPDATE LOOP
    UPDATE public.clicksign_envelopes SET cancel_requested_at = now(), cancel_reason = _reason,
      updated_at = now() WHERE id = _e.id;
    PERFORM public.clicksign_sale_notify(_e, 'Clicksign: assinatura será cancelada',
      CASE _reason WHEN 'nova_versao'
        THEN 'O jurídico subiu nova versão do contrato. O envelope aberto na Clicksign será cancelado; envie o contrato novo pela Clicksign.'
        ELSE 'A venda saiu de aguardando assinatura. O envelope aberto na Clicksign será cancelado.' END);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.clicksign_sale_request_cancel(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.trg_clicksign_sale_contrato_novo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.clicksign_sale_request_cancel(NEW.sale_id, 'nova_versao', NEW.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_clicksign_sale_contrato_novo() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_zz_clicksign_contrato_novo AFTER INSERT ON public.sale_documents
  FOR EACH ROW WHEN (NEW.tipo = 'contrato') EXECUTE FUNCTION public.trg_clicksign_sale_contrato_novo();

CREATE FUNCTION public.trg_clicksign_sale_saiu_assinatura() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('clicksign.sale', true) IS DISTINCT FROM OLD.id::text THEN
    PERFORM public.clicksign_sale_request_cancel(OLD.id, 'status_mudou', NULL);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_clicksign_sale_saiu_assinatura() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_zz_clicksign_saiu_assinatura AFTER UPDATE OF status ON public.sales
  FOR EACH ROW WHEN (OLD.status::text = 'aguardando_assinatura'
    AND NEW.status::text NOT IN ('aguardando_assinatura','contrato_assinado'))
  EXECUTE FUNCTION public.trg_clicksign_sale_saiu_assinatura();

-- ===== 3) Liberação pontual da trigger de transição (cópia de 20261009070000 + bloco Clicksign) =====
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

-- ===== 7) E-mail do parceiro também pelas RPCs da ocorrência (t_2284ea8b) =====
-- Cópia das versões vigentes (20260823000000 e 20260902203000) com occurrence_partners.email vindo de
-- sales.parceria_email. Mesma assinatura e mesmo SECURITY: CREATE OR REPLACE mantém os GRANTs.
CREATE OR REPLACE FUNCTION public.criar_ocorrencia_completa(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_sale sales%rowtype;
  v_payment sale_payment%rowtype;
  v_vendedor_nome text;
  v_comprador_nome text;
  v_occ_id uuid;
  v_dist jsonb;
begin
  -- O lock por venda serializa cliques/requisições concorrentes e, junto da UNIQUE(sale_id),
  -- impede ocorrência duplicada até quando duas ações chegam praticamente ao mesmo tempo.
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.status::text in ('cancelada', 'arquivada') then
    raise exception 'Não é possível criar Ocorrência para uma venda cancelada ou arquivada.' using errcode = '23514';
  end if;

  -- Valida também quando a ocorrência já existe: enviar ao Financeiro nunca pode contornar
  -- uma inconsistência surgida depois da criação inicial.
  v_dist := calcular_distribuicao_venda(v_sale);
  if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível criar ou sincronizar a Ocorrência: %', (
      select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
    ) using errcode = '23514';
  end if;

  select id into v_occ_id from occurrences where sale_id = p_sale_id;
  if v_occ_id is not null then
    -- sync_occurrence_commissions preserva linhas manuais do Financeiro
    -- (managed_by_sale = false) e atualiza somente as gerenciadas pela venda.
    perform sync_occurrence_commissions(p_sale_id);
    return jsonb_build_object('occurrence_id', v_occ_id, 'created', false);
  end if;

  select * into v_payment from sale_payment where sale_id = p_sale_id;
  select nome into v_vendedor_nome from sale_parties where sale_id = p_sale_id and papel = 'vendedor_1';
  select nome into v_comprador_nome from sale_parties where sale_id = p_sale_id and papel = 'comprador_1';

  insert into occurrences (
    sale_id, codigo_imovel, data_assinatura, tempo_venda_dias, midia,
    valor_anunciado, valor_negociado, percentual_comissao, valor_comissao,
    financiamento, financiamento_valor, financiamento_banco, financiamento_correspondente, financiamento_previsao, oba_credito,
    prev_recebimento_valor, prev_recebimento_data, prev_recebimento_forma,
    prev_recebimento2_valor, prev_recebimento2_data, prev_recebimento2_forma,
    prev_recebimento3_valor, prev_recebimento3_data, prev_recebimento3_forma,
    observacoes, status
  ) values (
    p_sale_id, coalesce(v_sale.imovel_id, v_sale.codigo_interno), coalesce(v_sale.data_assinatura, current_date), v_sale.tempo_venda_dias, v_sale.midia,
    v_sale.valor_anunciado, v_sale.valor_negociado, v_sale.percentual_comissao,
    coalesce((v_dist->>'comissao_bruta')::numeric, v_sale.valor_total_comissao),
    coalesce(v_payment.financiamento, false), v_payment.financiamento_valor, v_payment.financiamento_banco, v_payment.financiamento_correspondente, v_payment.financiamento_previsao, coalesce(v_payment.oba_credito, false),
    v_sale.previsao_recebimento_valor, v_sale.previsao_recebimento_data, v_sale.previsao_recebimento_forma,
    v_sale.previsao_recebimento2_valor, v_sale.previsao_recebimento2_data, v_sale.previsao_recebimento2_forma,
    v_sale.previsao_recebimento3_valor, v_sale.previsao_recebimento3_data, v_sale.previsao_recebimento3_forma,
    nullif(concat_ws(' | ',
      case when v_vendedor_nome is not null then 'Vendedor/Proprietário: ' || v_vendedor_nome end,
      case when v_comprador_nome is not null then 'Comprador: ' || v_comprador_nome end
    ), ''),
    'pendente'
  )
  returning id into v_occ_id;

  perform sync_occurrence_commissions(p_sale_id);

  if v_sale.parceria_tipo is not null then
    insert into occurrence_partners (occurrence_id, from_sale, tipo, nome, email, cpf_cnpj, percentual, valor, banco, agencia, conta, pix)
    values (v_occ_id, true, v_sale.parceria_tipo, v_sale.parceria_nome, nullif(trim(coalesce(v_sale.parceria_email, '')), ''), v_sale.parceria_cpf_cnpj, v_sale.parceria_percentual, v_sale.parceria_valor, v_sale.parceria_banco, v_sale.parceria_agencia, v_sale.parceria_conta, v_sale.parceria_pix);
  end if;

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'occurrence_created', jsonb_build_object('occurrence_id', v_occ_id, 'automatic', true));

  return jsonb_build_object('occurrence_id', v_occ_id, 'created', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sincronizar_ocorrencia_antes_financeiro(p_sale_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale public.sales%rowtype;
  v_payment public.sale_payment%rowtype;
  v_occ_id uuid;
begin
  select * into v_sale
  from public.sales
  where id = p_sale_id;

  if not found
     or v_sale.modalidade = 'lancamento'
     or v_sale.status::text not in (
       'aguardando_assinatura',
       'contrato_assinado',
       'ocorrencia_pendente',
       'ocorrencia_devolvida_gestor'
     ) then
    return;
  end if;

  select id into v_occ_id
  from public.occurrences
  where sale_id = p_sale_id
    and status = 'pendente';

  if v_occ_id is null then
    return;
  end if;

  select * into v_payment
  from public.sale_payment
  where sale_id = p_sale_id;

  update public.occurrences
  set
    valor_anunciado = v_sale.valor_anunciado,
    valor_negociado = v_sale.valor_negociado,
    percentual_comissao = v_sale.percentual_comissao,
    valor_comissao = coalesce(
      v_sale.valor_total_comissao,
      case
        when v_sale.valor_negociado is not null and v_sale.percentual_comissao is not null
          then round(v_sale.valor_negociado * v_sale.percentual_comissao / 100, 2)
        else null
      end
    ),
    prev_recebimento_valor = v_sale.previsao_recebimento_valor,
    prev_recebimento_data = v_sale.previsao_recebimento_data,
    prev_recebimento_forma = v_sale.previsao_recebimento_forma,
    prev_recebimento2_valor = v_sale.previsao_recebimento2_valor,
    prev_recebimento2_data = v_sale.previsao_recebimento2_data,
    prev_recebimento2_forma = v_sale.previsao_recebimento2_forma,
    prev_recebimento3_valor = v_sale.previsao_recebimento3_valor,
    prev_recebimento3_data = v_sale.previsao_recebimento3_data,
    prev_recebimento3_forma = v_sale.previsao_recebimento3_forma,
    financiamento = coalesce(v_payment.financiamento, false),
    financiamento_valor = v_payment.financiamento_valor,
    financiamento_banco = v_payment.financiamento_banco,
    financiamento_correspondente = v_payment.financiamento_correspondente,
    financiamento_previsao = v_payment.financiamento_previsao,
    oba_credito = coalesce(v_payment.oba_credito, false)
  where id = v_occ_id;

  perform public.sync_occurrence_commissions(p_sale_id);

  if v_sale.parceria_tipo is null then
    delete from public.occurrence_partners
    where occurrence_id = v_occ_id
      and from_sale = true;
  else
    update public.occurrence_partners
    set
      tipo = v_sale.parceria_tipo,
      nome = v_sale.parceria_nome,
      -- Venda sem e-mail (legado) não apaga o que o Financeiro já preencheu.
      email = coalesce(nullif(trim(coalesce(v_sale.parceria_email, '')), ''), email),
      cpf_cnpj = v_sale.parceria_cpf_cnpj,
      percentual = v_sale.parceria_percentual,
      valor = v_sale.parceria_valor
    where occurrence_id = v_occ_id
      and from_sale = true;

    if not found then
      insert into public.occurrence_partners (
        occurrence_id, from_sale, tipo, nome, email, cpf_cnpj, percentual, valor,
        banco, agencia, conta, pix
      ) values (
        v_occ_id, true, v_sale.parceria_tipo, v_sale.parceria_nome,
        nullif(trim(coalesce(v_sale.parceria_email, '')), ''),
        v_sale.parceria_cpf_cnpj, v_sale.parceria_percentual, v_sale.parceria_valor,
        v_sale.parceria_banco, v_sale.parceria_agencia, v_sale.parceria_conta,
        v_sale.parceria_pix
      );
    end if;
  end if;
end;
$function$;

NOTIFY pgrst, 'reload schema';
