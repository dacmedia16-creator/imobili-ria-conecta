-- Aquecimento com VÁRIOS chips por imobiliária (t_879234c7, "pode fazer a mudança" de Denis em 16/11/2026, tópico 6238).
--  * Tabela nova lead_aquecer_chips: 1 linha por chip, com o PRÓPRIO link de retorno (hash), pausa/freio, intervalo
--    (proximo_em) e rampa (rampa_desde). Os valores de limite/rampa/intervalo/freio continuam os da imobiliária
--    (lead_config.aquecer_*), mas são contados e aplicados POR CHIP: cada chip tem o próprio limite do dia.
--  * Os envios se dividem entre os chips (a cada rodada, cada chip livre manda no máximo 1; o menos usado no dia primeiro).
--  * O lead fica preso ao chip que mandou a 1ª mensagem (lead_aquecer.chip_numero): lembrete, respostas da Nicole e
--    retorno só por ele.
--  * Erro de canal (401/403/404/410) ou freio (taxa de falha / opt-out) pausa SÓ o chip; os outros seguem.
--  * Chip do aquecimento nunca é chip de atendimento (gatilho confere todas as imobiliárias).
--  * Chip já existente (lead_config.aquecer_chip_numero) vira a 1ª linha com o MESMO hash do link: o link já colado na
--    ZionTalk continua valendo. As colunas antigas ficam (não são apagadas) para o rollback.
--  * Envio real continua exigindo LEADS_AQUECER_ENVIO_REAL=on + chave do chip no servidor. Chip sem chave não envia.
-- Rollback: docs/sql/rollback/20261127120000_leads_aquecer_multichip.rollback.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.lead_aquecer_chips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  numero text NOT NULL UNIQUE CHECK (numero ~ '^[0-9]{10,11}$'),
  retorno_token_hash text UNIQUE CHECK (retorno_token_hash ~ '^[0-9a-f]{64}$'),
  retorno_token_em timestamptz,
  pausado_em timestamptz,
  pausa_motivo text CHECK (char_length(pausa_motivo) <= 200),
  proximo_em timestamptz,
  rampa_desde date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_aquecer_chips_org_idx ON public.lead_aquecer_chips (organization_id, created_at);
ALTER TABLE public.lead_aquecer_chips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_aquecer_chips FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_aquecer_chips TO service_role;

ALTER TABLE public.lead_aquecer_pausas ADD COLUMN IF NOT EXISTS chip_numero text CHECK (chip_numero ~ '^[0-9]{10,11}$');

-- Chip do aquecimento nunca é chip de atendimento (de nenhuma imobiliária).
CREATE OR REPLACE FUNCTION public.lead_aquecer_chip_trava()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lead_config c WHERE c.ia_canal_numero = NEW.numero) THEN
    RAISE EXCEPTION 'Chip do aquecimento nao pode ser chip de atendimento' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lead_aquecer_chips_trava ON public.lead_aquecer_chips;
CREATE TRIGGER lead_aquecer_chips_trava BEFORE INSERT OR UPDATE OF numero ON public.lead_aquecer_chips
  FOR EACH ROW EXECUTE FUNCTION public.lead_aquecer_chip_trava();

-- Migra o chip atual (mesmo hash = mesmo link já colado na ZionTalk; mesma pausa/intervalo/rampa).
INSERT INTO public.lead_aquecer_chips (organization_id, numero, retorno_token_hash, retorno_token_em, pausado_em,
  pausa_motivo, proximo_em, rampa_desde)
SELECT c.organization_id, c.aquecer_chip_numero, c.aquecer_retorno_token_hash, c.aquecer_retorno_token_em,
       c.aquecer_pausado_em, c.aquecer_pausa_motivo, c.aquecer_proximo_em, c.aquecer_rampa_desde
  FROM public.lead_config c
 WHERE c.aquecer_chip_numero IS NOT NULL
ON CONFLICT (numero) DO NOTHING;

