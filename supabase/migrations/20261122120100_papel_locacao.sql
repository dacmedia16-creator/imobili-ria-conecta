-- Papel geral "Locação" (card t_1fe07126, tópico 6238), parte B de 2. Decisões de Denis 12/11/2026 (1, 2 e 3 = sim).
-- Quem tem SÓ o papel 'locacao' (nenhum outro papel de agência) enxerga apenas: Início, Locação (com Sugestões e
-- erros e a Ajuda MAX da locação), Reserva de salas, Mural de Conquistas e a própria conta. Mesmo desenho do papel
-- Fotógrafo (20261105130100_papel_fotografo.sql):
--  * is_active_user() devolve false para ele -> has_role/has_any_role e as funções/políticas que dependem deles
--    (vendas, clientes, captações, carreira, metas, rankings, relatórios, ocorrências, painéis) o tratam como fora
--    da agência. Fica fora de rankings, metas e contagens de corretor.
--  * so_locacao_ativo(): o "ativo" que is_active_user daria, só para o próprio só-Locação; liberado apenas onde a
--    área dele precisa: locacao_ctx (todo o módulo Locação), locacao_criar, list_room_occupancy (salas),
--    support_ticket_create (Sugestões e erros / Meus chamados) e push_inscrever (avisos no celular).
--  * Política RESTRICTIVE 'zz_locacao_fora' em toda tabela com RLS que o app lê direto, exceto as da entrada
--    (perfil, papéis, vínculo, imobiliária/módulos, sino, tour, aniversário, chamados) e as da área liberada
--    (salas, mural, push).
--  * Os *_enabled() dos módulos fora da área devolvem false para ele (RPCs SECURITY DEFINER desses módulos recusam).
--    Locação, Reserva de salas e Mural seguem a chave do módulo da imobiliária, como para todos.
-- Quem tem 'locacao' + qualquer outro papel (corretor, gestor...) NÃO muda nada: eh_so_locacao = false.
-- NÃO mexe nos papéis internos da Locação (locacao_papeis: gestora, contratos, vistoria, financeiro).
-- Rollback: docs/sql/rollback/20261122120100_papel_locacao.rollback.sql (corpos de produção conferidos por md5).

-- 1) Quem é "só Locação" --------------------------------------------------------------------------------------------
-- Tem 'locacao' e nenhum papel de agência além dele. O 'fotografo' junto NÃO libera nada (falha fechada): sem esta
-- regra, Locação + Fotógrafo escaparia das duas barreiras e veria tudo. Nesse caso vale a área da Locação.
CREATE OR REPLACE FUNCTION public.eh_so_locacao(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role = 'locacao')
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role NOT IN ('locacao', 'fotografo'))
$$;
REVOKE ALL ON FUNCTION public.eh_so_locacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eh_so_locacao(uuid) TO authenticated, service_role, mt_1b_definer; -- usada pela RLS
COMMENT ON FUNCTION public.eh_so_locacao(uuid)
  IS 'Usuário com papel locacao e nenhum outro papel: só enxerga a área de locação (t_1fe07126).';

-- O "ativo" do só-Locação, só para ele mesmo: perfil ativo, vínculo com a imobiliária do contexto e mt_1b_gate,
-- as mesmas condições do caminho normal de is_active_user.
CREATE OR REPLACE FUNCTION public.so_locacao_ativo(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(_uid IS NOT NULL AND _uid = auth.uid()
    AND public.eh_so_locacao(_uid)
    AND public.mt_1b_gate()
    AND public.mt_in_ctx_org(_uid)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.ativo IS TRUE), false)
$$;
REVOKE ALL ON FUNCTION public.so_locacao_ativo(uuid) FROM PUBLIC, anon, authenticated;
-- mt_1b_definer: dono de list_room_occupancy (precisa chamar esta função de dentro dela).
GRANT EXECUTE ON FUNCTION public.so_locacao_ativo(uuid) TO service_role, mt_1b_definer;
COMMENT ON FUNCTION public.so_locacao_ativo(uuid)
  IS 'Só-Locação ativo na imobiliária do contexto (só o próprio usuário). Libera apenas a área de locação (t_1fe07126).';

-- 2) Bloqueio central: o só-Locação não é "usuário ativo da agência" ------------------------------------------------
-- Corpo em produção (20261105130100_papel_fotografo.sql) + "OR public.eh_so_locacao(_user)".
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
  IF public.eh_so_locacao(_user) THEN RETURN false; END IF; -- t_1fe07126: só-Locação fica fora (área própria abaixo)
  RETURN (SELECT COALESCE((SELECT _user IS NOT NULL AND
    COALESCE((SELECT ativo FROM public.profiles WHERE id=_user),true)),false)
    AND public.mt_1b_gate() AND ((_in
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id=_user AND ativo IS TRUE))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END $function$;

-- 3) Área liberada ----------------------------------------------------------------------------------------------------
-- 3a) Locação: todas as RPCs do módulo passam por locacao_ctx.
CREATE OR REPLACE FUNCTION public.locacao_ctx()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF auth.uid() IS NULL OR _org IS NULL
     OR NOT (coalesce(public.is_active_user(auth.uid()), false) OR public.so_locacao_ativo(auth.uid())) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF NOT public.locacao_enabled() THEN
    RAISE EXCEPTION 'Locação desligada nesta imobiliária.' USING ERRCODE = '42501';
  END IF;
  RETURN _org;
