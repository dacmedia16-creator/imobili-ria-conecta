-- Clicksign: o corretor que já vê a captação/venda ACOMPANHA a assinatura (só leitura: lista de
-- signatários com status, e-mail mascarado e "faltam N"). Cartão t_82e51349; aprovado por Denis em
-- 28/10/2026 ("sim libera para ele acompanhar"). Rollback:
-- supabase/rollback/20261028180000_clicksign_acompanhar_corretor.sql
--
-- Só LEITURA. Nada de escrita muda: reenviar aviso, editar signatário, cancelar/trocar para papel e
-- "Conferir na Clicksign" seguem em clicksign_manage_authorize / clicksign_sale_manage_authorize /
-- clicksign_reconcile_authorize (sender_ok), sem alteração.
--
-- As duas RPCs abaixo são chamadas pelas edges clicksign-manage e clicksign-sale SOMENTE na ação
-- "status" (com o JWT do usuário). Devolvem org, envelope e can_manage; a edge consulta a Clicksign
-- com o token da org (que nunca sai do servidor) e devolve à tela apenas nome, papel, status e e-mail
-- mascarado. Telefone, e-mail completo e token não saem. can_manage = false faz a edge marcar todos
-- os signatários como não editáveis.
-- Quem pode ver: o mesmo que já abre a tela (exclusive_can_view / can_view_sale) ou quem já gerencia;
-- sempre na organização do contexto (current_org_id) e com envelope em assinatura (running).

CREATE FUNCTION public.clicksign_capture_view_authorize(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _c public.exclusive_captures%ROWTYPE;
  _e public.clicksign_envelopes%ROWTYPE; _manage boolean;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL THEN
    RAISE EXCEPTION 'Sem acesso a esta captação';
  END IF;
  _manage := coalesce(public.clicksign_capture_sender_ok(auth.uid(), _id), false);
  IF NOT _manage AND NOT coalesce(public.exclusive_can_view(_id, auth.uid()), false) THEN
    RAISE EXCEPTION 'Sem acesso a esta captação';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clicksign_org_settings s WHERE s.organization_id = _org
      AND s.enabled AND s.access_token_secret_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Clicksign não está habilitada para esta imobiliária';
  END IF;
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _id AND organization_id = _org;
  IF NOT FOUND OR _c.archived_at IS NOT NULL OR _c.discarded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Captação não disponível';
  END IF;
  SELECT * INTO _e FROM public.clicksign_envelopes e
    WHERE e.capture_id = _id AND e.organization_id = _org ORDER BY e.created_at DESC LIMIT 1;
  IF NOT FOUND OR _e.status <> 'running' OR _e.envelope_key IS NULL OR _e.document_key IS NULL THEN
    RAISE EXCEPTION 'Não há contrato em assinatura na Clicksign para esta captação';
  END IF;
  RETURN jsonb_build_object('org', _org, 'envelope', _e.id, 'can_manage', _manage);
END $$;
REVOKE ALL ON FUNCTION public.clicksign_capture_view_authorize(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_capture_view_authorize(uuid) TO authenticated;

CREATE FUNCTION public.clicksign_sale_view_authorize(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _e public.clicksign_envelopes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.sales WHERE id = _id AND organization_id = _org)
     OR NOT coalesce(public.can_view_sale(auth.uid(), _id), false) THEN
    RAISE EXCEPTION 'Venda não disponível';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clicksign_org_settings s WHERE s.organization_id = _org
      AND s.enabled AND s.sale_enabled AND s.access_token_secret_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Clicksign não está habilitada para esta imobiliária';
  END IF;
  SELECT * INTO _e FROM public.clicksign_envelopes e
    WHERE e.sale_id = _id AND e.organization_id = _org ORDER BY e.created_at DESC LIMIT 1;
  IF NOT FOUND OR _e.status <> 'running' OR _e.envelope_key IS NULL OR _e.document_key IS NULL THEN
    RAISE EXCEPTION 'Não há contrato em assinatura na Clicksign para esta venda';
  END IF;
  RETURN jsonb_build_object('org', _org, 'envelope', _e.id,
    'can_manage', coalesce(public.clicksign_sender_ok(auth.uid()), false));
END $$;
REVOKE ALL ON FUNCTION public.clicksign_sale_view_authorize(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_view_authorize(uuid) TO authenticated;
