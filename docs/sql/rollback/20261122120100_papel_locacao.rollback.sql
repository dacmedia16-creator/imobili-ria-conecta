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

-- Seção 6 (t_00c1173c): corpos de produção em 12/11/2026 (md5 conferido) — antes de apagar eh_so_locacao.
CREATE OR REPLACE FUNCTION public.meu_realizado(_inicio date, _fim date)
 RETURNS TABLE(comissao numeric, vendas integer, vgv numeric, captacoes integer, como_captador integer, vgv_captador numeric, como_vendedor integer, vgv_vendedor numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio OR _fim - _inicio > 366 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH canon AS (
    SELECT v.sale_id, v.vgv_proprio, s.corretor_captador_id, s.corretor_vendedor_id
      FROM public.vendas_comerciais_canonicas() v
      JOIN public.sales s ON s.id = v.sale_id
     WHERE s.organization_id = _org AND v.data_fechamento BETWEEN _inicio AND _fim),
  minhas AS (
    SELECT p.sale_id, sum(p.valor_individual) AS valor
      FROM public.participacoes_comerciais_validas() p
      JOIN canon c ON c.sale_id = p.sale_id
     WHERE p.user_id = _me
     GROUP BY p.sale_id),
  caps AS (
    SELECT count(*)::integer AS n
      FROM public.exclusive_captures c
     WHERE coalesce(c.captador_original_id, c.captor_id) = _me AND c.organization_id = _org AND c.status = 'aprovada' AND c.discarded_at IS NULL
       AND public.exclusive_aprovada_em(c.id) BETWEEN _inicio AND _fim)
  SELECT
    coalesce((SELECT sum(m.valor) FROM minhas m), 0)::numeric,
    (SELECT count(*) FROM minhas)::integer,
    coalesce((SELECT sum(c.vgv_proprio) FROM canon c JOIN minhas m ON m.sale_id = c.sale_id), 0)::numeric,
    CASE WHEN EXISTS (SELECT 1 FROM public.organization_modules om
                       WHERE om.organization_id = _org AND om.module = 'captacao_exclusiva' AND om.enabled)
         THEN (SELECT n FROM caps) END,
    (SELECT count(*) FROM canon c WHERE c.corretor_captador_id = _me)::integer,
    coalesce((SELECT sum(c.vgv_proprio) FROM canon c WHERE c.corretor_captador_id = _me), 0)::numeric,
    (SELECT count(*) FROM canon c WHERE c.corretor_vendedor_id = _me)::integer,
    coalesce((SELECT sum(c.vgv_proprio) FROM canon c WHERE c.corretor_vendedor_id = _me), 0)::numeric;
END $function$
;

CREATE OR REPLACE FUNCTION public.photo_meu_resumo()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.photo_org_ativa();
  _hoje date := public.photo_hoje();
  _mes date := date_trunc('month', public.photo_hoje())::date;
  _cfg public.photo_settings;
  _assinadas int;
BEGIN
  PERFORM public.photo_vouchers_conferir(_org, _uid, _mes);
  SELECT * INTO _cfg FROM public.photo_settings WHERE organization_id = _org;
  _assinadas := public.photo_captacoes_assinadas(_org, _uid, _mes);
  RETURN jsonb_build_object(
    'hoje', _hoje,
    'eh_fotografo', public.photo_eh_fotografo(_org, _uid),
    'eh_admin', public.photo_eh_admin(_uid),
    'eh_financeiro', public.photo_eh_financeiro(_uid),
    'fotografo_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = _cfg.fotografo_id),
    'fotografo_id', _cfg.fotografo_id,
    'valor_sessao', coalesce(_cfg.valor_sessao, 0),
    'mes', jsonb_build_object('mes_ref', _mes, 'assinadas', _assinadas, 'meta', 3,
      'faltam', greatest(3 - _assinadas, 0),
      'vence_em', public.photo_voucher_vencimento(_mes)),
    'bloqueado_ate', public.photo_bloqueado_ate(_org, _uid),
    'desmarcacoes_30d', public.photo_desmarcacoes_30d(_org, _uid),
    'vouchers', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'mes_ref', v.mes_ref, 'seq', v.seq, 'gerado_em', v.gerado_em, 'vence_em', v.vence_em,
        'status', public.photo_status_voucher(v),
        'sessao_id', (SELECT s.id FROM public.photo_sessions s WHERE s.voucher_id = v.id AND s.status NOT IN ('cancelada', 'recusada')),
        'imovel', (SELECT public.photo_imovel_label(c) FROM public.photo_sessions s
                     JOIN public.exclusive_captures c ON c.id = s.capture_id
                    WHERE s.voucher_id = v.id AND s.status NOT IN ('cancelada', 'recusada')))
        ORDER BY v.vence_em, v.mes_ref, v.seq)
      FROM public.photo_vouchers v WHERE v.organization_id = _org AND v.corretor_id = _uid), '[]'::jsonb),
    'imoveis', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'imovel', coalesce(public.photo_imovel_label(c), 'Imóvel sem endereço'),
        'tem_sessao_aberta', EXISTS (SELECT 1 FROM public.photo_sessions s WHERE s.capture_id = c.id AND s.status IN ('aguardando', 'confirmada')),
        'voucher_ja_usado', EXISTS (SELECT 1 FROM public.photo_sessions s
                                     WHERE s.capture_id = c.id AND s.voucher_id IS NOT NULL AND s.status NOT IN ('cancelada', 'recusada')))
        ORDER BY c.signed_on DESC NULLS LAST, c.created_at DESC)
      FROM public.exclusive_captures c
     WHERE c.organization_id = _org AND (c.captor_id = _uid OR c.captador_original_id = _uid)
       AND c.status = 'aprovada' AND c.discarded_at IS NULL AND c.archived_at IS NULL), '[]'::jsonb),
    'minhas_sessoes', coalesce((SELECT jsonb_agg(public.photo_sessao_json(s) ORDER BY s.inicio DESC)
      FROM public.photo_sessions s WHERE s.organization_id = _org AND s.corretor_id = _uid
       AND (s.status IN ('aguardando', 'confirmada') OR s.inicio > now() - interval '60 days')), '[]'::jsonb));