END $function$;

-- O pessoal da locação abre locação nova, como o corretor.
CREATE OR REPLACE FUNCTION public.locacao_criar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes;
BEGIN
  IF NOT (public.has_any_role(auth.uid(), ARRAY['corretor', 'gestor', 'team_leader', 'admin', 'super_admin']::public.app_role[])
          OR public.so_locacao_ativo(auth.uid())) THEN
    RAISE EXCEPTION 'Só corretores criam locações.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.locacoes (organization_id, corretor_id) VALUES (_org, auth.uid()) RETURNING * INTO _l;
  PERFORM public.locacao_evento(_l, 'corretor', 'Pré-análise iniciada');
  RETURN jsonb_build_object('id', _l.id);
END $function$;

-- 3b) Reserva de salas: grade de ocupação.
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
    AND (public.is_active_user(auth.uid()) OR public.so_locacao_ativo(auth.uid()))
    AND r.organization_id = public.current_org_id()
  ORDER BY r.reserved_date, r.start_time;
$function$;

-- 3c) Chamados (Sugestões e erros da Locação, "Ajuda e sugestões" do topo e Meus chamados).
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
  IF _org IS NULL OR NOT (public.is_active_user(_uid) OR public.so_locacao_ativo(_uid)) THEN
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
END $function$;

-- 3d) Avisos no celular (Notificações).
CREATE OR REPLACE FUNCTION public.push_inscrever(_endpoint text, _p256dh text, _auth text, _aparelho text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _id uuid;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT (public.is_active_user(_me) OR public.so_locacao_ativo(_me)) THEN
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
END $function$;

-- 4) Módulos fora da área: desligados para o só-Locação ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exclusive_capture_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'captacao_exclusiva'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
    AND NOT public.eh_so_locacao(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.leads_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'leads'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
    AND NOT public.eh_so_locacao(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.opportunities_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'oportunidades'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
    AND NOT public.eh_so_locacao(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.owner_feedback_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'feedback_proprietario'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
    AND NOT public.eh_so_locacao(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.academia_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'academia'), false)
    AND NOT public.eh_so_fotografo(auth.uid())
    AND NOT public.eh_so_locacao(auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.proposta_compra_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT public.current_org_id() IS NOT NULL AND public.proposta_compra_modulo_ligado(public.current_org_id())
    AND NOT coalesce(public.eh_so_fotografo(auth.uid()), false)
    AND NOT coalesce(public.eh_so_locacao(auth.uid()), false)
$function$;
-- Agendar fotos é da captação: fica fora para o só-Locação (o só-fotógrafo continua vendo o módulo dele).
CREATE OR REPLACE FUNCTION public.vouchers_fotos_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT public.current_org_id() IS NOT NULL AND public.photo_modulo_ligado(public.current_org_id())
    AND NOT coalesce(public.eh_so_locacao(auth.uid()), false)
$function$;
-- Hub: Academia fora também para o só-Locação (Visita/Estudo/60 Dias seguem a sincronização, que não leva
-- o papel 'locacao' a nenhum sistema).
CREATE OR REPLACE FUNCTION public.sistemas_ligados() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN ARRAY[]::text[]
    WHEN public.is_platform_super_admin(auth.uid()) THEN ARRAY['visita', 'estudo', 'academia', 'sessenta']
    ELSE coalesce((
      SELECT array_agg(m.module ORDER BY m.module)
        FROM public.organization_modules m
       WHERE m.organization_id = public.current_org_id()
         AND m.enabled
         AND m.module IN ('visita', 'estudo', 'academia', 'sessenta')
         AND NOT (m.module = 'academia' AND (public.eh_so_fotografo(auth.uid()) OR public.eh_so_locacao(auth.uid())))
    ), ARRAY[]::text[])
  END
$function$;
-- crm_enabled() já depende de leads_enabled(); meu_plano_2027/carreira já exigem is_active_user: não mudam.

-- 5) RLS: barreira RESTRICTIVE nas tabelas que o app lê direto ----------------------------------------------------------
-- Lista tirada do catálogo no momento da migration (tabelas com RLS e SELECT para authenticated), menos as da entrada
-- e as da área liberada. As tabelas da Locação não têm grant a authenticated (tudo por RPC) e não entram.
DO $$
DECLARE _t text;
BEGIN
  FOR _t IN
    SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity
       AND has_table_privilege('authenticated', c.oid, 'SELECT')
       AND c.relname NOT IN ('profiles', 'user_roles', 'organization_members', 'organizations',
                             'organization_modules', 'notifications', 'user_tour_estado', 'profile_birthdates',
                             'support_tickets', 'support_ticket_messages', 'push_subscriptions',
                             'room_reservations', 'room_reservation_reminder_deliveries',
                             'room_reservation_cancellation_penalties', 'agency_rooms',
                             'achievement_posts', 'achievement_cheers', 'achievement_mutes')
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS zz_locacao_fora ON public.%I', _t);
    EXECUTE format('CREATE POLICY zz_locacao_fora ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
                   'USING (NOT (SELECT public.eh_so_locacao((SELECT auth.uid())))) '
                   'WITH CHECK (NOT (SELECT public.eh_so_locacao((SELECT auth.uid()))))', _t);
  END LOOP;
END $$;
