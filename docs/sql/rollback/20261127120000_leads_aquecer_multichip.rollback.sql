-- Rollback de 20261127120000_leads_aquecer_multichip (t_879234c7).
-- Restaura as 10 funções como estavam em PRODUÇÃO antes da migration (pg_get_functiondef de 16/11/2026),
-- apaga as funções novas, a tabela de chips e a coluna nova de pausas. As colunas antigas de lead_config nunca
-- foram apagadas: o chip 1 (aquecer_chip_numero + aquecer_retorno_token_hash) volta a valer como antes.
-- ANTES: desligue o envio real (wrangler secret delete LEADS_AQUECER_ENVIO_REAL) e volte o Worker.
-- Envios/aquecimentos feitos pelo chip 2 continuam nas tabelas (chip_numero preenchido), só sem o cadastro do chip.
BEGIN;

CREATE OR REPLACE FUNCTION public.lead_aquecer_freio(_org uuid, _chip text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.lead_config; _tot integer; _fal integer; _env integer; _opt integer; _o record;
BEGIN
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN RETURN NULL; END IF;
  -- Falha de envio nas últimas 24 h (no chip real, somando todas as imobiliárias dele).
  SELECT count(*), count(*) FILTER (WHERE e.status = 'falhou') INTO _tot, _fal FROM public.lead_aquecer_envios e
   WHERE e.created_at > now() - interval '24 hours' AND e.status <> 'enviando'
     AND (CASE WHEN _chip IS NOT NULL THEN e.modo_real AND e.chip_numero = _chip ELSE e.organization_id = _org END);
  IF _tot >= _c.aquecer_freio_min AND _fal::numeric / _tot >= _c.aquecer_freio_taxa THEN
    FOR _o IN SELECT organization_id FROM public.lead_config
               WHERE organization_id = _org OR (_chip IS NOT NULL AND aquecer_chip_numero = _chip) LOOP
      PERFORM public.lead_aquecer_pausar_interno(_o.organization_id, 'taxa de falha de envio alta',
        jsonb_build_object('tentativas_24h', _tot, 'falhas_24h', _fal, 'limite', _c.aquecer_freio_taxa));
    END LOOP;
    RETURN 'taxa_falha';
  END IF;
  -- Opt-out (proxy de bloqueio/denúncia) nos últimos 7 dias da imobiliária.
  SELECT count(*) FILTER (WHERE a.enviado_em IS NOT NULL), count(*) FILTER (WHERE a.estado = 'optout')
    INTO _env, _opt FROM public.lead_aquecer a
   WHERE a.organization_id = _org AND a.created_at > now() - interval '7 days';
  IF _env >= _c.aquecer_freio_min AND _opt::numeric / _env >= _c.aquecer_freio_taxa THEN
    PERFORM public.lead_aquecer_pausar_interno(_org, 'muitos pedidos para sair',
      jsonb_build_object('enviados_7d', _env, 'optouts_7d', _opt, 'limite', _c.aquecer_freio_taxa));
    RETURN 'optouts';
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_preparar(_chip text DEFAULT NULL::text, _agora timestamp with time zone DEFAULT now())
 RETURNS TABLE(envio_id uuid, lead_id uuid, telefone text, texto text, modo_real boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _c public.lead_config; _real boolean; _a public.lead_aquecer; _l public.leads; _cv public.lead_conversas;
  _txt text; _org text; _ia text; _frase text; _env uuid; _n integer := 0;
BEGIN
  IF _chip IS NOT NULL AND _chip !~ '^[0-9]{10,11}$' THEN RAISE EXCEPTION 'Chip invalido' USING ERRCODE = '22023'; END IF;
  FOR _c IN
    SELECT c.* FROM public.lead_config c
      JOIN public.organizations o ON o.id = c.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = c.organization_id AND m.module = 'leads' AND m.enabled
     WHERE c.aquecer_ativo AND c.aquecer_pausado_em IS NULL AND c.ia_ativa
       AND public.lead_aquecer_horario(c.ia_domingo, _agora)
       AND (c.aquecer_proximo_em IS NULL OR c.aquecer_proximo_em <= now())
     ORDER BY c.aquecer_proximo_em NULLS FIRST
     LIMIT 10
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    EXIT WHEN _n >= 5;
    _real := _chip IS NOT NULL AND _c.aquecer_chip_numero = _chip;
    -- Limpeza da imobiliária: quem pediu SAIR fecha como optout; lembrete sem resposta vira frio; o 1º envio
    -- esquecido (lead ganho/perdido/assumido) fecha como frio depois de 2 janelas.
    UPDATE public.lead_aquecer a SET estado = 'optout', finalizado_em = now(), updated_at = now()
      FROM public.leads l
     WHERE a.organization_id = _c.organization_id AND a.estado IN ('enviado', 'lembrete') AND l.id = a.lead_id
       AND EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = a.organization_id
                    AND op.contato = ANY (public.lead_ia_contatos(l.telefone, l.email)));
    WITH f AS (
      UPDATE public.lead_aquecer a SET estado = 'frio', finalizado_em = now(), updated_at = now()
       WHERE a.organization_id = _c.organization_id
         AND ((a.estado = 'lembrete' AND a.lembrete_em <= now() - make_interval(days => _c.aquecer_lembrete_dias))
           OR (a.estado = 'enviado' AND a.enviado_em <= now() - make_interval(days => 2 * _c.aquecer_lembrete_dias)))
      RETURNING a.organization_id, a.lead_id, a.modo_real)
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    SELECT f.organization_id, f.lead_id, 'ia', 'aquecer_frio',
           'Aquecimento: o cliente não respondeu à mensagem nem ao lembrete. Marcado como frio.'
           || CASE WHEN f.modo_real THEN '' ELSE ' (modo teste)' END
      FROM f;
    -- Intervalo do chip real: nenhum envio real neste chip há aquecer_intervalo_min_s (vale entre imobiliárias).
    CONTINUE WHEN _real AND EXISTS (SELECT 1 FROM public.lead_aquecer_envios e WHERE e.modo_real AND e.chip_numero = _chip
                                     AND e.created_at > now() - make_interval(secs => _c.aquecer_intervalo_min_s));
    CONTINUE WHEN public.lead_aquecer_enviados_hoje(_c.organization_id, CASE WHEN _real THEN _chip END, _agora)
                  >= public.lead_aquecer_limite_hoje(_c, _agora);
    _org := public.lead_ia_org_nome(_c.organization_id);
    _ia := coalesce(nullif(btrim(_c.ia_nome), ''), 'Nicole');
    _a := NULL; _txt := NULL;
    -- a) Lembrete (1 só): enviado há aquecer_lembrete_dias, sem resposta e sem a equipe ter mexido no lead desde então.
    SELECT a.* INTO _a FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id
     WHERE a.organization_id = _c.organization_id AND a.estado = 'enviado' AND a.respondeu_em IS NULL
       AND a.modo_real = _real
       AND a.enviado_em <= now() - make_interval(days => _c.aquecer_lembrete_dias)
       AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido') AND l.sale_id IS NULL
       -- Lista de liberados da Nicole (modo 'lista'): lembrete só para número da lista.
       AND public.lead_aquecer_na_lista(_c, l.telefone)
       AND (l.proximo_contato_em IS NULL OR l.proximo_contato_em <= now())
       AND NOT EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = l.organization_id
                        AND op.contato = ANY (public.lead_ia_contatos(l.telefone, l.email)))
       AND NOT EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = l.id AND e.autor_id IS NOT NULL
                        AND e.created_at > a.enviado_em)
     ORDER BY a.enviado_em
     LIMIT 1
     FOR UPDATE OF a SKIP LOCKED;
    IF _a.id IS NOT NULL THEN
      SELECT * INTO _l FROM public.leads WHERE id = _a.lead_id;
      _txt := public.lead_aquecer_texto('lembrete', public.lead_aquecer_nome(_l.nome), NULL, _ia, _org, _l.id::text || ':l');
      INSERT INTO public.lead_aquecer_envios (organization_id, aquecer_id, tipo, texto, modo_real, chip_numero)
      VALUES (_c.organization_id, _a.id, 'lembrete', _txt, _real, CASE WHEN _real THEN _chip END) RETURNING id INTO _env;
      UPDATE public.lead_aquecer SET estado = 'lembrete', lembrete_em = now(), updated_at = now() WHERE id = _a.id;
    ELSE
      -- b) Lead novo: parado há aquecer_dias ou mais. Pré-filtro barato antes da regra completa; o mais "morno" primeiro.
      SELECT l.* INTO _l FROM public.leads l
       WHERE l.organization_id = _c.organization_id AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido')
         AND l.funil = 'venda' AND l.telefone IS NOT NULL
         -- Lista de liberados da Nicole (modo 'lista'): só número da lista (mesma regra de lead_ia_liberado).
         AND public.lead_aquecer_na_lista(_c, l.telefone)
         AND l.created_at <= now() - make_interval(days => _c.aquecer_dias)
         AND coalesce(l.ultima_interacao_em, l.created_at) <= now() - make_interval(days => _c.aquecer_dias)
         AND public.lead_aquecer_elegivel(l, _c.aquecer_dias)
         -- Modo teste nunca mexe em conversa ativa da Nicole (só leads sem conversa ativa entram na simulação).
         AND (_real OR NOT EXISTS (SELECT 1 FROM public.lead_conversas cv0 WHERE cv0.lead_id = l.id AND cv0.estado = 'ativa'))
       ORDER BY public.lead_aquecer_ultima_interacao(l) DESC, l.id
       LIMIT 1
       FOR UPDATE OF l SKIP LOCKED;
      CONTINUE WHEN _l.id IS NULL;
      _frase := public.lead_aquecer_frase(_l);
      _txt := public.lead_aquecer_texto('primeira', public.lead_aquecer_nome(_l.nome), _frase, _ia, _org, _l.id::text);
      IF NOT public.lead_aquecer_texto_ok(_txt, _org) THEN
        _txt := public.lead_aquecer_texto('primeira', public.lead_aquecer_nome(_l.nome), NULL, _ia, _org, _l.id::text);
      END IF;
      CONTINUE WHEN NOT public.lead_aquecer_texto_ok(_txt, _org);
      -- Conversa do lead (a mesma da Nicole). Sem conversa: abre uma PARADA (a Nicole só fala depois do "sim").
      -- Conversa ativa antiga: pausa em silêncio para os lembretes de 24/72 h e o de 15 min não dispararem.
      SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _l.id FOR UPDATE;
      IF _cv.id IS NULL THEN
        INSERT INTO public.lead_conversas (organization_id, lead_id, canal, estado, passo, encerrada_em, resumo)
        VALUES (_l.organization_id, _l.id, CASE WHEN _real THEN 'ziontalk' ELSE 'teste' END, 'parada', 'fim', now(),
                'Conversa aberta pelo aquecimento de lead parado.')
        RETURNING * INTO _cv;
      ELSIF _cv.estado = 'ativa' THEN
        UPDATE public.lead_conversas SET estado = 'parada', passo = 'fim', encerrada_em = now(), updated_at = now(),
               resumo = left(coalesce(resumo || ' ', '') || 'IA pausada: aquecimento de lead parado.', 1000)
         WHERE id = _cv.id;
      END IF;
      INSERT INTO public.lead_aquecer (organization_id, lead_id, conversa_id, estado, modo_real, chip_numero)
      VALUES (_l.organization_id, _l.id, _cv.id, 'enviando', _real, CASE WHEN _real THEN _chip END) RETURNING * INTO _a;
      INSERT INTO public.lead_aquecer_envios (organization_id, aquecer_id, tipo, texto, modo_real, chip_numero)
      VALUES (_c.organization_id, _a.id, 'primeira', _txt, _real, CASE WHEN _real THEN _chip END) RETURNING id INTO _env;
    END IF;
    UPDATE public.lead_config
       SET aquecer_proximo_em = now() + make_interval(secs => _c.aquecer_intervalo_min_s
                                 + floor(random() * (_c.aquecer_intervalo_max_s - _c.aquecer_intervalo_min_s + 1))),
           aquecer_rampa_desde = coalesce(aquecer_rampa_desde, (_agora AT TIME ZONE 'America/Sao_Paulo')::date)
     WHERE organization_id = _c.organization_id;
    envio_id := _env; lead_id := _l.id; telefone := _l.telefone; texto := _txt; modo_real := _real;
    _n := _n + 1;
    RETURN NEXT;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_resultado(_envio uuid, _status text, _erro text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _e public.lead_aquecer_envios; _a public.lead_aquecer; _freio text; _o record;
BEGIN
  IF _status IS NULL OR _status NOT IN ('enviada', 'teste', 'falhou') OR (_erro IS NOT NULL AND _erro !~ '^[a-z0-9_]{1,40}$') THEN
    RAISE EXCEPTION 'Resultado invalido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.lead_aquecer_envios SET status = _status, erro = CASE WHEN _status = 'falhou' THEN coalesce(_erro, 'erro') END,
         resultado_em = now()
   WHERE id = _envio AND status = 'enviando' RETURNING * INTO _e;
  IF _e.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO _a FROM public.lead_aquecer WHERE id = _e.aquecer_id FOR UPDATE;
  IF _status IN ('enviada', 'teste') THEN
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_a.organization_id, _a.conversa_id, 'ia', left(_e.texto, 2000), CASE WHEN _status = 'enviada' THEN 'enviada' ELSE 'nao_enviada' END);
    UPDATE public.lead_aquecer SET estado = CASE WHEN _e.tipo = 'primeira' THEN 'enviado' ELSE estado END,
           enviado_em = coalesce(enviado_em, now()), updated_at = now()
     WHERE id = _a.id AND estado IN ('enviando', 'lembrete');
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_a.organization_id, _a.lead_id, 'ia', 'aquecer_' || _e.tipo,
            CASE _e.tipo WHEN 'primeira' THEN 'Aquecimento: mensagem enviada perguntando se o cliente ainda procura imóvel.'
                         ELSE 'Aquecimento: lembrete enviado (o último).' END
            || CASE WHEN _status = 'teste' THEN ' (modo teste: não enviada)' ELSE ' (chip do aquecimento)' END);
  ELSE
    UPDATE public.lead_aquecer SET estado = CASE WHEN _e.tipo = 'primeira' THEN 'falhou' ELSE estado END,
           finalizado_em = CASE WHEN _e.tipo = 'primeira' THEN now() ELSE finalizado_em END, updated_at = now()
     WHERE id = _a.id;
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_a.organization_id, _a.lead_id, 'ia', 'aquecer_falhou', 'Aquecimento: o envio falhou (' || coalesce(_erro, 'erro') || '). Não será repetido.');
    -- Erro de canal (chave recusada, canal inexistente/caído) pausa na hora todas as imobiliárias do chip.
    IF _erro IN ('http_401', 'http_403', 'http_404', 'http_410') THEN
      FOR _o IN SELECT organization_id FROM public.lead_config
                 WHERE organization_id = _e.organization_id OR (_e.modo_real AND aquecer_chip_numero = _e.chip_numero) LOOP
        PERFORM public.lead_aquecer_pausar_interno(_o.organization_id, 'erro no canal do chip (' || _erro || ')',
          jsonb_build_object('erro', _erro));
      END LOOP;
      RETURN jsonb_build_object('ok', true, 'freio', 'erro_canal');
    END IF;
  END IF;
  _freio := public.lead_aquecer_freio(_e.organization_id, CASE WHEN _e.modo_real THEN _e.chip_numero END);
  RETURN jsonb_build_object('ok', true, 'freio', _freio);
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_retorno_receber(_token text, _msg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.lead_config; _ok boolean; _id text; _chave text; _tipo text; _texto text; _ev bigint;
  _a public.lead_aquecer; _cv public.lead_conversas; _cls text; _ctx jsonb; _n integer;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT * INTO _c FROM public.lead_config
   WHERE aquecer_retorno_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex') FOR UPDATE;
  IF _c.organization_id IS NULL THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT (m.enabled AND o.status = 'ativa') INTO _ok FROM public.organization_modules m
    JOIN public.organizations o ON o.id = m.organization_id
   WHERE m.organization_id = _c.organization_id AND m.module = 'leads';
  IF NOT coalesce(_ok, false) OR NOT _c.ia_ativa THEN RETURN jsonb_build_object('r', 'desligada'); END IF;
  IF _msg IS NULL OR jsonb_typeof(_msg) <> 'object' THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  IF coalesce(_msg->>'grupo', '') = 'true' OR coalesce(_msg->>'status', '') = 'true' OR coalesce(_msg->>'proprio', '') = 'true' THEN
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  _id := btrim(coalesce(_msg->>'id', ''));
  IF char_length(_id) NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  _chave := (public.lead_ia_contatos(_msg->>'telefone', NULL))[1];
  IF _chave IS NULL OR _chave !~ '^[0-9]{10,11}$' OR _chave = _c.aquecer_chip_numero OR _chave = _c.ia_canal_numero THEN
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  _tipo := CASE WHEN _msg->>'tipo' = 'midia' THEN 'midia' ELSE 'texto' END;
  _texto := left(btrim(coalesce(_msg->>'texto', '')), 1000);
  IF _tipo = 'texto' AND _texto = '' THEN RETURN jsonb_build_object('r', 'ignorado'); END IF;
  -- Dedup no mesmo registro do retorno da Nicole, com prefixo próprio (ids dos dois chips nunca colidem).
  INSERT INTO public.lead_ia_retorno_eventos (organization_id, externo_hash, resultado)
  VALUES (_c.organization_id, encode(extensions.digest(_c.organization_id::text || ':aquecer:' || _id, 'sha256'), 'hex'), 'recebido')
  ON CONFLICT (organization_id, externo_hash) DO NOTHING RETURNING id INTO _ev;
  IF _ev IS NULL THEN RETURN jsonb_build_object('r', 'duplicado'); END IF;
  -- O aquecimento mais recente deste telefone na imobiliária. "nao"/"frio" ainda valem por 30 dias (ex.: "na verdade
  -- quero sim"). Opt-out nunca reabre.
  SELECT a.* INTO _a FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id AND l.organization_id = a.organization_id
   WHERE a.organization_id = _c.organization_id AND NOT l.simulado AND a.enviado_em IS NOT NULL
     AND _chave = ANY (public.lead_ia_contatos(l.telefone, NULL))
     AND (a.estado IN ('enviado', 'lembrete', 'retomado')
          OR (a.estado IN ('nao', 'frio') AND a.finalizado_em > now() - interval '30 days'))
   ORDER BY a.created_at DESC LIMIT 1
   FOR UPDATE OF a;
  IF _a.id IS NULL THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'desconhecido' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'desconhecido');
  END IF;
  PERFORM 1 FROM public.leads WHERE id = _a.lead_id FOR UPDATE;
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _a.conversa_id FOR UPDATE;
  IF _cv.id IS NULL THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'desconhecido' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'desconhecido');
  END IF;
  _texto := CASE WHEN _tipo = 'midia' AND _texto = '' THEN '[áudio ou arquivo recebido]' ELSE _texto END;
  IF _a.estado <> 'retomado' THEN
    _cls := CASE WHEN _tipo = 'midia' THEN 'outro' ELSE public.lead_aquecer_resposta_tipo(_texto) END;
    IF _cls IN ('optout', 'nao') THEN
      -- Conversa continua parada: registra a fala (o SAIR grava o opt-out em todos os leads do contato) e encerra.
      IF _cv.estado = 'ativa' THEN
        UPDATE public.lead_conversas SET estado = 'parada', passo = 'fim', encerrada_em = now(), updated_at = now() WHERE id = _cv.id;
      END IF;
      _ctx := public.lead_ia_registrar_cliente(_cv.id, _texto, 'recebida');
      -- (o SAIR já gravou o opt-out do contato dentro de lead_ia_registrar_cliente)
      UPDATE public.lead_aquecer SET estado = _cls, motivo = CASE WHEN _cls = 'nao' THEN public.lead_aquecer_motivo_nao(_texto) END,
             respondeu_em = coalesce(respondeu_em, now()), finalizado_em = now(), updated_at = now()
       WHERE id = _a.id;
      INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
      VALUES (_a.organization_id, _a.lead_id, 'ia', 'aquecer_' || _cls,
              CASE WHEN _cls = 'optout' THEN 'Aquecimento: o cliente pediu para não receber mais mensagens (SAIR).'
                   ELSE 'Aquecimento: o cliente respondeu que não procura mais imóvel ('
                        || replace(public.lead_aquecer_motivo_nao(_texto), '_', ' ') || '). Encerrado.' END);
      UPDATE public.lead_ia_retorno_eventos SET resultado = 'ok', conversa_id = _cv.id WHERE id = _ev;
      IF _cls = 'optout' THEN
        PERFORM public.lead_aquecer_freio(_c.organization_id, NULL);
      END IF;
      RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id);
    END IF;
    -- "Sim" (ou qualquer outra fala): a Nicole retoma a conversa normal do lead.
    UPDATE public.lead_conversas
       SET estado = 'ativa', passo = 'interesse', motivo_fim = NULL, encerrada_em = NULL,
           -- Real: sai pelo chip do aquecimento (lead_aquecer_chip_do_lead = 'aquecer'). Modo teste: o canal da conversa
           -- não muda e as respostas ficam "não enviada" (chip_do_lead = 'aquecer_teste' barra os dois chips).
           canal = CASE WHEN _a.modo_real THEN 'ziontalk' ELSE canal END,
           primeira_enviada_em = coalesce(primeira_enviada_em, _a.enviado_em, now()),
           dados = dados || jsonb_build_object('aquecer', true), updated_at = now()
     WHERE id = _cv.id;
    UPDATE public.lead_aquecer SET estado = 'retomado', motivo = NULL, respondeu_em = coalesce(respondeu_em, now()),
           retomado_em = now(), finalizado_em = NULL, updated_at = now()
     WHERE id = _a.id;
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_a.organization_id, _a.lead_id, 'ia', 'aquecer_retomado',
            'Aquecimento: o cliente respondeu e voltou a procurar imóvel. A '
            || coalesce(nullif(btrim(_c.ia_nome), ''), 'IA') || ' retomou a conversa.');
  END IF;
  _ctx := public.lead_ia_registrar_cliente(_cv.id, _texto, 'recebida');
  UPDATE public.lead_ia_retorno_eventos SET resultado = 'ok', conversa_id = _cv.id WHERE id = _ev;
  IF _ctx->>'estado' = 'optout' THEN
    UPDATE public.lead_aquecer SET estado = 'optout', finalizado_em = now(), updated_at = now() WHERE id = _a.id;
    PERFORM public.lead_aquecer_freio(_c.organization_id, NULL);
  END IF;
  IF _ctx->>'estado' IS DISTINCT FROM 'ativa' THEN
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id);
  END IF;
  -- Aquecimento desligado ou pausado (freio): a fala fica registrada na conversa, mas a Nicole não responde pelo chip.
  IF NOT _c.aquecer_ativo OR _c.aquecer_pausado_em IS NOT NULL THEN
    -- (resultado 'ok': a tabela do retorno da Nicole não tem um valor 'pausado' e não é alterada aqui)
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id, 'pausado', true);
  END IF;
  PERFORM public.lead_ia_encaminhar_cedo(_cv.id);
  -- Mesmos limites do retorno da Nicole (conversa longa passa ao corretor; limite por minuto da imobiliária).
  -- Conta só as respostas da IA depois da retomada (a conversa antiga e as mensagens do aquecimento não contam).
  SELECT count(*) INTO _n FROM public.lead_mensagens WHERE conversa_id = _cv.id AND autor = 'ia'
     AND created_at >= coalesce(_a.retomado_em, now());
  IF _n >= _c.ia_resp_max_conversa THEN
    PERFORM public.lead_ia_passar(_cv.id, 'limite', 'Conversa longa: a IA parou e o atendimento segue com você.');
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id);
  END IF;
  IF (SELECT count(*) FROM public.lead_ia_retorno_eventos WHERE organization_id = _c.organization_id
        AND resultado = 'responder' AND created_at > now() - interval '1 minute') >= _c.ia_resp_max_minuto THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'limite_minuto' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id, 'limite', true);
  END IF;
  UPDATE public.lead_ia_retorno_eventos SET resultado = 'responder' WHERE id = _ev;
  RETURN jsonb_build_object('r', 'ok', 'responder', true, 'lead_id', _a.lead_id, 'tipo', _tipo,
    'organization_id', _c.organization_id, 'ia_modelo_provedor', _c.ia_modelo_provedor, 'ia_modelo', _c.ia_modelo,
    'ctx', _ctx);
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_envio_reservar(_lead uuid, _chip text)
 RETURNS TABLE(msg_id uuid, telefone text, texto text, primeira boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _a public.lead_aquecer; _m public.lead_mensagens;
BEGIN
  IF _chip IS NULL OR _chip !~ '^[0-9]{10,11}$' THEN RETURN; END IF;
  IF public.lead_aquecer_chip_do_lead(_lead) <> 'aquecer' THEN RETURN; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _lead FOR UPDATE;
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _lead FOR UPDATE;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _l.organization_id;
  SELECT * INTO _a FROM public.lead_aquecer WHERE lead_id = _lead AND organization_id = _l.organization_id
   ORDER BY created_at DESC LIMIT 1;
  IF _l.id IS NULL OR _cv.id IS NULL OR _c.organization_id IS NULL OR _a.id IS NULL THEN RETURN; END IF;
  IF _l.simulado OR _l.telefone IS NULL OR _cv.canal <> 'ziontalk' OR _cv.id <> _a.conversa_id
     OR NOT _c.ia_ativa OR NOT _c.aquecer_ativo OR _c.aquecer_pausado_em IS NOT NULL
     OR _a.chip_numero IS DISTINCT FROM _chip OR _c.aquecer_chip_numero IS DISTINCT FROM _chip
     OR NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE organization_id = _l.organization_id
                     AND module = 'leads' AND enabled)
     OR EXISTS (SELECT 1 FROM public.lead_ia_optouts WHERE organization_id = _l.organization_id
                 AND contato = ANY (public.lead_ia_contatos(_l.telefone, _l.email))) THEN
    RETURN;
  END IF;
  SELECT * INTO _m FROM public.lead_mensagens WHERE conversa_id = _cv.id AND status = 'pendente'
   ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF _m.id IS NULL THEN RETURN; END IF;
  UPDATE public.lead_mensagens SET status = 'enviando' WHERE id = _m.id;
  msg_id := _m.id; telefone := _l.telefone; texto := _m.texto; primeira := false;
  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_pendentes(_chip text)
 RETURNS TABLE(lead_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT DISTINCT ON (a.lead_id) a.lead_id
    FROM public.lead_aquecer a
    JOIN public.lead_config c ON c.organization_id = a.organization_id
    JOIN public.lead_conversas cv ON cv.id = a.conversa_id
   WHERE _chip IS NOT NULL AND a.estado = 'retomado' AND a.modo_real AND a.chip_numero = _chip
     AND c.aquecer_chip_numero = _chip AND c.aquecer_pausado_em IS NULL
     AND EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = cv.id AND m.status = 'pendente')
     AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = cv.id AND m.status = 'enviando')
   ORDER BY a.lead_id
   LIMIT 5
