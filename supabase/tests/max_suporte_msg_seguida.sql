-- Suíte da migration 20261013220000 (max_suporte.responder com mensagem seguida).
-- Termina SEMPRE com RAISE EXCEPTION contendo o resultado, então tudo é revertido. Cria um chamado fictício e não toca em dados reais.
DO $t$
DECLARE
  _u uuid; _org uuid; _tk uuid := gen_random_uuid(); _ok int := 0; _falha int := 0; _r text; _n int; _log text := '';
BEGIN
  SELECT p.id, p.organization_id INTO _u, _org FROM public.profiles p
   WHERE p.organization_id IS NOT NULL ORDER BY p.created_at LIMIT 1;
  -- número fictício explícito para não gastar a sequência real dos chamados
  INSERT INTO public.support_tickets (id, numero, organization_id, author_id, tipo, assunto, status)
  OVERRIDING SYSTEM VALUE VALUES (_tk, (SELECT coalesce(max(numero), 0) + 900000 FROM public.support_tickets), _org, _u, 'duvida', 'teste msg seguida', 'recebido');
  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto, created_at)
  VALUES (_tk, _org, _u, false, false, 'pergunta', now() - interval '1 minute');

  -- 1ª, 2ª e 3ª mensagens seguidas da equipe: aceitas
  FOR i IN 1..3 LOOP
    _r := max_suporte.responder(_tk, 'resposta ' || i, 'respondido');
    IF _r = 'respondido' THEN _ok := _ok + 1; _log := _log || format('ok seguida %s | ', i);
    ELSE _falha := _falha + 1; _log := _log || format('FALHA seguida %s | ', i); END IF;
  END LOOP;
  -- 4ª: bloqueada pelo anti-loop
  BEGIN
    PERFORM max_suporte.responder(_tk, 'resposta 4', 'respondido');
    _falha := _falha + 1; _log := _log || format('FALHA 4a aceita | ');
  EXCEPTION WHEN insufficient_privilege THEN _ok := _ok + 1; _log := _log || format('ok 4a bloqueada: %s | ', SQLERRM);
  END;
  -- nota interna da equipe não conta e não destrava
  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto)
  VALUES (_tk, _org, NULL, true, true, 'nota interna');
  BEGIN
    PERFORM max_suporte.responder(_tk, 'resposta 4b', 'respondido');
    _falha := _falha + 1; _log := _log || format('FALHA interna destravou | ');
  EXCEPTION WHEN insufficient_privilege THEN _ok := _ok + 1; _log := _log || format('ok interna nao destrava | ');
  END;
  -- usuário responde: contador zera (dentro da transação now() é fixo; afasta os horários para ordenar)
  UPDATE public.support_ticket_messages SET created_at = created_at - interval '2 minutes' WHERE ticket_id = _tk;
  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto, created_at)
  VALUES (_tk, _org, _u, false, false, 'nova pergunta', now() - interval '30 seconds');
  _r := max_suporte.responder(_tk, 'depois do usuario', 'em_analise');
  IF _r = 'em_analise' THEN _ok := _ok + 1; _log := _log || format('ok zera apos usuario | '); ELSE _falha := _falha + 1; END IF;
  -- assinatura e notificação mantidas
  SELECT count(*) INTO _n FROM public.support_ticket_messages WHERE ticket_id = _tk AND author_id IS NULL AND NOT interna AND texto ~ '— MAX$';
  IF _n = 4 THEN _ok := _ok + 1; _log := _log || format('ok assinatura (4) | '); ELSE _falha := _falha + 1; _log := _log || format('FALHA assinatura %s | ', _n); END IF;
  SELECT count(*) INTO _n FROM public.notifications WHERE support_ticket_id = _tk AND tipo = 'suporte_resposta';
  IF _n = 4 THEN _ok := _ok + 1; _log := _log || format('ok notificacoes (4) | '); ELSE _falha := _falha + 1; _log := _log || format('FALHA notificacoes %s | ', _n); END IF;
  -- status fora da lista: recusado
  BEGIN
    PERFORM max_suporte.responder(_tk, 'x', 'resolvido');
    _falha := _falha + 1; _log := _log || format('FALHA status resolvido aceito | ');
  EXCEPTION WHEN insufficient_privilege THEN _ok := _ok + 1; _log := _log || format('ok status resolvido recusado | ');
  END;
  -- chamado resolvido: recusado
  UPDATE public.support_tickets SET status = 'resolvido' WHERE id = _tk;
  BEGIN
    PERFORM max_suporte.responder(_tk, 'x', 'respondido');
    _falha := _falha + 1; _log := _log || format('FALHA resolvido aceito | ');
  EXCEPTION WHEN insufficient_privilege THEN _ok := _ok + 1; _log := _log || format('ok resolvido recusado | ');
  END;
  -- limite de 30/hora continua: simula 30 mensagens do MAX na última hora em outro chamado
  UPDATE public.support_tickets SET status = 'em_analise' WHERE id = _tk;
  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto, created_at)
  VALUES (_tk, _org, _u, false, false, 'u', now() + interval '1 second');
  INSERT INTO public.support_ticket_messages (ticket_id, organization_id, author_id, autor_equipe, interna, texto, created_at)
  SELECT _tk, _org, NULL, true, true, 'carga', now() - interval '5 minutes' FROM generate_series(1, 30);
  BEGIN
    PERFORM max_suporte.responder(_tk, 'x', 'respondido');
    _falha := _falha + 1; _log := _log || format('FALHA limite 30/h nao bloqueou | ');
  EXCEPTION WHEN insufficient_privilege THEN _ok := _ok + 1; _log := _log || format('ok limite 30/h: %s | ', SQLERRM);
  END;
  _log := _log || format('TOTAL=%s ok, %s falha', _ok, _falha);
  RAISE EXCEPTION 'RESULTADO (sempre revertido): %', _log;
END $t$;
