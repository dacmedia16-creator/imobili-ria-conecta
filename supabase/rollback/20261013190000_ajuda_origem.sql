-- Desfaz 20261013190000. Restaura as funções sem origem e remove a ponte.
-- Aplicar só com autorização, na mesma ordem, antes de qualquer chamada nova.

BEGIN;

CREATE OR REPLACE FUNCTION max_suporte.chamado(_ticket uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _t public.support_tickets%ROWTYPE; _r jsonb;
BEGIN
  SELECT * INTO _t FROM public.support_tickets WHERE support_tickets.id = _ticket;
  IF NOT FOUND OR _t.status = 'resolvido' THEN
    RAISE EXCEPTION 'Chamado não encontrado ou já resolvido' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'id', _t.id, 'numero', _t.numero, 'tipo', _t.tipo, 'status', _t.status, 'assunto', _t.assunto,
    'tela_nome', _t.tela_nome, 'tela_rota', _t.tela_rota, 'navegador', _t.user_agent,
    'tem_print', _t.print_path IS NOT NULL, 'aberto_em', _t.created_at,
    'imobiliaria', (SELECT o.nome FROM public.organizations o WHERE o.id = _t.organization_id),
    'autor_primeiro_nome', (SELECT nullif(split_part(btrim(p.nome), ' ', 1), '')
                             FROM public.profiles p WHERE p.id = _t.author_id),
    'mensagens', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'de', CASE WHEN m.autor_equipe AND m.author_id IS NULL THEN 'MAX'
                          WHEN m.autor_equipe THEN 'equipe' ELSE 'usuario' END,
               'interna', m.interna, 'texto', m.texto, 'em', m.created_at)
             ORDER BY m.created_at, m.id)
      FROM (SELECT * FROM public.support_ticket_messages
             WHERE ticket_id = _t.id ORDER BY created_at DESC, id DESC LIMIT 200) m), '[]'::jsonb))
  INTO _r;
  RETURN _r;
END $function$;

CREATE OR REPLACE FUNCTION max_suporte.responder(_ticket uuid, _texto text, _status text DEFAULT 'respondido')
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _t public.support_tickets%ROWTYPE; _txt text := btrim(coalesce(_texto, ''));
  _ultima_equipe boolean;
BEGIN
  IF _status NOT IN ('em_analise', 'respondido') THEN
    RAISE EXCEPTION 'O MAX só usa os status em_analise e respondido' USING ERRCODE = '42501';
  END IF;
  IF length(_txt) < 1 THEN RAISE EXCEPTION 'Escreva a mensagem'; END IF;
  IF length(_txt) > 3900 THEN RAISE EXCEPTION 'Texto muito longo (máximo 3.900 caracteres)'; END IF;
  IF _txt !~ '— MAX$' THEN _txt := _txt || E'\n\n— MAX'; END IF;
  SELECT * INTO _t FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF NOT FOUND OR _t.status = 'resolvido' THEN
    RAISE EXCEPTION 'Chamado não encontrado ou já resolvido' USING ERRCODE = '42501';
  END IF;
  SELECT m.autor_equipe INTO _ultima_equipe FROM public.support_ticket_messages m
   WHERE m.ticket_id = _t.id AND NOT m.interna ORDER BY m.created_at DESC, m.id DESC LIMIT 1;
  IF coalesce(_ultima_equipe, false) THEN
    RAISE EXCEPTION 'A última mensagem já é da equipe: aguarde o usuário' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.support_ticket_messages
       WHERE autor_equipe AND author_id IS NULL AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'Limite de 30 respostas do MAX por hora' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto)
  VALUES (_t.id, _t.organization_id, NULL, true, false, _txt);
  UPDATE public.support_tickets SET status = _status, last_message_at = now(), resolved_at = NULL
   WHERE id = _t.id;
  INSERT INTO public.notifications (user_id, organization_id, tipo, titulo, mensagem, support_ticket_id)
  VALUES (_t.author_id, _t.organization_id, 'suporte_resposta',
          'A equipe MAX respondeu o chamado #' || _t.numero, 'Abra o chamado para ver a resposta.', _t.id);
  RETURN _status;