$function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_falha_canal(_chip text, _erro text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _o record; _p boolean := false;
BEGIN
  IF _chip IS NULL OR _chip !~ '^[0-9]{10,11}$' OR _erro NOT IN ('http_401', 'http_403', 'http_404', 'http_410') THEN
    RETURN false;
  END IF;
  FOR _o IN SELECT organization_id FROM public.lead_config WHERE aquecer_chip_numero = _chip LOOP
    _p := public.lead_aquecer_pausar_interno(_o.organization_id, 'erro no canal do chip (' || _erro || ')',
            jsonb_build_object('erro', _erro, 'origem', 'resposta')) OR _p;
  END LOOP;
  RETURN _p;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.lead_ctx(); _c public.lead_config; _eleg integer;
BEGIN
  IF NOT public.leads_gestor() THEN RAISE EXCEPTION 'Apenas gestor ou administrador' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN
    SELECT * INTO _c FROM jsonb_populate_record(NULL::public.lead_config, jsonb_build_object('organization_id', _org));
    _c.aquecer_ativo := false; _c.aquecer_dias := 30; _c.aquecer_limite_dia := 15; _c.aquecer_rampa_inicio := 5;
    _c.aquecer_rampa_passo := 2; _c.aquecer_lembrete_dias := 3; _c.ia_nome := 'Nicole'; _c.ia_ativa := false;
  END IF;
  -- shortcut: conta no máximo 500 (a tela mostra "500 ou mais").
  SELECT count(*) INTO _eleg FROM (
    SELECT 1 FROM public.leads l
     WHERE l.organization_id = _org AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido') AND l.funil = 'venda'
       AND l.telefone IS NOT NULL AND l.created_at <= now() - make_interval(days => _c.aquecer_dias)
       AND coalesce(l.ultima_interacao_em, l.created_at) <= now() - make_interval(days => _c.aquecer_dias)
       AND public.lead_aquecer_elegivel(l, _c.aquecer_dias)
     LIMIT 500) x;
  RETURN jsonb_build_object(
    'ativo', _c.aquecer_ativo, 'dias', _c.aquecer_dias, 'limite_dia', _c.aquecer_limite_dia,
    'rampa_inicio', _c.aquecer_rampa_inicio, 'rampa_passo', _c.aquecer_rampa_passo, 'lembrete_dias', _c.aquecer_lembrete_dias,
    'pausado_em', _c.aquecer_pausado_em, 'pausa_motivo', _c.aquecer_pausa_motivo,
    'limite_hoje', public.lead_aquecer_limite_hoje(_c, now()),
    'enviados_hoje', public.lead_aquecer_enviados_hoje(_org, NULL, now()),
    'chip', CASE WHEN _c.aquecer_chip_numero IS NULL THEN NULL
                 ELSE '(' || left(_c.aquecer_chip_numero, 2) || ') ****-' || right(_c.aquecer_chip_numero, 4) END,
    'retorno_em', _c.aquecer_retorno_token_em, 'ia_ativa', coalesce(_c.ia_ativa, false), 'ia_nome', coalesce(_c.ia_nome, 'Nicole'),
    'elegiveis', _eleg);
END $function$;

CREATE OR REPLACE FUNCTION public.lead_ia_status_saida(_conversa uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT 'pendente' FROM public.lead_conversas cv
      JOIN public.lead_config c ON c.organization_id = cv.organization_id
      JOIN public.leads l ON l.id = cv.lead_id AND l.organization_id = cv.organization_id
     WHERE cv.id = _conversa AND cv.canal = 'ziontalk'
       AND l.telefone IS NOT NULL AND NOT l.simulado
       AND CASE public.lead_aquecer_chip_do_lead(l.id)
             WHEN 'atendimento' THEN c.ia_canal = 'ziontalk' AND public.lead_ia_liberado(c, l)
             WHEN 'aquecer' THEN c.aquecer_ativo AND c.aquecer_pausado_em IS NULL AND c.aquecer_chip_numero IS NOT NULL
             ELSE false END), 'nao_enviada')
