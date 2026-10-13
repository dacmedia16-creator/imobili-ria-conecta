-- MAX pode mandar mensagem seguida no chamado (pedido de Denis, tópico suporte 21340, t_3a1f7cc0).
-- Troca a trava "a última mensagem já é da equipe" por um limite de 3 mensagens seguidas da equipe
-- (não internas) sem resposta do usuário. Mantém: limite de 30/hora, recusa em chamado resolvido,
-- status permitidos, assinatura e notificação. Só a função max_suporte.responder muda.
-- Rollback: supabase/rollback/20261013220000_max_suporte_msg_seguida.sql
BEGIN;

CREATE OR REPLACE FUNCTION max_suporte.responder(_ticket uuid, _texto text, _status text DEFAULT 'respondido')
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _t public.support_tickets%ROWTYPE; _txt text := btrim(coalesce(_texto, ''));
  _seguidas integer;
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
  -- Mensagens da equipe (não internas) depois da última mensagem do usuário.
  SELECT count(*) INTO _seguidas FROM public.support_ticket_messages m
   WHERE m.ticket_id = _t.id AND NOT m.interna AND m.autor_equipe
     AND (m.created_at, m.id) > coalesce((
           SELECT (u.created_at, u.id) FROM public.support_ticket_messages u
            WHERE u.ticket_id = _t.id AND NOT u.interna AND NOT u.autor_equipe
            ORDER BY u.created_at DESC, u.id DESC LIMIT 1),
         ('-infinity'::timestamptz, '00000000-0000-0000-0000-000000000000'::uuid));
  IF _seguidas >= 3 THEN
    RAISE EXCEPTION 'Já são 3 mensagens seguidas da equipe: aguarde o usuário' USING ERRCODE = '42501';
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

COMMIT;