-- Pausa de UM chip (freio/erro de canal). Avisa os administradores da imobiliária.
CREATE OR REPLACE FUNCTION public.lead_aquecer_pausar_chip(_chip text, _motivo text, _detalhe jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.lead_aquecer_chips; _g record;
BEGIN
  UPDATE public.lead_aquecer_chips SET pausado_em = now(), pausa_motivo = left(_motivo, 200), updated_at = now()
   WHERE numero = _chip AND pausado_em IS NULL RETURNING * INTO _k;
  IF _k.id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.lead_aquecer_pausas (organization_id, motivo, detalhe, chip_numero)
  VALUES (_k.organization_id, left(_motivo, 200), coalesce(_detalhe, '{}'::jsonb), _chip);
  FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
             WHERE r.organization_id = _k.organization_id AND r.role::text IN ('admin', 'super_admin') LOOP
    INSERT INTO public.notifications (user_id, organization_id, tipo, titulo, mensagem)
    VALUES (_g.user_id, _k.organization_id, 'lead', 'Chip do aquecimento pausado',
            left('Um chip do aquecimento de leads (final ' || right(_chip, 4) || ') foi pausado automaticamente ('
                 || _motivo || '). Os outros chips seguem. Confira em Leads > Configurar.', 500));
  END LOOP;
  RETURN true;
END $$;

-- Freio. _chip NULL = modo teste (pausa a imobiliária, como antes); _chip = conta só o chip e pausa só ele.
CREATE OR REPLACE FUNCTION public.lead_aquecer_freio(_org uuid, _chip text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.lead_config; _tot integer; _fal integer; _env integer; _opt integer;
BEGIN
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN RETURN NULL; END IF;
  SELECT count(*), count(*) FILTER (WHERE e.status = 'falhou') INTO _tot, _fal FROM public.lead_aquecer_envios e
   WHERE e.created_at > now() - interval '24 hours' AND e.status <> 'enviando'
     AND (CASE WHEN _chip IS NOT NULL THEN e.modo_real AND e.chip_numero = _chip ELSE e.organization_id = _org END);
  IF _tot >= _c.aquecer_freio_min AND _fal::numeric / _tot >= _c.aquecer_freio_taxa THEN
    IF _chip IS NOT NULL THEN
      PERFORM public.lead_aquecer_pausar_chip(_chip, 'taxa de falha de envio alta',
        jsonb_build_object('tentativas_24h', _tot, 'falhas_24h', _fal, 'limite', _c.aquecer_freio_taxa));
    ELSE
      PERFORM public.lead_aquecer_pausar_interno(_org, 'taxa de falha de envio alta',
        jsonb_build_object('tentativas_24h', _tot, 'falhas_24h', _fal, 'limite', _c.aquecer_freio_taxa));
    END IF;
    RETURN 'taxa_falha';
  END IF;
  SELECT count(*) FILTER (WHERE a.enviado_em IS NOT NULL), count(*) FILTER (WHERE a.estado = 'optout')
    INTO _env, _opt FROM public.lead_aquecer a
   WHERE a.organization_id = _org AND a.created_at > now() - interval '7 days'
     AND (_chip IS NULL OR a.chip_numero = _chip);
  IF _env >= _c.aquecer_freio_min AND _opt::numeric / _env >= _c.aquecer_freio_taxa THEN
    IF _chip IS NOT NULL THEN
      PERFORM public.lead_aquecer_pausar_chip(_chip, 'muitos pedidos para sair',
        jsonb_build_object('enviados_7d', _env, 'optouts_7d', _opt, 'limite', _c.aquecer_freio_taxa));
    ELSE
      PERFORM public.lead_aquecer_pausar_interno(_org, 'muitos pedidos para sair',
        jsonb_build_object('enviados_7d', _env, 'optouts_7d', _opt, 'limite', _c.aquecer_freio_taxa));
    END IF;
    RETURN 'optouts';
  END IF;
  RETURN NULL;
END $$;

-- Preparo com vários chips. _chips = chips com chave no servidor (envio real ligado); NULL = modo teste.
-- Imobiliária COM chips cadastrados: só envio real, por chip livre (sem pausa, com chave, fora do intervalo, dentro do
-- limite do dia do chip); nenhum livre = nada sai (nunca cai para modo teste nem para outro canal).
-- Imobiliária SEM chip: modo teste, 1 por chamada, como antes. Cada chip manda no máximo 1 por chamada.
CREATE OR REPLACE FUNCTION public.lead_aquecer_preparar_chips(_chips text[] DEFAULT NULL, _agora timestamptz DEFAULT now())
RETURNS TABLE (envio_id uuid, lead_id uuid, telefone text, texto text, modo_real boolean, chip_numero text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
DECLARE _c public.lead_config; _a public.lead_aquecer; _l public.leads; _cv public.lead_conversas;
  _txt text; _org text; _ia text; _frase text; _env uuid; _n integer := 0; _k record; _ks text[]; _chip text;
  _real boolean; _tem_chip boolean; _hoje date := (_agora AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _chips IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(_chips) x WHERE x IS NULL OR x !~ '^[0-9]{10,11}$') THEN
    RAISE EXCEPTION 'Chip invalido' USING ERRCODE = '22023';
  END IF;
  FOR _c IN
    SELECT c.* FROM public.lead_config c
      JOIN public.organizations o ON o.id = c.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = c.organization_id AND m.module = 'leads' AND m.enabled
     WHERE c.aquecer_ativo AND c.aquecer_pausado_em IS NULL AND c.ia_ativa
       AND public.lead_aquecer_horario(c.ia_domingo, _agora)
     ORDER BY c.aquecer_proximo_em NULLS FIRST
     LIMIT 10
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    EXIT WHEN _n >= 10;
    _tem_chip := EXISTS (SELECT 1 FROM public.lead_aquecer_chips k WHERE k.organization_id = _c.organization_id);
    -- Imobiliária com chip cadastrado e envio real desligado no servidor: nada (simulação gastaria o contato por 7 dias).
    CONTINUE WHEN _tem_chip AND _chips IS NULL;
    -- Limpeza da imobiliária (igual à versão anterior).
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
    _org := public.lead_ia_org_nome(_c.organization_id);
    _ia := coalesce(nullif(btrim(_c.ia_nome), ''), 'Nicole');
    IF _tem_chip THEN
      -- Chips livres da imobiliária, o menos usado hoje primeiro (divide os envios).
      SELECT array_agg(k.numero ORDER BY (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.modo_real
                AND e.chip_numero = k.numero AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = _hoje), random())
        INTO _ks
        FROM public.lead_aquecer_chips k
       WHERE k.organization_id = _c.organization_id AND k.numero = ANY (_chips) AND k.pausado_em IS NULL
         AND (k.proximo_em IS NULL OR k.proximo_em <= now())
         AND NOT EXISTS (SELECT 1 FROM public.lead_aquecer_envios e WHERE e.modo_real AND e.chip_numero = k.numero
                          AND e.created_at > now() - make_interval(secs => _c.aquecer_intervalo_min_s))
         AND (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.modo_real AND e.chip_numero = k.numero
                AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = _hoje)
             < least(_c.aquecer_limite_dia, _c.aquecer_rampa_inicio + _c.aquecer_rampa_passo
                      * greatest(0, _hoje - coalesce(k.rampa_desde, _hoje)));
      _real := true;
    ELSE
      CONTINUE WHEN _c.aquecer_proximo_em IS NOT NULL AND _c.aquecer_proximo_em > now();
      CONTINUE WHEN public.lead_aquecer_enviados_hoje(_c.organization_id, NULL, _agora) >= public.lead_aquecer_limite_hoje(_c, _agora);
      _ks := ARRAY[NULL::text];
      _real := false;
    END IF;
    CONTINUE WHEN _ks IS NULL;
    FOREACH _chip IN ARRAY _ks LOOP
      _a := NULL; _txt := NULL; _l := NULL; _env := NULL;
      -- a) Lembrete (1 só), pelo MESMO chip da 1ª mensagem.
      SELECT a.* INTO _a FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id
       WHERE a.organization_id = _c.organization_id AND a.estado = 'enviado' AND a.respondeu_em IS NULL
         AND a.modo_real = _real AND a.chip_numero IS NOT DISTINCT FROM _chip
         AND a.enviado_em <= now() - make_interval(days => _c.aquecer_lembrete_dias)
         AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido') AND l.sale_id IS NULL
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
        VALUES (_c.organization_id, _a.id, 'lembrete', _txt, _real, _chip) RETURNING id INTO _env;
        UPDATE public.lead_aquecer SET estado = 'lembrete', lembrete_em = now(), updated_at = now() WHERE id = _a.id;
      ELSE
        SELECT l.* INTO _l FROM public.leads l
         WHERE l.organization_id = _c.organization_id AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido')
           AND l.funil = 'venda' AND l.telefone IS NOT NULL
           AND public.lead_aquecer_na_lista(_c, l.telefone)
           AND l.created_at <= now() - make_interval(days => _c.aquecer_dias)
           AND coalesce(l.ultima_interacao_em, l.created_at) <= now() - make_interval(days => _c.aquecer_dias)
           AND public.lead_aquecer_elegivel(l, _c.aquecer_dias)
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
        VALUES (_l.organization_id, _l.id, _cv.id, 'enviando', _real, _chip) RETURNING * INTO _a;
        INSERT INTO public.lead_aquecer_envios (organization_id, aquecer_id, tipo, texto, modo_real, chip_numero)
        VALUES (_c.organization_id, _a.id, 'primeira', _txt, _real, _chip) RETURNING id INTO _env;
      END IF;
      IF _real THEN
        UPDATE public.lead_aquecer_chips
           SET proximo_em = now() + make_interval(secs => _c.aquecer_intervalo_min_s
                              + floor(random() * (_c.aquecer_intervalo_max_s - _c.aquecer_intervalo_min_s + 1))),
               rampa_desde = coalesce(rampa_desde, _hoje), updated_at = now()
         WHERE numero = _chip;
      END IF;
      UPDATE public.lead_config
         SET aquecer_proximo_em = now() + make_interval(secs => _c.aquecer_intervalo_min_s
                                   + floor(random() * (_c.aquecer_intervalo_max_s - _c.aquecer_intervalo_min_s + 1))),
             aquecer_rampa_desde = coalesce(aquecer_rampa_desde, _hoje)
       WHERE organization_id = _c.organization_id;
      envio_id := _env; lead_id := _l.id; telefone := _l.telefone; texto := _txt; modo_real := _real; chip_numero := _chip;
      _n := _n + 1;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END $$;

-- Compatibilidade com o servidor anterior (1 chip): mesma assinatura, agora pela regra de vários chips.
CREATE OR REPLACE FUNCTION public.lead_aquecer_preparar(_chip text DEFAULT NULL, _agora timestamptz DEFAULT now())
RETURNS TABLE (envio_id uuid, lead_id uuid, telefone text, texto text, modo_real boolean)
LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  SELECT p.envio_id, p.lead_id, p.telefone, p.texto, p.modo_real
    FROM public.lead_aquecer_preparar_chips(CASE WHEN _chip IS NULL THEN NULL ELSE ARRAY[_chip] END, _agora) p
$$;

-- Resultado: erro de canal pausa SÓ o chip (envio real); modo teste segue pausando a imobiliária.
CREATE OR REPLACE FUNCTION public.lead_aquecer_resultado(_envio uuid, _status text, _erro text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _e public.lead_aquecer_envios; _a public.lead_aquecer; _freio text;
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
            || CASE WHEN _status = 'teste' THEN ' (modo teste: não enviada)'
                    ELSE ' (chip do aquecimento final ' || coalesce(right(_e.chip_numero, 4), '----') || ')' END);
  ELSE
    UPDATE public.lead_aquecer SET estado = CASE WHEN _e.tipo = 'primeira' THEN 'falhou' ELSE estado END,
           finalizado_em = CASE WHEN _e.tipo = 'primeira' THEN now() ELSE finalizado_em END, updated_at = now()
     WHERE id = _a.id;
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_a.organization_id, _a.lead_id, 'ia', 'aquecer_falhou', 'Aquecimento: o envio falhou (' || coalesce(_erro, 'erro') || '). Não será repetido.');
    IF _erro IN ('http_401', 'http_403', 'http_404', 'http_410') THEN
      IF _e.modo_real AND _e.chip_numero IS NOT NULL THEN
        PERFORM public.lead_aquecer_pausar_chip(_e.chip_numero, 'erro no canal do chip (' || _erro || ')', jsonb_build_object('erro', _erro));
      ELSE
        PERFORM public.lead_aquecer_pausar_interno(_e.organization_id, 'erro no canal do chip (' || _erro || ')', jsonb_build_object('erro', _erro));
      END IF;
      RETURN jsonb_build_object('ok', true, 'freio', 'erro_canal');
    END IF;
  END IF;
  _freio := public.lead_aquecer_freio(_e.organization_id, CASE WHEN _e.modo_real THEN _e.chip_numero END);
  RETURN jsonb_build_object('ok', true, 'freio', _freio);
END $$;

-- Qual chip é dono deste link de retorno (o servidor escolhe a chave certa antes de responder). NULL = link inválido.
CREATE OR REPLACE FUNCTION public.lead_aquecer_token_chip(_token text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT k.numero FROM public.lead_aquecer_chips k
   WHERE _token ~ '^[A-Za-z0-9_-]{40,64}$' AND k.retorno_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex')
$$;

-- Retorno pelo link de UM chip: a resposta só vale para lead aquecido por ESTE chip.
CREATE OR REPLACE FUNCTION public.lead_aquecer_retorno_receber(_token text, _msg jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.lead_config; _k public.lead_aquecer_chips; _num text; _ok boolean; _id text; _chave text; _tipo text; _texto text; _ev bigint;
  _a public.lead_aquecer; _cv public.lead_conversas; _cls text; _ctx jsonb; _n integer;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT * INTO _k FROM public.lead_aquecer_chips WHERE retorno_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex');
  IF _k.id IS NOT NULL THEN
    SELECT * INTO _c FROM public.lead_config WHERE organization_id = _k.organization_id FOR UPDATE;
    _num := _k.numero;
  ELSE
    -- Link antigo da imobiliária (sem chip cadastrado na tabela nova: modo teste).
    SELECT * INTO _c FROM public.lead_config
     WHERE aquecer_retorno_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex') FOR UPDATE;
    _num := _c.aquecer_chip_numero;
  END IF;
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
  IF _chave IS NULL OR _chave !~ '^[0-9]{10,11}$' OR _chave = _c.ia_canal_numero OR _chave = _c.aquecer_chip_numero
     OR EXISTS (SELECT 1 FROM public.lead_aquecer_chips k2 WHERE k2.numero = _chave) THEN
    RETURN jsonb_build_object('r', 'ignorado');
  END IF;
  _tipo := CASE WHEN _msg->>'tipo' = 'midia' THEN 'midia' ELSE 'texto' END;
  _texto := left(btrim(coalesce(_msg->>'texto', '')), 1000);
  IF _tipo = 'texto' AND _texto = '' THEN RETURN jsonb_build_object('r', 'ignorado'); END IF;
  -- Dedup: o chip 1 mantém a chave antiga (ids já registrados continuam valendo); os demais usam o número do chip.
  INSERT INTO public.lead_ia_retorno_eventos (organization_id, externo_hash, resultado)
  VALUES (_c.organization_id, encode(extensions.digest(_c.organization_id::text || ':aquecer:'
            || CASE WHEN _num IS NULL OR _num = _c.aquecer_chip_numero THEN '' ELSE _num || ':' END || _id, 'sha256'), 'hex'), 'recebido')
  ON CONFLICT (organization_id, externo_hash) DO NOTHING RETURNING id INTO _ev;
  IF _ev IS NULL THEN RETURN jsonb_build_object('r', 'duplicado'); END IF;
  SELECT a.* INTO _a FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id AND l.organization_id = a.organization_id
   WHERE a.organization_id = _c.organization_id AND NOT l.simulado AND a.enviado_em IS NOT NULL
     AND (NOT a.modo_real OR a.chip_numero = _num)
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
      IF _cv.estado = 'ativa' THEN
        UPDATE public.lead_conversas SET estado = 'parada', passo = 'fim', encerrada_em = now(), updated_at = now() WHERE id = _cv.id;
      END IF;
      _ctx := public.lead_ia_registrar_cliente(_cv.id, _texto, 'recebida');
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
        PERFORM public.lead_aquecer_freio(_c.organization_id, CASE WHEN _a.modo_real THEN _a.chip_numero END);
      END IF;
      RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id);
    END IF;
    UPDATE public.lead_conversas
       SET estado = 'ativa', passo = 'interesse', motivo_fim = NULL, encerrada_em = NULL,
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
    PERFORM public.lead_aquecer_freio(_c.organization_id, CASE WHEN _a.modo_real THEN _a.chip_numero END);
  END IF;
  IF _ctx->>'estado' IS DISTINCT FROM 'ativa' THEN
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id);
  END IF;
  -- Aquecimento desligado, imobiliária pausada ou ESTE chip pausado: registra, mas a Nicole não responde pelo chip.
  IF NOT _c.aquecer_ativo OR _c.aquecer_pausado_em IS NOT NULL OR _k.pausado_em IS NOT NULL THEN
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _a.lead_id, 'pausado', true);
  END IF;
  PERFORM public.lead_ia_encaminhar_cedo(_cv.id);
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
END $$;