END $function$
;

CREATE OR REPLACE FUNCTION public.photo_agendar(_capture uuid, _inicio timestamp with time zone, _voucher uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.photo_org_ativa();
  _fot uuid;
  _cap public.exclusive_captures;
  _v public.photo_vouchers;
  _s public.photo_sessions;
  _bloq timestamptz;
  _fim timestamptz;
BEGIN
  SELECT fotografo_id INTO _fot FROM public.photo_settings WHERE organization_id = _org;
  IF _fot IS NULL THEN RAISE EXCEPTION 'A imobiliaria ainda nao escolheu o fotografo' USING ERRCODE = '22023'; END IF;
  _bloq := public.photo_bloqueado_ate(_org, _uid);
  IF _bloq IS NOT NULL THEN
    RAISE EXCEPTION 'Agendamento bloqueado ate % (3 desmarcacoes em 30 dias)',
      to_char(_bloq AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') USING ERRCODE = '42501';
  END IF;
  IF _inicio IS NULL OR _inicio <= now() THEN RAISE EXCEPTION 'Escolha um horario futuro' USING ERRCODE = '22023'; END IF;
  _fim := _inicio + interval '2 hours';

  SELECT * INTO _cap FROM public.exclusive_captures WHERE id = _capture AND organization_id = _org FOR SHARE;
  -- coalesce: com captador_original_id nulo, "x = NULL" daria NULL e o IF deixaria passar.
  IF _cap.id IS NULL OR NOT coalesce(_cap.captor_id = _uid OR _cap.captador_original_id = _uid, false) THEN
    RAISE EXCEPTION 'So e possivel agendar fotos de imovel captado por voce' USING ERRCODE = '42501';
  END IF;
  IF _cap.status <> 'aprovada' OR _cap.discarded_at IS NOT NULL OR _cap.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'A captacao precisa estar aprovada (assinada) e ativa' USING ERRCODE = '22023';
  END IF;

  -- Horário dentro de uma faixa livre do fotógrafo e fora de bloqueios.
  IF NOT EXISTS (SELECT 1 FROM public.photo_agenda w WHERE w.organization_id = _org AND w.fotografo_id = _fot
                    AND w.tipo = 'livre' AND w.inicio <= _inicio AND w.fim >= _fim)
     OR EXISTS (SELECT 1 FROM public.photo_agenda b WHERE b.organization_id = _org AND b.tipo = 'bloqueio'
                    AND tstzrange(b.inicio, b.fim) && tstzrange(_inicio, _fim)) THEN
    RAISE EXCEPTION 'Horario fora da agenda liberada do fotografo' USING ERRCODE = '22023';
  END IF;

  IF _voucher IS NOT NULL THEN
    SELECT * INTO _v FROM public.photo_vouchers WHERE id = _voucher AND organization_id = _org FOR UPDATE;
    IF _v.id IS NULL OR _v.corretor_id <> _uid THEN
      RAISE EXCEPTION 'Voucher nao encontrado' USING ERRCODE = 'P0002';
    END IF;
    IF _v.status <> 'disponivel' THEN RAISE EXCEPTION 'Este voucher nao esta disponivel' USING ERRCODE = '22023'; END IF;
    IF _v.vence_em < public.photo_hoje() OR (_inicio AT TIME ZONE 'America/Sao_Paulo')::date > _v.vence_em THEN
      RAISE EXCEPTION 'A sessao precisa ser ate % (validade do voucher)', to_char(_v.vence_em, 'DD/MM/YYYY')
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.photo_sessions s WHERE s.capture_id = _capture
                  AND s.voucher_id IS NOT NULL AND s.status NOT IN ('cancelada', 'recusada')) THEN
      RAISE EXCEPTION 'Este imovel ja usou um voucher (1 por imovel)' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.photo_sessions s WHERE s.capture_id = _capture AND s.status IN ('aguardando', 'confirmada')) THEN
    RAISE EXCEPTION 'Este imovel ja tem uma sessao marcada' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.photo_sessions (organization_id, fotografo_id, corretor_id, capture_id, voucher_id,
      inicio, fim, ocupa_ate, paga_por, created_by)
    VALUES (_org, _fot, _uid, _capture, _voucher, _inicio, _fim, _fim + interval '1 hour',
      CASE WHEN _voucher IS NULL THEN 'corretor' ELSE 'imobiliaria' END, _uid)
    RETURNING * INTO _s;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'Horario indisponivel (sessao de 2 h + 1 h de intervalo)' USING ERRCODE = '23P01';
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Imovel ou voucher ja usado em outra sessao' USING ERRCODE = '23505';
  END;
  IF _voucher IS NOT NULL THEN
    UPDATE public.photo_vouchers SET status = 'agendado' WHERE id = _voucher;
  END IF;
  INSERT INTO public.photo_history (organization_id, session_id, voucher_id, ator_id, acao, payload)
  VALUES (_org, _s.id, _voucher, _uid, 'marcada', jsonb_build_object('inicio', _inicio, 'capture_id', _capture));
  PERFORM public.photo_avisar_evento(_s, 'marcada');
  RETURN _s.id;