END $function$;

DROP FUNCTION IF EXISTS max_suporte.pendentes(timestamptz, integer, text);
CREATE FUNCTION max_suporte.pendentes(_desde timestamptz DEFAULT NULL, _limite integer DEFAULT 50)
 RETURNS TABLE (id uuid, numero bigint, tipo text, status text, ultima_msg_usuario_em timestamptz,
                created_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT t.id, t.numero, t.tipo, t.status, u.created_at, t.created_at
  FROM public.support_tickets t
  CROSS JOIN LATERAL (
    SELECT m.autor_equipe, m.created_at FROM public.support_ticket_messages m
     WHERE m.ticket_id = t.id AND NOT m.interna
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1) u
  WHERE t.status <> 'resolvido' AND NOT u.autor_equipe
    AND (_desde IS NULL OR u.created_at > _desde)
  ORDER BY t.numero
  LIMIT least(greatest(coalesce(_limite, 50), 1), 200)
$function$;
REVOKE ALL ON FUNCTION max_suporte.pendentes(timestamptz, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION max_suporte.pendentes(timestamptz, integer) TO max_suporte_bot;

DROP FUNCTION IF EXISTS public.support_ticket_list(text);
CREATE FUNCTION public.support_ticket_list(_escopo text)
 RETURNS TABLE (
  id uuid, numero bigint, organization_id uuid, organizacao text, author_id uuid, autor_nome text,
  autor_papeis text, tipo text, status text, assunto text, tela_nome text, tela_rota text,
  print_path text, tem_print boolean, created_at timestamptz, last_message_at timestamptz,
  resolved_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _equipe boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Faça login' USING ERRCODE = '42501'; END IF;
  _equipe := public.is_platform_super_admin(_uid);
  IF _escopo = 'todos' AND NOT _equipe THEN
    RAISE EXCEPTION 'Só a equipe MAX vê a central de chamados' USING ERRCODE = '42501';
  END IF;
  IF _escopo = 'org' AND (_org IS NULL
      OR NOT public.has_any_role(_uid, ARRAY['admin','super_admin']::public.app_role[])) THEN
    RAISE EXCEPTION 'Só o admin da imobiliária vê os chamados da imobiliária' USING ERRCODE = '42501';
  END IF;
  IF _escopo NOT IN ('meus', 'org', 'todos') THEN RAISE EXCEPTION 'Escopo inválido'; END IF;
  RETURN QUERY
  SELECT t.id, t.numero, t.organization_id, o.nome, t.author_id, p.nome,
    (SELECT string_agg(r.role::text, ',' ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = t.author_id),
    t.tipo, t.status, t.assunto, t.tela_nome, t.tela_rota,
    CASE WHEN _escopo = 'org' THEN NULL ELSE t.print_path END,
    t.print_path IS NOT NULL, t.created_at, t.last_message_at, t.resolved_at
  FROM public.support_tickets t
  JOIN public.organizations o ON o.id = t.organization_id
  LEFT JOIN public.profiles p ON p.id = t.author_id
  WHERE CASE _escopo
    WHEN 'meus' THEN t.author_id = _uid AND t.organization_id = _org
    WHEN 'org' THEN t.organization_id = _org
    ELSE true END
  ORDER BY t.last_message_at DESC
  LIMIT 500;
END $function$;
REVOKE ALL ON FUNCTION public.support_ticket_list(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_list(text) TO authenticated;

DROP FUNCTION IF EXISTS public.support_ticket_origem_exec(text, text, uuid, jsonb);
DROP TABLE IF EXISTS public.support_ticket_origem_jti;
DROP INDEX IF EXISTS public.support_tickets_origem_idx;
ALTER TABLE public.support_tickets DROP COLUMN IF EXISTS origem;

COMMIT;