-- Reserva do chip do aquecimento: só o chip que aqueceu o lead, cadastrado na imobiliária e sem pausa.
CREATE OR REPLACE FUNCTION public.lead_aquecer_envio_reservar(_lead uuid, _chip text)
RETURNS TABLE (msg_id uuid, telefone text, texto text, primeira boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
     OR _a.chip_numero IS DISTINCT FROM _chip
     OR NOT EXISTS (SELECT 1 FROM public.lead_aquecer_chips k WHERE k.numero = _chip
                     AND k.organization_id = _l.organization_id AND k.pausado_em IS NULL)
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
END $$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_pendentes(_chip text)
RETURNS TABLE (lead_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT DISTINCT ON (a.lead_id) a.lead_id
    FROM public.lead_aquecer a
    JOIN public.lead_config c ON c.organization_id = a.organization_id
    JOIN public.lead_aquecer_chips k ON k.numero = a.chip_numero AND k.organization_id = a.organization_id
    JOIN public.lead_conversas cv ON cv.id = a.conversa_id
   WHERE _chip IS NOT NULL AND a.estado = 'retomado' AND a.modo_real AND a.chip_numero = _chip
     AND c.aquecer_pausado_em IS NULL AND k.pausado_em IS NULL
     AND EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = cv.id AND m.status = 'pendente')
     AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = cv.id AND m.status = 'enviando')
   ORDER BY a.lead_id
   LIMIT 5