END $function$
;

CREATE OR REPLACE FUNCTION public.academia_has_active_adm_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles AS p
       WHERE p.id = auth.uid() AND p.ativo IS TRUE
         AND (
           EXISTS (SELECT 1 FROM public.platform_admins AS a WHERE a.user_id = p.id)
           OR EXISTS (
             SELECT 1 FROM public.organization_members AS m
               JOIN public.organizations AS o ON o.id = m.organization_id
               JOIN public.organization_modules AS om
                 ON om.organization_id = o.id AND om.module = 'academia' AND om.enabled IS TRUE
              WHERE m.user_id = p.id AND m.ativo IS TRUE AND o.status = 'ativa'
           )
         )
    );
$function$
;

CREATE OR REPLACE FUNCTION academia.user_org(_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid; _ativo boolean; _mod boolean;
BEGIN
  IF _user IS NULL THEN RETURN NULL; END IF;
  SELECT p.ativo INTO _ativo FROM public.profiles p WHERE p.id = _user;
  IF _ativo IS NOT TRUE THEN RETURN NULL; END IF;
  IF to_regclass('public.organization_members') IS NOT NULL THEN
    EXECUTE 'SELECT organization_id FROM public.organization_members WHERE user_id = $1 AND ativo LIMIT 1'
      INTO _org USING _user;
    -- Módulo 'academia' precisa estar ligado na imobiliária (admin da plataforma fica como antes).
    IF _org IS NOT NULL AND to_regclass('public.organization_modules') IS NOT NULL
       AND NOT academia.is_platform_admin(_user) THEN
      EXECUTE 'SELECT coalesce((SELECT enabled FROM public.organization_modules
                 WHERE organization_id = $1 AND module = ''academia''), false)'
        INTO _mod USING _org;
      IF _mod IS NOT TRUE THEN RETURN NULL; END IF;
    END IF;
    RETURN _org;
  END IF;
  RETURN academia.legacy_org_id();
END;
$function$
;

DROP FUNCTION IF EXISTS public.so_locacao_ativo(uuid);
DROP FUNCTION IF EXISTS public.eh_so_locacao(uuid);
