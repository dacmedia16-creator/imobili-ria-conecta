-- Rollback de 20261122120100_papel_locacao (card t_1fe07126).
-- Volta os corpos em produção antes da migration (copiados da homologação, md5 igual ao de produção em 12/11/2026)
-- e remove a barreira do só-Locação. ANTES: tire o papel 'locacao' de quem o tem sozinho (ou dê o papel anterior),
-- senão essa pessoa passa a ser tratada como usuário sem papel (Início vazio, sem Locação).
DO $$ DECLARE _t text; BEGIN
  FOR _t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'zz_locacao_fora' LOOP
    EXECUTE format('DROP POLICY IF EXISTS zz_locacao_fora ON public.%I', _t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.academia_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'academia'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$
;

CREATE OR REPLACE FUNCTION public.exclusive_capture_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'captacao_exclusiva'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$
;

CREATE OR REPLACE FUNCTION public.is_active_user(_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _in boolean := public.mt_in_ctx_org(_user);
BEGIN
  IF current_setting('mt.ctx_pc',true)='1' AND _user=auth.uid() THEN
    RETURN public.mt_1b_gate() AND coalesce(_in,false);
  END IF;
  IF public.eh_so_fotografo(_user) THEN RETURN false; END IF; -- t_0666d3f0: só-fotógrafo fica fora
  RETURN (SELECT COALESCE((SELECT _user IS NOT NULL AND
    COALESCE((SELECT ativo FROM public.profiles WHERE id=_user),true)),false)
    AND public.mt_1b_gate() AND ((_in
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id=_user AND ativo IS TRUE))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END $function$
;

CREATE OR REPLACE FUNCTION public.leads_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'leads'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$
;

CREATE OR REPLACE FUNCTION public.list_room_occupancy()
 RETURNS TABLE(id uuid, reservation_group_id uuid, room text, reserved_date date, start_time time without time zone, end_time time without time zone, responsible_id uuid, responsible_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.id, r.reservation_group_id, r.room, r.reserved_date, r.start_time, r.end_time,
         r.responsible_id, COALESCE(NULLIF(btrim(p.nome), ''), r.responsible_name)
  FROM public.room_reservations r
  LEFT JOIN public.profiles p ON p.id = r.responsible_id AND p.organization_id = r.organization_id
  WHERE r.status = 'confirmed'
    AND public.is_active_user(auth.uid())
    AND r.organization_id = public.current_org_id()
  ORDER BY r.reserved_date, r.start_time;
$function$
;

CREATE OR REPLACE FUNCTION public.locacao_criar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['corretor', 'gestor', 'team_leader', 'admin', 'super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Só corretores criam locações.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.locacoes (organization_id, corretor_id) VALUES (_org, auth.uid()) RETURNING * INTO _l;
  PERFORM public.locacao_evento(_l, 'corretor', 'Pré-análise iniciada');
  RETURN jsonb_build_object('id', _l.id);
END $function$
;

CREATE OR REPLACE FUNCTION public.locacao_ctx()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(auth.uid()), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF NOT public.locacao_enabled() THEN
    RAISE EXCEPTION 'Locação desligada nesta imobiliária.' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $function$
;

CREATE OR REPLACE FUNCTION public.opportunities_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'oportunidades'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$
;

CREATE OR REPLACE FUNCTION public.owner_feedback_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'feedback_proprietario'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
$function$
;

CREATE OR REPLACE FUNCTION public.proposta_compra_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.current_org_id() IS NOT NULL AND public.proposta_compra_modulo_ligado(public.current_org_id())
    AND NOT coalesce(public.eh_so_fotografo(auth.uid()), false)
$function$
;

CREATE OR REPLACE FUNCTION public.push_inscrever(_endpoint text, _p256dh text, _auth text, _aparelho text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _id uuid;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT public.is_active_user(_me) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF _endpoint IS NULL OR _endpoint !~ '^https://' OR length(_endpoint) > 1000
     OR length(coalesce(_p256dh, '')) NOT BETWEEN 20 AND 200 OR length(coalesce(_auth, '')) NOT BETWEEN 8 AND 100 THEN
    RAISE EXCEPTION 'Inscrição inválida' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.push_subscriptions WHERE user_id = _me AND endpoint <> _endpoint) >= 10 THEN
    RAISE EXCEPTION 'Limite de 10 aparelhos' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth, aparelho)
  VALUES (_org, _me, _endpoint, _p256dh, _auth, left(_aparelho, 200))
  ON CONFLICT (endpoint) DO UPDATE SET organization_id = EXCLUDED.organization_id, user_id = EXCLUDED.user_id,
    p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, aparelho = EXCLUDED.aparelho, falhas = 0
  RETURNING id INTO _id;
  RETURN _id;
END $function$
;

CREATE OR REPLACE FUNCTION public.sistemas_ligados()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN ARRAY[]::text[]
    WHEN public.is_platform_super_admin(auth.uid()) THEN ARRAY['visita', 'estudo', 'academia', 'sessenta']
    ELSE coalesce((
      SELECT array_agg(m.module ORDER BY m.module)
        FROM public.organization_modules m
       WHERE m.organization_id = public.current_org_id()
         AND m.enabled
         AND m.module IN ('visita', 'estudo', 'academia', 'sessenta')
         AND NOT (m.module = 'academia' AND public.eh_so_fotografo(auth.uid()))
    ), ARRAY[]::text[])
  END
$function$
;

CREATE OR REPLACE FUNCTION public.support_ticket_create(_tipo text, _texto text, _tela_rota text DEFAULT NULL::text, _tela_nome text DEFAULT NULL::text, _user_agent text DEFAULT NULL::text, _print_path text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _uid uuid := auth.uid(); _org uuid; _id uuid; _txt text := btrim(coalesce(_texto, ''));
  _print text := nullif(btrim(coalesce(_print_path, '')), '');
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Faça login para abrir um chamado' USING ERRCODE = '42501'; END IF;
  IF public.mt_pc_context_org() IS NOT NULL THEN
    RAISE EXCEPTION 'Saia do contexto da imobiliária para abrir um chamado' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  IF _org IS NULL OR NOT public.is_active_user(_uid) THEN
    RAISE EXCEPTION 'Usuário sem imobiliária ativa' USING ERRCODE = '42501';
  END IF;
  IF _tipo NOT IN ('erro', 'duvida', 'sugestao') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  IF length(_txt) < 5 THEN RAISE EXCEPTION 'Escreva pelo menos 5 caracteres'; END IF;
  IF length(_txt) > 4000 THEN RAISE EXCEPTION 'Texto muito longo (máximo 4.000 caracteres)'; END IF;
  -- Freio contra envio repetido.
  IF (SELECT count(*) FROM public.support_tickets
       WHERE author_id = _uid AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'Muitos chamados em pouco tempo. Tente de novo mais tarde.';
  END IF;
  IF _print IS NOT NULL THEN
    IF _print !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](png|jpg|jpeg|webp)$'
       OR split_part(_print, '/', 1) <> _org::text OR split_part(_print, '/', 2) <> _uid::text
       OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'support-attachments' AND o.name = _print)
       OR EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.print_path = _print)
    THEN RAISE EXCEPTION 'Print inválido'; END IF;
  END IF;

  INSERT INTO public.support_tickets (organization_id, author_id, tipo, assunto, tela_rota, tela_nome, user_agent, print_path)
  VALUES (_org, _uid, _tipo,
    left(regexp_replace(_txt, '\s+', ' ', 'g'), 120),
    left(nullif(btrim(coalesce(_tela_rota, '')), ''), 300),
    left(nullif(btrim(coalesce(_tela_nome, '')), ''), 120),
    left(nullif(btrim(coalesce(_user_agent, '')), ''), 400),
    _print)
  RETURNING id INTO _id;
  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto)
  VALUES (_id, _org, _uid, false, false, _txt);
  RETURN _id;
END $function$
;

CREATE OR REPLACE FUNCTION public.vouchers_fotos_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.current_org_id() IS NOT NULL AND public.photo_modulo_ligado(public.current_org_id())
$function$
;

DROP FUNCTION IF EXISTS public.so_locacao_ativo(uuid);
DROP FUNCTION IF EXISTS public.eh_so_locacao(uuid);