$$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_falha_canal(_chip text, _erro text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF _chip IS NULL OR _chip !~ '^[0-9]{10,11}$' OR _erro NOT IN ('http_401', 'http_403', 'http_404', 'http_410') THEN
    RETURN false;
  END IF;
  RETURN public.lead_aquecer_pausar_chip(_chip, 'erro no canal do chip (' || _erro || ')',
           jsonb_build_object('erro', _erro, 'origem', 'resposta'));
END $$;

-- Cadastro de chip novo (só a plataforma, service_role). Nasce sem link de retorno; a rampa começa no dia.
CREATE OR REPLACE FUNCTION public.lead_aquecer_chip_adicionar(_org uuid, _tel text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _n text := (public.lead_ia_contatos(_tel, NULL))[1]; _id uuid;
BEGIN
  IF _n IS NULL OR _n !~ '^[0-9]{10,11}$' THEN RAISE EXCEPTION 'Numero invalido' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lead_config WHERE organization_id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.lead_aquecer_chips (organization_id, numero, rampa_desde)
  VALUES (_org, _n, (now() AT TIME ZONE 'America/Sao_Paulo')::date) RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Resposta da Nicole a lead retomado pelo aquecimento real fica "pendente" só se o chip DESSE lead está cadastrado e
-- sem pausa (antes: bastava a imobiliária ter o chip único). O resto igual à versão no ar.
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
             WHEN 'aquecer' THEN c.aquecer_ativo AND c.aquecer_pausado_em IS NULL
               AND EXISTS (SELECT 1 FROM public.lead_aquecer_chips k
                            WHERE k.organization_id = c.organization_id AND k.pausado_em IS NULL
                              AND k.numero = (SELECT a.chip_numero FROM public.lead_aquecer a WHERE a.lead_id = l.id
                                               ORDER BY a.created_at DESC LIMIT 1))
             ELSE false END), 'nao_enviada')
