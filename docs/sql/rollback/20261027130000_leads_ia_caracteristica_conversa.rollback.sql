-- Rollback de 20261027130000_leads_ia_caracteristica_conversa.sql (card t_a9f1b447).
-- Remove a busca por característica e devolve lead_ia_retorno_receber EXATAMENTE como na 20261025200000
-- (copiado de lá: conversa "ativa primeiro" e limite de 2 respostas por minuto na conversa). Nenhum dado é apagado.
-- Sem a função de característica, a Nicole responde "vou procurar opções com X e já te mando".
BEGIN;
DROP FUNCTION IF EXISTS public.lead_ia_imoveis_caracteristica(uuid, text, integer, integer, integer, numeric, text, text, numeric, numeric, text, text[], integer);

CREATE OR REPLACE FUNCTION public.lead_ia_retorno_receber(_token text, _msg jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.lead_config; _ok boolean; _id text; _chave text; _tipo text; _texto text;
  _cv public.lead_conversas; _ctx jsonb; _ev bigint; _n integer;
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
  -- Sem o número do próprio canal cadastrado não dá para ignorar o eco do próprio número: fica desligado.
  IF NOT coalesce(_ok, false) OR NOT _c.ia_ativa OR _c.ia_canal <> 'ziontalk' OR _c.ia_canal_numero IS NULL THEN
    RETURN jsonb_build_object('r', 'desligada');
  END IF;
  IF _msg IS NULL OR jsonb_typeof(_msg) <> 'object' THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
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
  _tipo := CASE WHEN _msg->>'tipo' = 'midia' THEN 'midia' ELSE 'texto' END;
  _texto := left(btrim(coalesce(_msg->>'texto', '')), 1000);
  IF _tipo = 'texto' AND _texto = '' THEN RETURN jsonb_build_object('r', 'ignorado'); END IF;

  -- Deduplicação (o hash inclui a imobiliária: o mesmo id em outra imobiliária não colide).
  DELETE FROM public.lead_ia_retorno_eventos
   WHERE organization_id = _c.organization_id AND created_at < now() - interval '30 days';
  INSERT INTO public.lead_ia_retorno_eventos (organization_id, externo_hash, resultado)
  VALUES (_c.organization_id, encode(extensions.digest(_c.organization_id::text || ':' || _id, 'sha256'), 'hex'), 'recebido')
  ON CONFLICT (organization_id, externo_hash) DO NOTHING RETURNING id INTO _ev;
  IF _ev IS NULL THEN RETURN jsonb_build_object('r', 'duplicado'); END IF;

  IF NOT (_chave = ANY (_c.ia_envio_allowlist)) THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'fora_lista' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'fora_lista');
  END IF;

  -- Lead real (não simulado) da MESMA imobiliária com esse telefone e com conversa da IA. Prefere a ativa.
  SELECT cv.* INTO _cv FROM public.lead_conversas cv JOIN public.leads l ON l.id = cv.lead_id
   WHERE cv.organization_id = _c.organization_id AND l.organization_id = _c.organization_id AND NOT l.simulado
     AND _chave = ANY (public.lead_ia_contatos(l.telefone, NULL))
   ORDER BY (cv.estado = 'ativa') DESC, cv.created_at DESC LIMIT 1;
  IF _cv.id IS NULL THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'desconhecido' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'desconhecido');
  END IF;

  -- Mesma ordem de trava do lead_ia_aplicar (lead, depois conversa): sem deadlock com a resposta.
  PERFORM 1 FROM public.leads WHERE id = _cv.lead_id FOR UPDATE;
  -- Contato liberado escrevendo pelo WhatsApp: a conversa passa (ou volta) para o canal real.
  UPDATE public.lead_conversas SET canal = 'ziontalk', updated_at = now() WHERE id = _cv.id AND canal <> 'ziontalk';
  _ctx := public.lead_ia_registrar_cliente(_cv.id,
            CASE WHEN _tipo = 'midia' AND _texto = '' THEN '[áudio ou arquivo recebido]' ELSE _texto END, 'recebida');
  UPDATE public.lead_ia_retorno_eventos SET resultado = 'ok', conversa_id = _cv.id WHERE id = _ev;

  IF _ctx->>'estado' IS DISTINCT FROM 'ativa' THEN
    -- SAIR: perguntas da IA ainda não enviadas são canceladas; só a confirmação de saída pode sair.
    IF _ctx->>'estado' = 'optout' THEN
      UPDATE public.lead_mensagens SET status = 'nao_enviada'
       WHERE conversa_id = _cv.id AND autor = 'ia' AND status = 'pendente';
    END IF;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id);
  END IF;
  -- Limite total de respostas da IA nesta conversa: passa ao corretor.
  SELECT count(*) INTO _n FROM public.lead_mensagens WHERE conversa_id = _cv.id AND autor = 'ia';
  IF _n >= _c.ia_resp_max_conversa THEN
    PERFORM public.lead_ia_passar(_cv.id, 'limite', 'Conversa longa: a IA parou e o atendimento segue com você.');
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id);
  END IF;
  -- Por minuto: 2 respostas na conversa e ia_resp_max_minuto na imobiliária. A mensagem fica gravada;
  -- a próxima mensagem do cliente recebe resposta normalmente.
  IF (SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = _cv.id AND autor IN ('ia', 'sistema')
        AND created_at > now() - interval '1 minute') >= 2
     -- Na imobiliária conta as respostas já LIBERADAS (eventos 'responder'): a resposta é gravada segundos depois.
     OR (SELECT count(*) FROM public.lead_ia_retorno_eventos WHERE organization_id = _c.organization_id
        AND resultado = 'responder' AND created_at > now() - interval '1 minute') >= _c.ia_resp_max_minuto THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'limite_minuto' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id, 'limite', true);
  END IF;
  UPDATE public.lead_ia_retorno_eventos SET resultado = 'responder' WHERE id = _ev;
  RETURN jsonb_build_object('r', 'ok', 'responder', true, 'lead_id', _cv.lead_id, 'tipo', _tipo,
    'organization_id', _c.organization_id, 'ia_modelo_provedor', _c.ia_modelo_provedor, 'ia_modelo', _c.ia_modelo,
    'ctx', _ctx);
END $$;

REVOKE ALL ON FUNCTION public.lead_ia_retorno_receber(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_retorno_receber(text, jsonb) TO service_role;
COMMIT;
