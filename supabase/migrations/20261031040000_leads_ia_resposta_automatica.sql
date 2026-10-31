-- t_d775be06 (Denis, 31/10/2026, tópico 6238): Nicole não conversa com resposta automática de empresa.
-- Muda SÓ public.lead_ia_retorno_receber (mesma assinatura, permissões mantidas pelo CREATE OR REPLACE).
-- Sem coluna nova, sem dado alterado. Mensagem sem _msg.auto (servidor antigo) = comportamento de antes.
-- Rollback (1 passo): docs/sql/rollback/20261031040000_leads_ia_resposta_automatica.rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.lead_ia_retorno_receber(_token text, _msg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.lead_config; _ok boolean; _id text; _chave text; _tipo text; _texto text;
  _cv public.lead_conversas; _ctx jsonb; _ev bigint; _n integer; _vis boolean; _aviso text; _g record; _ace jsonb; _rid uuid;
BEGIN
  -- Token primeiro: nada é gravado antes disso.
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT * INTO _c FROM public.lead_config
   WHERE ia_retorno_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex')
     FOR UPDATE; -- serializa a imobiliária: o limite por minuto vale também em rajada
  IF _c.organization_id IS NULL THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT (m.enabled AND o.status = 'ativa') INTO _ok FROM public.organization_modules m
    JOIN public.organizations o ON o.id = m.organization_id
   WHERE m.organization_id = _c.organization_id AND m.module = 'leads';
  IF NOT coalesce(_ok, false) OR NOT _c.ia_ativa OR _c.ia_canal <> 'ziontalk' OR _c.ia_canal_numero IS NULL THEN
    RETURN jsonb_build_object('r', 'desligada');
  END IF;
  IF _msg IS NULL OR jsonb_typeof(_msg) <> 'object' THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  -- t_82c89141 item 6b: mensagem PRÓPRIA (alguém da equipe escreveu pelo número da imobiliária) que não é o
  -- eco de uma mensagem da Nicole/sistema dos últimos 15 min = a equipe respondeu. Só marca a hora; nada é gravado.
  IF coalesce(_msg->>'proprio', '') = 'true' AND coalesce(_msg->>'grupo', '') <> 'true'
     AND coalesce(_msg->>'status', '') <> 'true' THEN
    _chave := (public.lead_ia_contatos(_msg->>'telefone', NULL))[1];
    _texto := btrim(coalesce(_msg->>'texto', ''));
    IF _chave ~ '^[0-9]{10,11}$' AND _chave IS DISTINCT FROM _c.ia_canal_numero THEN
      SELECT cv.* INTO _cv FROM public.lead_conversas cv JOIN public.leads l ON l.id = cv.lead_id
       WHERE cv.organization_id = _c.organization_id AND NOT l.simulado
         AND _chave = ANY (public.lead_ia_contatos(l.telefone, NULL))
       ORDER BY cv.created_at DESC, cv.id DESC LIMIT 1;
      IF _cv.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = _cv.id
                AND m.autor IN ('ia', 'sistema') AND m.created_at > now() - interval '15 minutes'
                AND btrim(m.texto) = _texto) THEN
        UPDATE public.lead_conversas SET equipe_em = now() WHERE id = _cv.id;
      END IF;
    END IF;
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  IF coalesce(_msg->>'grupo', '') = 'true' OR coalesce(_msg->>'status', '') = 'true'
     OR coalesce(_msg->>'proprio', '') = 'true' THEN
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  _id := btrim(coalesce(_msg->>'id', ''));
  IF char_length(_id) NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  _chave := (public.lead_ia_contatos(_msg->>'telefone', NULL))[1];
  IF _chave IS NULL OR _chave !~ '^[0-9]{10,11}$' OR _chave = _c.ia_canal_numero THEN
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  -- t_63c55cee: telefone do cadastro de corretor = nunca é cliente (não cria conversa, não chama a IA, não conta
  -- nos limites). Responde só ao aceite/ajuda.
  IF _c.ia_aceite_whats AND _c.ia_aviso_corretor_whats THEN
    _ace := public.lead_aceite_whats_receber(_c, _chave, _id,
              CASE WHEN _msg->>'tipo' = 'midia' THEN '' ELSE left(btrim(coalesce(_msg->>'texto', '')), 1000) END);
    IF _ace IS NOT NULL THEN RETURN _ace; END IF;
  END IF;
  _tipo := CASE WHEN _msg->>'tipo' = 'midia' THEN 'midia' ELSE 'texto' END;
  _texto := left(btrim(coalesce(_msg->>'texto', '')), 1000);
  IF _tipo = 'texto' AND _texto = '' THEN RETURN jsonb_build_object('r', 'ignorado'); END IF;

  DELETE FROM public.lead_ia_retorno_eventos
   WHERE organization_id = _c.organization_id AND created_at < now() - interval '30 days';
  INSERT INTO public.lead_ia_retorno_eventos (organization_id, externo_hash, resultado)
  VALUES (_c.organization_id, encode(extensions.digest(_c.organization_id::text || ':' || _id, 'sha256'), 'hex'), 'recebido')
  ON CONFLICT (organization_id, externo_hash) DO NOTHING RETURNING id INTO _ev;
  IF _ev IS NULL THEN RETURN jsonb_build_object('r', 'duplicado'); END IF;

  -- t_ccaa41c0: no modo 'todos' a conferência é feita abaixo, pelo lead da conversa (só leads de ia_envio_desde em diante).
  IF NOT (_chave = ANY (_c.ia_envio_allowlist)) AND _c.ia_envio_modo <> 'todos' THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'fora_lista' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'fora_lista');
  END IF;

  -- t_a9f1b447: a conversa do lead MAIS RECENTE desse telefone (a que a Nicole abriu por último), esteja ela
  -- ativa ou não. Nunca pula para uma conversa antiga só porque ela ficou \"ativa\".
  SELECT cv.* INTO _cv FROM public.lead_conversas cv JOIN public.leads l ON l.id = cv.lead_id
   WHERE cv.organization_id = _c.organization_id AND l.organization_id = _c.organization_id AND NOT l.simulado
     AND _chave = ANY (public.lead_ia_contatos(l.telefone, NULL))
   ORDER BY cv.created_at DESC, cv.id DESC LIMIT 1;
  IF _cv.id IS NULL THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'desconhecido' WHERE id = _ev;
    -- t_63c55cee: número que não é cliente nem corretor pedindo aceite = explica, sem alterar nada.
    -- shortcut: no máximo 5 respostas destas por hora na imobiliária (protege o chip; o resto fica sem resposta).
    IF _c.ia_aceite_whats AND _c.ia_aviso_corretor_whats AND _tipo = 'texto'
       AND public.lead_aceite_whats_parse(_texto) IS NOT NULL
       AND (SELECT count(*) FROM public.lead_aceite_whats w WHERE w.organization_id = _c.organization_id
             AND w.acao = 'nao_corretor' AND w.created_at > now() - interval '1 hour') < 5 THEN
      INSERT INTO public.lead_aceite_whats (organization_id, externo_hash, acao, status)
      VALUES (_c.organization_id, encode(extensions.digest(_c.organization_id::text || ':' || _id, 'sha256'), 'hex'),
              'nao_corretor', 'pendente')
      ON CONFLICT (organization_id, externo_hash) DO NOTHING RETURNING id INTO _rid;
      IF _rid IS NULL THEN RETURN jsonb_build_object('r', 'desconhecido'); END IF;
      RETURN jsonb_build_object('r', 'desconhecido', 'resposta_id', _rid, 'resposta',
        'Este número não está no cadastro de corretores' || coalesce(' da ' || public.lead_ia_org_nome(_c.organization_id), '')
        || '. Para aceitar um lead, use o ADM, em Meus leads.');
    END IF;
    RETURN jsonb_build_object('r', 'desconhecido');
  END IF;

  IF NOT (_chave = ANY (_c.ia_envio_allowlist))
     AND NOT public.lead_ia_liberado(_c, (SELECT l FROM public.leads l WHERE l.id = _cv.lead_id)) THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'fora_lista' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'fora_lista');
  END IF;
  -- t_d775be06 (Luciana 66050ec1 / Grafi10): resposta AUTOMÁTICA de empresa (o servidor marca _msg.auto).
  -- Vale só antes da 1ª fala humana do cliente. 'forte' = frase típica de autoatendimento (aviso de horário,
  -- "em que posso te ajudar?", "responderemos o mais breve"); 'apresentacao' ("aqui é Fulana da Empresa") só
  -- conta junto de outra resposta automática, até 5 min depois da 1ª mensagem da Nicole ("sou a Ana de Itu",
  -- dito por uma cliente de verdade, não é barrado sozinho).
  -- Efeito: grava como 'sistema' (não é o cliente), a Nicole NÃO responde, o toque de 15 min não dispara, os
  -- lembretes de quem nunca respondeu (3 h/24 h/48 h) seguem, e o gestor é avisado 1 vez por lead.
  IF coalesce(_msg->>'auto', '') IN ('forte', 'apresentacao') AND _tipo = 'texto' AND _cv.estado = 'ativa'
     AND _cv.primeira_enviada_em IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens x WHERE x.conversa_id = _cv.id AND x.autor = 'cliente')
     AND (_msg->>'auto' = 'forte'
          OR (_cv.primeira_enviada_em > now() - interval '5 minutes'
              AND EXISTS (SELECT 1 FROM public.lead_mensagens x WHERE x.conversa_id = _cv.id AND x.autor = 'sistema'
                           AND x.status = 'recebida' AND x.texto LIKE 'Resposta automática do número%'))) THEN
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_cv.organization_id, _cv.id, 'sistema',
            left('Resposta automática do número (não é o cliente; a IA não respondeu): ' || _texto, 2000), 'recebida');
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'ok', conversa_id = _cv.id WHERE id = _ev;
    IF NOT EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = _cv.lead_id AND e.tipo = 'ia'
                    AND e.para = 'resposta_automatica') THEN
      INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
      VALUES (_cv.organization_id, _cv.lead_id, 'ia', 'resposta_automatica',
              'Possível número comercial/resposta automática: chegou mensagem automática de empresa. A IA não respondeu e mantém os lembretes de quem não respondeu. Confira o número do lead.');
      FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
                 WHERE r.organization_id = _cv.organization_id AND r.role::text IN ('admin', 'gestor') LOOP
        PERFORM public.lead_notificar(_g.user_id, _cv.organization_id, 'Possível número comercial',
          'Lead "' || coalesce((SELECT nome FROM public.leads WHERE id = _cv.lead_id), '') ||
          '": chegou resposta automática de empresa. A IA não respondeu. Confira o número em Leads.');
      END LOOP;
    END IF;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id, 'auto', true);
  END IF;
  PERFORM 1 FROM public.leads WHERE id = _cv.lead_id FOR UPDATE;
  UPDATE public.lead_conversas SET canal = 'ziontalk', updated_at = now() WHERE id = _cv.id AND canal <> 'ziontalk';
  _ctx := public.lead_ia_registrar_cliente(_cv.id,
            CASE WHEN _tipo = 'midia' AND _texto = '' THEN '[áudio ou arquivo recebido]' ELSE _texto END, 'recebida');
  UPDATE public.lead_ia_retorno_eventos SET resultado = 'ok', conversa_id = _cv.id WHERE id = _ev;

  IF _ctx->>'estado' IS DISTINCT FROM 'ativa' THEN
    IF _ctx->>'estado' = 'optout' THEN
      UPDATE public.lead_mensagens SET status = 'nao_enviada'
       WHERE conversa_id = _cv.id AND autor = 'ia' AND status = 'pendente';
    END IF;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id);
  END IF;
  SELECT count(*) INTO _n FROM public.lead_mensagens WHERE conversa_id = _cv.id AND autor = 'ia';
  -- t_228659f0 item 4 (7ebaa6bb): no limite, o cliente recebia NADA. Agora:
  --  (b) visita sendo combinada (passo visita, dia sem período ou fala de dia/período/visita depois do convite):
  --      até +4 respostas para terminar; passado isso, passa como 'visita' (não 'limite');
  --  (a) ao passar, 1 aviso curto ao cliente (mesmo caminho/allowlist das respostas). encerrada_em é marcado por
  --      lead_ia_passar: a próxima mensagem do cliente sem resposta da equipe recebe o aviso de espera (10 min).
  _vis := _cv.passo = 'visita' OR coalesce(_cv.dados->>'visita_dia_pendente', '') <> ''
          OR (coalesce(_cv.dados->>'convite_visita', '') = 'true'
              AND public.lead_ia_norm(_texto) ~ '(visit|agend|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|manha|tarde|noite|horario)');
  IF _n >= _c.ia_resp_max_conversa AND NOT (_vis AND _n < _c.ia_resp_max_conversa + 4) THEN
    IF _vis THEN
      PERFORM public.lead_ia_passar(_cv.id, 'visita',
        'Conversa longa, cliente combinando a visita: "' || left(_texto, 120) || '". Confirme o dia e o horário com ele.');
      _aviso := 'Anotei! Um corretor da nossa equipe continua seu atendimento por aqui para combinar a visita.';
    ELSE
      PERFORM public.lead_ia_passar(_cv.id, 'limite', 'Conversa longa: a IA parou e o atendimento segue com você.');
      _aviso := 'Obrigada pela conversa! Um corretor da nossa equipe continua seu atendimento por aqui.';
    END IF;
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_cv.organization_id, _cv.id, 'sistema', _aviso, public.lead_ia_status_saida(_cv.id));
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id);
  END IF;
  -- t_a9f1b447: nenhuma mensagem do cliente fica sem resposta. Saiu o limite \"2 respostas por minuto na
  -- conversa\": em rajada do cliente, lead_ia_aplicar (controle de versão) já grava só a resposta da mensagem
  -- mais nova. O limite por minuto da imobiliária continua.
  IF (SELECT count(*) FROM public.lead_ia_retorno_eventos WHERE organization_id = _c.organization_id
        AND resultado = 'responder' AND created_at > now() - interval '1 minute') >= _c.ia_resp_max_minuto THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'limite_minuto' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id, 'limite', true);
  END IF;
  UPDATE public.lead_ia_retorno_eventos SET resultado = 'responder' WHERE id = _ev;
  RETURN jsonb_build_object('r', 'ok', 'responder', true, 'lead_id', _cv.lead_id, 'tipo', _tipo,
    'organization_id', _c.organization_id, 'ia_modelo_provedor', _c.ia_modelo_provedor, 'ia_modelo', _c.ia_modelo,
    'ctx', _ctx);
END $function$;

COMMIT;