$function$;

-- Link antigo (1 chip, tela anterior): passa a valer para o chip cadastrado em lead_config.aquecer_chip_numero.
CREATE OR REPLACE FUNCTION public.lead_aquecer_retorno_token(_acao text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
  UPDATE public.lead_aquecer_chips k
     SET retorno_token_hash = CASE WHEN _tok IS NULL THEN NULL ELSE encode(extensions.digest(_tok, 'sha256'), 'hex') END,
         retorno_token_em = CASE WHEN _tok IS NULL THEN NULL ELSE now() END, updated_at = now()
    FROM public.lead_config c
   WHERE c.organization_id = _org AND k.organization_id = _org AND k.numero = c.aquecer_chip_numero;
  RETURN _tok;
END $$;

-- Tela: lista dos chips (número mascarado, estado, link, uso do dia). Mantém os campos antigos.
CREATE OR REPLACE FUNCTION public.lead_aquecer_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _c public.lead_config; _eleg integer; _chips jsonb;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.leads_gestor() THEN RAISE EXCEPTION 'Apenas gestor ou administrador' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN
    SELECT * INTO _c FROM jsonb_populate_record(NULL::public.lead_config, jsonb_build_object('organization_id', _org));
    _c.aquecer_ativo := false; _c.aquecer_dias := 30; _c.aquecer_limite_dia := 15; _c.aquecer_rampa_inicio := 5;
    _c.aquecer_rampa_passo := 2; _c.aquecer_lembrete_dias := 3; _c.ia_nome := 'Nicole'; _c.ia_ativa := false;
  END IF;
  SELECT count(*) INTO _eleg FROM (
    SELECT 1 FROM public.leads l
     WHERE l.organization_id = _org AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido') AND l.funil = 'venda'
       AND l.telefone IS NOT NULL AND l.created_at <= now() - make_interval(days => _c.aquecer_dias)
       AND coalesce(l.ultima_interacao_em, l.created_at) <= now() - make_interval(days => _c.aquecer_dias)
       AND public.lead_aquecer_elegivel(l, _c.aquecer_dias)
     LIMIT 500) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', k.id,
           'chip', '(' || left(k.numero, 2) || ') ****-' || right(k.numero, 4),
           'pausado_em', k.pausado_em, 'pausa_motivo', k.pausa_motivo, 'retorno_em', k.retorno_token_em,
           'enviados_hoje', (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.modo_real AND e.chip_numero = k.numero
                              AND (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = _hoje),
           'limite_hoje', least(_c.aquecer_limite_dia, _c.aquecer_rampa_inicio + _c.aquecer_rampa_passo
                                 * greatest(0, _hoje - coalesce(k.rampa_desde, _hoje))),
           'ultimo_envio', (SELECT max(e.created_at) FROM public.lead_aquecer_envios e WHERE e.modo_real AND e.chip_numero = k.numero))
           ORDER BY k.created_at), '[]'::jsonb)
    INTO _chips FROM public.lead_aquecer_chips k WHERE k.organization_id = _org;
  RETURN jsonb_build_object(
    'ativo', _c.aquecer_ativo, 'dias', _c.aquecer_dias, 'limite_dia', _c.aquecer_limite_dia,
    'rampa_inicio', _c.aquecer_rampa_inicio, 'rampa_passo', _c.aquecer_rampa_passo, 'lembrete_dias', _c.aquecer_lembrete_dias,
    'pausado_em', _c.aquecer_pausado_em, 'pausa_motivo', _c.aquecer_pausa_motivo,
    'limite_hoje', public.lead_aquecer_limite_hoje(_c, now()),
    'enviados_hoje', public.lead_aquecer_enviados_hoje(_org, NULL, now()),
    'chip', CASE WHEN _c.aquecer_chip_numero IS NULL THEN NULL
                 ELSE '(' || left(_c.aquecer_chip_numero, 2) || ') ****-' || right(_c.aquecer_chip_numero, 4) END,
    'retorno_em', _c.aquecer_retorno_token_em, 'ia_ativa', coalesce(_c.ia_ativa, false), 'ia_nome', coalesce(_c.ia_nome, 'Nicole'),
    'elegiveis', _eleg, 'chips', _chips);