$function$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_retorno_token(_acao text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.lead_ctx(); _tok text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador configura o retorno do WhatsApp' USING ERRCODE = '42501';
  END IF;
  IF _acao IS NULL OR _acao NOT IN ('gerar', 'desligar') THEN RAISE EXCEPTION 'Acao invalida' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  IF _acao = 'gerar' THEN
    _tok := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  END IF;
  UPDATE public.lead_config
     SET aquecer_retorno_token_hash = CASE WHEN _tok IS NULL THEN NULL ELSE encode(extensions.digest(_tok, 'sha256'), 'hex') END,
         aquecer_retorno_token_em = CASE WHEN _tok IS NULL THEN NULL ELSE now() END, updated_at = now()
   WHERE organization_id = _org;
  RETURN _tok;
END $function$;

DROP TRIGGER IF EXISTS lead_aquecer_chips_trava ON public.lead_aquecer_chips;
DROP FUNCTION IF EXISTS public.lead_aquecer_preparar_chips(text[], timestamptz);
DROP FUNCTION IF EXISTS public.lead_aquecer_token_chip(text);
DROP FUNCTION IF EXISTS public.lead_aquecer_pausar_chip(text, text, jsonb);
DROP FUNCTION IF EXISTS public.lead_aquecer_chip_adicionar(uuid, text);
DROP FUNCTION IF EXISTS public.lead_aquecer_chip_retorno_token(uuid, text);
DROP FUNCTION IF EXISTS public.lead_aquecer_chip_retomar(uuid);
DROP TABLE IF EXISTS public.lead_aquecer_chips;
DROP FUNCTION IF EXISTS public.lead_aquecer_chip_trava();
ALTER TABLE public.lead_aquecer_pausas DROP COLUMN IF EXISTS chip_numero;

COMMIT;
