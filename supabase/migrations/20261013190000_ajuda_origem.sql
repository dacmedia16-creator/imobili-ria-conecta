-- Origem da caixa única de chamados + ponte servidor dos satélites.
-- Não publica. Rollback: supabase/rollback/20261013190000_ajuda_origem.sql
-- A ponte HMAC fica na função suporte-satelite. Esta função só roda como service_role,
-- depois que a função conferiu a assinatura. Usuário do app não executa.

BEGIN;

ALTER TABLE public.support_tickets
  ADD COLUMN origem text NOT NULL DEFAULT 'adm'
  CHECK (origem IN ('adm', 'estudo', 'visita'));
COMMENT ON COLUMN public.support_tickets.origem IS
  'Onde o chamado foi aberto. adm e estudo vão para o MAX Tecnologia; visita vai para o MAX Visita Prova.';
CREATE INDEX support_tickets_origem_idx ON public.support_tickets (origem, last_message_at DESC);

CREATE TABLE public.support_ticket_origem_jti (
  jti uuid PRIMARY KEY,
  origem text NOT NULL CHECK (origem IN ('estudo', 'visita')),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.support_ticket_origem_jti IS
  'Uso único do pedido da ponte. Só a função suporte-satelite grava, via service_role.';
REVOKE ALL ON public.support_ticket_origem_jti FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.support_ticket_origem_jti TO service_role;
ALTER TABLE public.support_ticket_origem_jti ENABLE ROW LEVEL SECURITY;

-- Lista passa a devolver a origem. O tipo de retorno muda, então recria a função.
DROP FUNCTION public.support_ticket_list(text);
CREATE FUNCTION public.support_ticket_list(_escopo text)
 RETURNS TABLE (
  id uuid, numero bigint, organization_id uuid, organizacao text, author_id uuid, autor_nome text,
  autor_papeis text, tipo text, status text, assunto text, tela_nome text, tela_rota text,
  print_path text, tem_print boolean, created_at timestamptz, last_message_at timestamptz,
  resolved_at timestamptz, origem text)
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
    t.print_path IS NOT NULL, t.created_at, t.last_message_at, t.resolved_at, t.origem
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

-- Fila do bot. _fila nula = todas (comportamento antigo). adm = ADM+Estudo. visita = só Visita.
DROP FUNCTION max_suporte.pendentes(timestamptz, integer);
CREATE FUNCTION max_suporte.pendentes(
  _desde timestamptz DEFAULT NULL,
  _limite integer DEFAULT 50,
  _fila text DEFAULT NULL
)
 RETURNS TABLE (id uuid, numero bigint, tipo text, status text, ultima_msg_usuario_em timestamptz,
                created_at timestamptz, origem text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF _fila IS NOT NULL AND _fila NOT IN ('adm', 'visita') THEN
    RAISE EXCEPTION 'fila permitida: adm ou visita' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.numero, t.tipo, t.status, u.created_at, t.created_at, t.origem
  FROM public.support_tickets t
  CROSS JOIN LATERAL (
    SELECT m.autor_equipe, m.created_at FROM public.support_ticket_messages m
     WHERE m.ticket_id = t.id AND NOT m.interna
     ORDER BY m.created_at DESC, m.id DESC LIMIT 1) u
  WHERE t.status <> 'resolvido' AND NOT u.autor_equipe
    AND (_desde IS NULL OR u.created_at > _desde)
    AND (
      _fila IS NULL
      OR (_fila = 'visita' AND t.origem = 'visita')
      OR (_fila = 'adm' AND t.origem IN ('adm', 'estudo'))
    )
  ORDER BY t.numero
  LIMIT least(greatest(coalesce(_limite, 50), 1), 200);
END $function$;
REVOKE ALL ON FUNCTION max_suporte.pendentes(timestamptz, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION max_suporte.pendentes(timestamptz, integer, text) TO max_suporte_bot;

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
    'origem', _t.origem,
    'fila', CASE WHEN _t.origem = 'visita' THEN 'visita' ELSE 'adm' END,
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
  _aviso text;
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

  _aviso := CASE _t.origem
    WHEN 'estudo' THEN 'Abra o Estudo de Mercado, em Ajuda e sugestões, para ver a resposta.'
    WHEN 'visita' THEN 'Abra o Visita MAX, em Ajuda e sugestões, para ver a resposta.'
    ELSE 'Abra o chamado para ver a resposta.'
  END;
  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto)
  VALUES (_t.id, _t.organization_id, NULL, true, false, _txt);
  UPDATE public.support_tickets SET status = _status, last_message_at = now(), resolved_at = NULL
   WHERE id = _t.id;
  INSERT INTO public.notifications (user_id, organization_id, tipo, titulo, mensagem, support_ticket_id)
  VALUES (_t.author_id, _t.organization_id, 'suporte_resposta',
          'A equipe MAX respondeu o chamado #' || _t.numero, _aviso, _t.id);
  RETURN _status;
END $function$;

-- Ponte. Chamada só pela função suporte-satelite, com service_role, depois do HMAC.
CREATE FUNCTION public.support_ticket_origem_exec(_acao text, _origem text, _user uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _org uuid;
  _jti uuid;
  _iat bigint;
  _id uuid;
  _numero bigint;
  _tipo text;
  _txt text;
  _status text;
  _print text;
  _t public.support_tickets%ROWTYPE;
BEGIN
  IF _origem NOT IN ('estudo', 'visita') THEN
    RAISE EXCEPTION 'Origem inválida' USING ERRCODE = '42501';
  END IF;
  IF _acao NOT IN ('abrir', 'meus', 'thread', 'responder', 'resolver', 'nao_lidas', 'print') THEN
    RAISE EXCEPTION 'Ação inválida' USING ERRCODE = '42501';
  END IF;
  SELECT p.organization_id INTO _org
  FROM public.profiles p
  WHERE p.id = _user AND public.is_active_user(p.id);
  IF _org IS NULL THEN
    RAISE EXCEPTION 'Usuário sem imobiliária ativa no ADM' USING ERRCODE = '42501';
  END IF;
  IF coalesce(_payload->>'jti', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'Pedido inválido' USING ERRCODE = '42501';
  END IF;
  _jti := (_payload->>'jti')::uuid;
  _iat := nullif(_payload->>'iat', '')::bigint;
  IF _iat IS NULL OR abs(extract(epoch FROM now())::bigint - _iat) > 60 THEN
    RAISE EXCEPTION 'Pedido expirado. Tente de novo.' USING ERRCODE = '42501';
  END IF;
  BEGIN
    INSERT INTO public.support_ticket_origem_jti (jti, origem) VALUES (_jti, _origem);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Pedido já usado. Tente de novo.' USING ERRCODE = '42501';
  END;
  DELETE FROM public.support_ticket_origem_jti
   WHERE created_at < now() - interval '1 day' AND jti <> _jti;

  IF _acao = 'nao_lidas' THEN
    RETURN jsonb_build_object('total', (
      SELECT count(*) FROM public.support_tickets t
       WHERE t.author_id = _user AND t.organization_id = _org AND t.origem = _origem
         AND t.status = 'respondido'));
  END IF;

  IF _acao = 'meus' THEN
    RETURN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'numero', t.numero, 'tipo', t.tipo, 'status', t.status,
        'assunto', t.assunto, 'tela_nome', t.tela_nome, 'tem_print', t.print_path IS NOT NULL,
        'created_at', t.created_at, 'last_message_at', t.last_message_at)
        ORDER BY t.last_message_at DESC)
      FROM public.support_tickets t
      WHERE t.author_id = _user AND t.organization_id = _org AND t.origem = _origem
    ), '[]'::jsonb);
  END IF;

  IF _acao <> 'abrir' THEN
    IF coalesce(_payload->>'ticket_id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
      RAISE EXCEPTION 'Chamado inválido' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO _t FROM public.support_tickets
     WHERE id = (_payload->>'ticket_id')::uuid
       AND author_id = _user AND organization_id = _org AND origem = _origem
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Chamado não encontrado' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF _acao = 'print' THEN
    RETURN jsonb_build_object('print_path', _t.print_path);
  END IF;

  IF _acao = 'thread' THEN
    RETURN jsonb_build_object(
      'id', _t.id, 'numero', _t.numero, 'tipo', _t.tipo, 'status', _t.status,
      'assunto', _t.assunto, 'tela_nome', _t.tela_nome, 'tem_print', _t.print_path IS NOT NULL,
      'mensagens', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'de', CASE WHEN m.autor_equipe THEN 'equipe' ELSE 'usuario' END,
          'texto', m.texto, 'em', m.created_at) ORDER BY m.created_at, m.id)
        FROM public.support_ticket_messages m
        WHERE m.ticket_id = _t.id AND NOT m.interna), '[]'::jsonb));
  END IF;

  IF _acao = 'resolver' THEN
    UPDATE public.support_tickets
       SET status = 'resolvido', resolved_at = coalesce(resolved_at, now())
     WHERE id = _t.id;
    RETURN jsonb_build_object('status', 'resolvido');
  END IF;

  IF _acao = 'responder' THEN
    _txt := btrim(coalesce(_payload->>'texto', ''));
    IF _t.status = 'resolvido' THEN RAISE EXCEPTION 'Este chamado já foi resolvido' USING ERRCODE = '42501'; END IF;
    IF length(_txt) < 1 THEN RAISE EXCEPTION 'Escreva a mensagem' USING ERRCODE = '42501'; END IF;
    IF length(_txt) > 4000 THEN RAISE EXCEPTION 'Texto muito longo' USING ERRCODE = '42501'; END IF;
    _status := CASE WHEN _t.status = 'respondido' THEN 'em_analise' ELSE _t.status END;
    INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto)
    VALUES (_t.id, _org, _user, false, false, _txt);
    UPDATE public.support_tickets SET status = _status, last_message_at = now(), resolved_at = NULL WHERE id = _t.id;
    RETURN jsonb_build_object('status', _status);
  END IF;

  _tipo := _payload->>'tipo';
  _txt := btrim(coalesce(_payload->>'texto', ''));
  IF _tipo NOT IN ('erro', 'duvida', 'sugestao') THEN RAISE EXCEPTION 'Escolha Erro, Dúvida ou Ideia.'; END IF;
  IF length(_txt) < 5 THEN RAISE EXCEPTION 'Escreva pelo menos 5 caracteres.'; END IF;
  IF length(_txt) > 4000 THEN RAISE EXCEPTION 'Texto muito longo.'; END IF;
  IF (SELECT count(*) FROM public.support_tickets
       WHERE author_id = _user AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Limite de 5 chamados por hora. Aguarde um pouco e tente de novo.';
  END IF;
  _print := nullif(_payload->>'print_path', '');
  IF _print IS NOT NULL AND _print !~ (_org::text || '/' || _user::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp)$') THEN
    RAISE EXCEPTION 'Print inválido' USING ERRCODE = '42501';
  END IF;
  IF _print IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'support-attachments' AND o.name = _print
  ) THEN
    RAISE EXCEPTION 'Print inválido' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.support_tickets (
    organization_id, author_id, tipo, assunto, tela_rota, tela_nome, user_agent, print_path, origem)
  VALUES (
    _org, _user, _tipo, left(_txt, 120),
    nullif(left(coalesce(_payload->>'tela_rota', ''), 300), ''),
    nullif(left(coalesce(_payload->>'tela_nome', ''), 120), ''),
    nullif(left(coalesce(_payload->>'user_agent', ''), 400), ''),
    _print, _origem)
  RETURNING id, numero INTO _id, _numero;
  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto)
  VALUES (_id, _org, _user, false, false, _txt);
  INSERT INTO public.notifications (user_id, organization_id, tipo, titulo, mensagem, support_ticket_id)
  SELECT pa.user_id, pr.organization_id, 'suporte_novo',
         'Novo chamado #' || _numero || ' (' || _tipo || ')',
         CASE _origem WHEN 'estudo' THEN 'Estudo de Mercado' ELSE 'Visita MAX' END,
         _id
  FROM public.platform_admins pa
  JOIN public.profiles pr ON pr.id = pa.user_id
  WHERE pr.organization_id IS NOT NULL AND pa.user_id <> _user;
  RETURN jsonb_build_object('id', _id, 'numero', _numero);
END $function$;

REVOKE ALL ON FUNCTION public.support_ticket_origem_exec(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_ticket_origem_exec(text, text, uuid, jsonb) TO service_role;

COMMIT;