END $$;

-- Link do retorno de UM chip (só administrador da imobiliária do chip). 'gerar' devolve o token UMA vez.
CREATE OR REPLACE FUNCTION public.lead_aquecer_chip_retorno_token(_chip_id uuid, _acao text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _tok text; _k public.lead_aquecer_chips;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador configura o retorno do WhatsApp' USING ERRCODE = '42501';
  END IF;
  IF _acao IS NULL OR _acao NOT IN ('gerar', 'desligar') THEN RAISE EXCEPTION 'Acao invalida' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _k FROM public.lead_aquecer_chips WHERE id = _chip_id AND organization_id = _org FOR UPDATE;
  IF _k.id IS NULL THEN RAISE EXCEPTION 'Chip nao encontrado' USING ERRCODE = 'P0002'; END IF;
  IF _acao = 'gerar' THEN
    _tok := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  END IF;
  UPDATE public.lead_aquecer_chips
     SET retorno_token_hash = CASE WHEN _tok IS NULL THEN NULL ELSE encode(extensions.digest(_tok, 'sha256'), 'hex') END,
         retorno_token_em = CASE WHEN _tok IS NULL THEN NULL ELSE now() END, updated_at = now()
   WHERE id = _k.id;
  RETURN _tok;
END $$;

-- Retomar UM chip pausado (só administrador). A rampa do chip recomeça no dia.
CREATE OR REPLACE FUNCTION public.lead_aquecer_chip_retomar(_chip_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _k public.lead_aquecer_chips;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador altera a configuracao' USING ERRCODE = '42501';
  END IF;
  UPDATE public.lead_aquecer_chips SET pausado_em = NULL, pausa_motivo = NULL,
         rampa_desde = (now() AT TIME ZONE 'America/Sao_Paulo')::date, updated_at = now()
   WHERE id = _chip_id AND organization_id = _org RETURNING * INTO _k;
  IF _k.id IS NULL THEN RAISE EXCEPTION 'Chip nao encontrado' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.lead_aquecer_pausas SET retomada_em = now(), retomada_por = auth.uid()
   WHERE organization_id = _org AND chip_numero = _k.numero AND retomada_em IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.lead_aquecer_chip_trava(), public.lead_aquecer_pausar_chip(text, text, jsonb),
  public.lead_aquecer_preparar_chips(text[], timestamptz), public.lead_aquecer_token_chip(text),
  public.lead_aquecer_chip_adicionar(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_aquecer_preparar_chips(text[], timestamptz), public.lead_aquecer_token_chip(text),
  public.lead_aquecer_chip_adicionar(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.lead_aquecer_chip_retorno_token(uuid, text), public.lead_aquecer_chip_retomar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_aquecer_chip_retorno_token(uuid, text), public.lead_aquecer_chip_retomar(uuid)
  TO authenticated, service_role;

COMMIT;
