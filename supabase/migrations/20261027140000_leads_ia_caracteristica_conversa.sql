-- Nicole: busca por característica + mensagem nunca sem resposta + conversa certa (card t_a9f1b447, teste ao
-- vivo de Denis 27/10/2026, lead 59538211, tópico 6238).
--
-- Rollback: docs/sql/rollback/20261027140000_leads_ia_caracteristica_conversa.rollback.sql
-- Depende de 20261025200000 (lead_ia_retorno_receber), 20261027080000 (negocio, xml_url_anuncio_ok,
-- lead_ia_reais_curto), 20261026190000 (lead_ia_num), 20261026170000 (lead_ia_tipo). Aplicar DEPOIS delas.
--
-- 1) lead_ia_imoveis_caracteristica (NOVA, só leitura): \"Tem alguma opção de 3 suítes?\" vira filtro no XML da
--    PRÓPRIA imobiliária (suítes, quartos, vagas, área mínima, tipo, bairro, negócio), na cidade do imóvel do lead.
--    Devolve {itens: dentro da faixa (até 3), proximo: o mais em conta fora da faixa que atende o pedido}.
-- 2) lead_ia_retorno_receber (ALTERADA, 2 pontos; o resto é igual à 20261025200000):
--    a) CONVERSA CERTA: a mensagem vai para a conversa do lead MAIS RECENTE desse telefone. Antes, a preferência
--       era \"conversa ativa\": quando o lead novo foi passado ao corretor, a mensagem seguinte caiu numa conversa
--       de teste antiga (25/10) que ainda estava ativa. Se a conversa mais recente já foi passada, a mensagem fica
--       registrada nela e a IA não responde (o corretor vê). A IA nunca responde numa conversa antiga.
--    b) NUNCA SEM RESPOSTA: o limite \"2 respostas por minuto na conversa\" deixava a mensagem do cliente sem
--       resposta (\"Teria com 3 suítes?\", 09:06:19). Saiu. Em rajada, lead_ia_aplicar (controle de versão) já grava
--       só a resposta da mensagem mais nova. O limite por minuto da imobiliária (ia_resp_max_minuto) e o total
--       por conversa continuam iguais.
--    Não muda canal, allowlist, fila, opt-out, token, dedup nem o limite \"é robô?\".
BEGIN;

CREATE OR REPLACE FUNCTION public.lead_ia_imoveis_caracteristica(_conversa uuid, _negocio text DEFAULT 'venda',
  _suites integer DEFAULT NULL, _quartos integer DEFAULT NULL, _vagas integer DEFAULT NULL, _area numeric DEFAULT NULL,
  _tipo text DEFAULT NULL, _bairro text DEFAULT NULL, _preco_min numeric DEFAULT NULL, _preco_max numeric DEFAULT NULL,
  _cidade text DEFAULT NULL, _excluir text[] DEFAULT '{}', _limite integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _run uuid; _ex text[]; _itens jsonb; _prox jsonb;
  _b text := nullif(left(public.lead_ia_norm(btrim(coalesce(_bairro, ''))), 60), '');
  _c text := nullif(left(public.lead_ia_norm(btrim(coalesce(_cidade, ''))), 60), '');
BEGIN
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa;
  IF _cv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id AND organization_id = _cv.organization_id;
  IF _l.id IS NULL THEN RETURN NULL; END IF;
  IF _negocio IS NULL OR _negocio NOT IN ('venda', 'locacao') THEN RAISE EXCEPTION 'Negocio invalido' USING ERRCODE = '22023'; END IF;
  IF _tipo IS NOT NULL AND _tipo NOT IN ('apartamento', 'casa', 'terreno', 'cobertura', 'studio', 'imóvel comercial') THEN
    RAISE EXCEPTION 'Tipo invalido' USING ERRCODE = '22023';
  END IF;
  IF (_suites IS NOT NULL AND _suites NOT BETWEEN 1 AND 10) OR (_quartos IS NOT NULL AND _quartos NOT BETWEEN 1 AND 10)
     OR (_vagas IS NOT NULL AND _vagas NOT BETWEEN 1 AND 10) OR (_area IS NOT NULL AND _area NOT BETWEEN 1 AND 100000)
     OR (_preco_min IS NOT NULL AND (_preco_min < 0 OR _preco_min > 1e11))
     OR (_preco_max IS NOT NULL AND (_preco_max <= 0 OR _preco_max > 1e11))
     OR char_length(coalesce(_bairro, '')) > 60 OR char_length(coalesce(_cidade, '')) > 60 THEN
    RAISE EXCEPTION 'Filtro invalido' USING ERRCODE = '22023';
  END IF;
  _run := (public.remax_xml_last_ok(_cv.organization_id)).id;
  IF _run IS NULL THEN RETURN jsonb_build_object('itens', '[]'::jsonb, 'proximo', NULL); END IF;
  _ex := ARRAY(SELECT public.portal_code_key(btrim(e)) FROM unnest(coalesce(_excluir, '{}')) e
                WHERE char_length(btrim(coalesce(e, ''))) BETWEEN 1 AND 60 LIMIT 20)
         || ARRAY[public.portal_code_key(coalesce(nullif(btrim(_l.anuncio_codigo), ''), '-'))]
         || ARRAY[public.portal_code_key(coalesce(nullif(btrim(_cv.dados->>'imovel_xml_codigo'), ''), '-'))];

  WITH c AS (
  SELECT row_number() OVER (ORDER BY x.pv, x.code) AS ord, x.pv,
         jsonb_strip_nulls(jsonb_build_object(
           'codigo', x.code,
           'tipo', public.lead_ia_tipo(x.tipo),
           'bairro', left(nullif(btrim(x.bairro), ''), 60),
           'cidade', left(nullif(btrim(x.cidade), ''), 60),
           'quartos', x.quartos::text,
           'suites', x.suites::text,
           'vagas', x.vagas::text,
           'area_util_m2', public.lead_ia_num(x.area_util),
           'area_terreno_m2', public.lead_ia_num(x.area_terreno),
           'preco', CASE WHEN _negocio = 'venda' THEN public.lead_ia_reais_curto(x.pv) END,
           'aluguel', CASE WHEN _negocio = 'locacao' THEN public.lead_ia_reais_curto(x.pv) END,
           'url', CASE WHEN public.xml_url_anuncio_ok(x.url) THEN x.url END)) AS j
    FROM (SELECT y.*, CASE WHEN _negocio = 'locacao' THEN y.preco_aluguel ELSE y.preco END AS pv
            FROM public.remax_xml_listings y
           WHERE y.organization_id = _cv.organization_id AND y.last_run = _run
             AND CASE WHEN _negocio = 'locacao' THEN y.negocio IN ('locacao', 'venda_locacao')
                      ELSE y.negocio IN ('venda', 'venda_locacao') END) x
   WHERE x.pv > 0
     AND (_suites IS NULL OR coalesce(x.suites, 0) >= _suites)
     AND (_quartos IS NULL OR coalesce(x.quartos, 0) >= _quartos)
     AND (_vagas IS NULL OR coalesce(x.vagas, 0) >= _vagas)
     AND (_area IS NULL OR coalesce(x.area_util, 0) >= _area)
     AND (_tipo IS NULL OR public.lead_ia_tipo(x.tipo) = _tipo)
     AND (_b IS NULL OR public.lead_ia_norm(x.bairro) LIKE '%' || _b || '%')
     AND (_c IS NULL OR public.lead_ia_norm(btrim(x.cidade)) = _c)
     AND NOT (x.code_key = ANY (_ex))
  ),
  dentro AS (
    SELECT j, row_number() OVER (ORDER BY abs(pv - coalesce((_preco_min + _preco_max) / 2, _preco_max, _preco_min, pv)), ord) AS o
      FROM c WHERE pv BETWEEN coalesce(_preco_min, 0) AND coalesce(_preco_max, 1e12)
  )
  SELECT (SELECT coalesce(jsonb_agg(j ORDER BY o), '[]'::jsonb) FROM dentro
           WHERE o <= least(greatest(coalesce(_limite, 3), 1), 3)),
         -- Nada na faixa: o mais próximo (acima do teto, o mais barato; abaixo do piso, o mais caro).
         CASE WHEN NOT EXISTS (SELECT 1 FROM dentro) THEN
           (SELECT j FROM c ORDER BY CASE WHEN pv > coalesce(_preco_max, 1e12) THEN pv - _preco_max
                                         ELSE coalesce(_preco_min, 0) - pv END, ord LIMIT 1) END
    INTO _itens, _prox;
  RETURN jsonb_build_object('itens', _itens, 'proximo', _prox);
END $$;

REVOKE ALL ON FUNCTION public.lead_ia_imoveis_caracteristica(uuid, text, integer, integer, integer, numeric, text, text, numeric, numeric, text, text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_imoveis_caracteristica(uuid, text, integer, integer, integer, numeric, text, text, numeric, numeric, text, text[], integer)
  TO service_role;

-- 2) Retorno ZionTalk: conversa do lead mais recente + sem \"limite por minuto\" deixando o cliente sem resposta.
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

  -- t_a9f1b447: a conversa do lead MAIS RECENTE desse telefone (a que a Nicole abriu por último), esteja ela
  -- ativa ou não. Nunca pula para uma conversa antiga só porque ela ficou \"ativa\".
  SELECT cv.* INTO _cv FROM public.lead_conversas cv JOIN public.leads l ON l.id = cv.lead_id
   WHERE cv.organization_id = _c.organization_id AND l.organization_id = _c.organization_id AND NOT l.simulado
     AND _chave = ANY (public.lead_ia_contatos(l.telefone, NULL))
   ORDER BY cv.created_at DESC, cv.id DESC LIMIT 1;
  IF _cv.id IS NULL THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'desconhecido' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'desconhecido');
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
  IF _n >= _c.ia_resp_max_conversa THEN
    PERFORM public.lead_ia_passar(_cv.id, 'limite', 'Conversa longa: a IA parou e o atendimento segue com você.');
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
END $$;

REVOKE ALL ON FUNCTION public.lead_ia_retorno_receber(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_retorno_receber(text, jsonb) TO service_role;

COMMIT;
