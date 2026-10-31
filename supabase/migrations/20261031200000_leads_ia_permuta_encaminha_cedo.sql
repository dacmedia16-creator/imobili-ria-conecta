BEGIN;

-- t_99359490 (Denis, 31/10/2026, tópico 6238). Duas chaves por imobiliária, as duas nascem DESLIGADAS:
--   ia_permuta_fluxo  (Nicole) permuta com detalhes, sem resposta repetida, ortografia e lembretes coerentes com o
--                     ponto em que a conversa parou (visita sem dia/período, detalhes da permuta).
--   ia_encaminha_cedo (regra nova de Denis) na 1ª resposta REAL do cliente (não conta resposta automática de empresa
--                     nem SAIR) o lead já vai ao corretor da passagem: mesma pessoa, aviso com telefone + histórico +
--                     "ACEITO <código>", prazo de aceite contando daqui. 1 vez por lead. A Nicole CONTINUA a conversa;
--                     quando ela passar o cliente (critério de sempre), vai ao MESMO corretor um 2º aviso
--                     "Cliente pronto" + as mensagens novas, sem redistribuir nem reiniciar o prazo. Depois do aceite
--                     do corretor a Nicole não manda mais lembretes.
-- Desligar = UPDATE lead_config SET ia_permuta_fluxo = false, ia_encaminha_cedo = false (tudo volta ao de antes).
-- Nada de telefone ou texto de conversa em log.

ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS ia_permuta_fluxo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ia_encaminha_cedo boolean NOT NULL DEFAULT false;

ALTER TABLE public.lead_avisos_corretor DROP CONSTRAINT IF EXISTS lead_avisos_corretor_evento_check;
ALTER TABLE public.lead_avisos_corretor ADD CONSTRAINT lead_avisos_corretor_evento_check
  CHECK (evento IN ('passagem', 'reenvio', 'historico', 'pronto', 'historico_pronto'));

-- Encaminhamento antecipado (chamado por lead_ia_retorno_receber depois de gravar a fala do cliente).
CREATE OR REPLACE FUNCTION public.lead_ia_encaminhar_cedo(_conversa uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _de text; _ia text;
BEGIN
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa;
  IF _cv.id IS NULL OR _cv.estado <> 'ativa' THEN RETURN false; END IF;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _cv.organization_id;
  IF NOT coalesce(_c.ia_encaminha_cedo, false) OR NOT _c.ia_ativa OR _c.ia_corretor_passagem_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id AND organization_id = _cv.organization_id FOR UPDATE;
  IF _l.id IS NULL OR _l.simulado OR _l.responsavel_id IS NOT NULL OR _l.etapa IN ('ganho', 'perdido') THEN RETURN false; END IF;
  -- 1 encaminhamento por lead (o aviso de passagem é único por lead) e só depois de uma fala real do cliente.
  IF EXISTS (SELECT 1 FROM public.lead_avisos_corretor a WHERE a.lead_id = _l.id AND a.evento IN ('passagem', 'reenvio'))
     OR EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = _l.id AND e.tipo = 'ia' AND e.para = 'encaminhado_cedo')
     OR NOT EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = _cv.id AND m.autor = 'cliente'
                     AND m.status = 'recebida') THEN
    RETURN false;
  END IF;
  IF NOT public.lead_pode_ser_responsavel(_c.ia_corretor_passagem_id, _cv.organization_id) THEN RETURN false; END IF;
  _ia := coalesce(nullif(btrim(_c.ia_nome), ''), 'IA');
  _de := CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'banco' END;
  UPDATE public.leads SET responsavel_id = _c.ia_corretor_passagem_id, atribuido_em = now(), aceito_em = NULL,
         ultima_interacao_em = NULL, no_banco_desde = NULL, tentativas_aceite = tentativas_aceite + 1, updated_at = now()
   WHERE id = _l.id RETURNING * INTO _l;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota)
  VALUES (_cv.organization_id, _l.id, 'atribuido', _de, _c.ia_corretor_passagem_id::text,
          left('encaminhamento antecipado da ' || _ia || ': o cliente respondeu e a ' || _ia || ' continua a conversa', 2000));
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
  VALUES (_cv.organization_id, _l.id, 'ia', 'encaminhado_cedo',
          'Cliente respondeu: lead encaminhado ao corretor. A ' || _ia || ' continua a conversa e avisa quando ele estiver pronto.');
  IF _c.ia_aviso_corretor_whats THEN
    INSERT INTO public.lead_avisos_corretor (organization_id, lead_id, user_id, evento, texto)
    VALUES (_cv.organization_id, _l.id, _c.ia_corretor_passagem_id, 'passagem',
            left(coalesce(public.lead_ia_org_nome(_cv.organization_id) || ': ', '') || 'a ' || _ia
                 || ' passou um cliente para você. Veja no ADM, em Meus leads (aceite em até '
                 || public.lead_prazo_txt(_c.prazo_aceite_min) || ').', 500))
    ON CONFLICT (lead_id, evento) DO NOTHING;
  END IF;
  PERFORM public.lead_notificar(_c.ia_corretor_passagem_id, _cv.organization_id, 'Novo lead: o cliente respondeu a ' || _ia,
    'Lead "' || coalesce(_l.nome, '') || '": aceite o lead em Meus leads. A ' || _ia || ' continua a conversa e avisa quando ele estiver pronto.');
  RETURN true;
END $function$;
REVOKE ALL ON FUNCTION public.lead_ia_encaminhar_cedo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_encaminhar_cedo(uuid) TO service_role;

-- Resumo do que a Nicole já sabe, para o aviso antecipado (conversa ainda com ela). Sem telefone/e-mail.
CREATE OR REPLACE FUNCTION public.lead_aviso_resumo_parcial(_dados jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT left(nullif(concat_ws('; ',
    CASE WHEN _dados ? 'permuta' THEN 'PERMUTA: ofereceu ' || coalesce(nullif(_dados->'permuta'->>'bem', ''), 'um bem') || ' na troca'
         || coalesce(' — "' || (SELECT string_agg(x, '" / "') FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(_dados->'permuta'->'relato') = 'array' THEN _dados->'permuta'->'relato' ELSE '[]'::jsonb END) x) || '"', '') END,
    CASE WHEN nullif(_dados->>'finalidade', '') IS NOT NULL THEN 'quer ' || (_dados->>'finalidade') END,
    CASE WHEN nullif(_dados->>'faixa', '') IS NOT NULL THEN 'faixa: ' || (_dados->>'faixa') END,
    (SELECT 'anotado: ' || string_agg(x, ', ') FROM (
       SELECT x FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(_dados->'pendentes') = 'array' THEN _dados->'pendentes' ELSE '[]'::jsonb END) x
        WHERE NOT (_dados ? 'permuta' AND x ~* '(permut|troca)') LIMIT 4) y)), ''), 700)
$function$;
REVOKE ALL ON FUNCTION public.lead_aviso_resumo_parcial(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_aviso_resumo_parcial(jsonb) TO service_role;

-- Texto do 1º aviso: igual ao de antes; no encaminhamento antecipado (conversa ainda ativa) diz que a Nicole continua.
CREATE OR REPLACE FUNCTION public.lead_aviso_corretor_texto(_lead uuid, _reenvio boolean, _codigo integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.leads; _c public.lead_config; _cv public.lead_conversas; _ia text; _tel text; _link text; _imovel text;
  _cedo boolean; _resumo text;
BEGIN
  SELECT * INTO _l FROM public.leads WHERE id = _lead;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _l.organization_id;
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _lead ORDER BY created_at DESC LIMIT 1;
  _ia := coalesce(nullif(btrim(_c.ia_nome), ''), 'IA');
  _tel := public.lead_aviso_telefone_txt(_l.telefone);
  -- link do anúncio = o que a IA mandou na 1ª mensagem (não repete no histórico)
  SELECT (regexp_match(m.texto, 'https?://[^[:space:]]+'))[1] INTO _link
    FROM public.lead_mensagens m
   WHERE m.conversa_id = _cv.id AND m.autor = 'ia' AND m.texto ~ 'https?://'
   ORDER BY m.created_at LIMIT 1;
  _imovel := nullif(concat_ws(' ', CASE WHEN nullif(btrim(_l.anuncio_codigo), '') IS NOT NULL
                                        THEN 'anúncio ' || btrim(_l.anuncio_codigo) END, _link), '');
  -- t_99359490: encaminhamento antecipado = a conversa ainda está com a IA.
  _cedo := coalesce(_c.ia_encaminha_cedo, false) AND _cv.estado = 'ativa' AND NOT _reenvio;
  _resumo := CASE WHEN _cedo THEN public.lead_aviso_resumo_parcial(_cv.dados) ELSE nullif(btrim(_cv.resumo), '') END;
  RETURN left(concat_ws(E'\n',
    coalesce(public.lead_ia_org_nome(_l.organization_id) || ': ', '')
      || CASE WHEN _reenvio THEN 'reenvio, agora com o telefone, do cliente que a ' || _ia || ' passou para você.'
              WHEN _cedo THEN 'a ' || _ia || ' passou um cliente para você. Ele respondeu agora; a ' || _ia
                              || ' continua a conversa e te avisa quando ele estiver pronto.'
              ELSE 'a ' || _ia || ' passou um cliente para você.' END
      || CASE WHEN _resumo LIKE 'PERMUTA:%' THEN ' PERMUTA: verificar com o proprietário.' ELSE '' END,
    'Cliente: ' || coalesce(nullif(btrim(_l.nome), ''), 'sem nome'),
    'Telefone: ' || coalesce(_tel, 'não informado'),
    'Imóvel: ' || coalesce(_imovel, 'ver no ADM'),
    CASE WHEN _resumo IS NOT NULL THEN CASE WHEN _cedo THEN 'Até agora: ' ELSE 'Resumo: ' END || _resumo END,
    CASE WHEN _codigo IS NOT NULL
         THEN 'Para aceitar, responda: ACEITO ' || _codigo || E'\n'
              || 'Prazo para aceitar: até ' || public.lead_prazo_txt(_c.prazo_aceite_min) || ' (ou aceite no ADM, em Meus leads).'
         ELSE 'Aceite no ADM em Meus leads em até ' || public.lead_prazo_txt(_c.prazo_aceite_min) || '.' END,
    'A conversa com a ' || _ia || ' vem na próxima mensagem.'), 2000);
END $function$;

-- 2º aviso: "Cliente pronto" (mesmo corretor, sem redistribuir nem reiniciar o prazo).
CREATE OR REPLACE FUNCTION public.lead_aviso_pronto_texto(_lead uuid, _codigo integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.leads; _c public.lead_config; _cv public.lead_conversas; _ia text; _tel text; _resumo text;
BEGIN
  SELECT * INTO _l FROM public.leads WHERE id = _lead;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _l.organization_id;
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _lead ORDER BY created_at DESC LIMIT 1;
  _ia := coalesce(nullif(btrim(_c.ia_nome), ''), 'IA');
  _tel := public.lead_aviso_telefone_txt(_l.telefone);
  _resumo := coalesce(nullif(btrim(_cv.resumo), ''), 'veja a conversa no ADM');
  RETURN left(concat_ws(E'\n',
    coalesce(public.lead_ia_org_nome(_l.organization_id) || ': ', '') || 'Cliente pronto: ' || _resumo,
    'Cliente: ' || coalesce(nullif(btrim(_l.nome), ''), 'sem nome') || ' · ' || coalesce(_tel, 'telefone não informado'),
    CASE WHEN _codigo IS NOT NULL
         THEN 'Ainda falta aceitar: responda ACEITO ' || _codigo || ' (ou aceite no ADM, em Meus leads).' END,
    'A ' || _ia || ' parou de conversar com ele. As mensagens novas vêm na próxima mensagem.'), 2000);
END $function$;
REVOKE ALL ON FUNCTION public.lead_aviso_pronto_texto(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_aviso_pronto_texto(uuid, integer) TO service_role;

-- Histórico: o de antes (_desde NULL) ou só as mensagens novas desde o 1º aviso.
CREATE OR REPLACE FUNCTION public.lead_aviso_corretor_historico(_lead uuid, _desde timestamptz)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _cv public.lead_conversas; _ia text; _cab text; _linhas text[]; _txt text; _cortou boolean := false;
BEGIN
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _lead ORDER BY created_at DESC LIMIT 1;
  IF _cv.id IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(nullif(btrim(c.ia_nome), ''), 'IA') INTO _ia FROM public.lead_config c WHERE c.organization_id = _cv.organization_id;
  SELECT array_agg(to_char(m.created_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') || ' '
                   || CASE m.autor WHEN 'ia' THEN _ia ELSE 'Cliente' END || ': '
                   || btrim(regexp_replace(regexp_replace(m.texto, '\s*(An[uú]ncio:\s*)?https?://[^[:space:]]+', '', 'g'),
                                           '[[:space:]]+', ' ', 'g'))
                   ORDER BY m.created_at, m.id)
    INTO _linhas
    FROM public.lead_mensagens m
   WHERE m.conversa_id = _cv.id
     AND (_desde IS NULL OR m.created_at > _desde)
     AND ((m.autor = 'ia' AND m.status = 'enviada') OR (m.autor = 'cliente' AND m.status = 'recebida'));
  IF coalesce(array_length(_linhas, 1), 0) = 0 THEN RETURN NULL; END IF;
  _cab := CASE WHEN _desde IS NULL THEN 'Conversa com a ' || _ia || ' (horário de Brasília):'
               ELSE 'Mensagens novas desde o 1º aviso (horário de Brasília):' END;
  LOOP
    _txt := _cab || CASE WHEN _cortou THEN E'\n(início cortado; conversa completa no ADM)' ELSE '' END
            || E'\n' || array_to_string(_linhas, E'\n');
    EXIT WHEN char_length(_txt) <= 2000 OR array_length(_linhas, 1) <= 1;
    _linhas := _linhas[2:]; _cortou := true;  -- corta as mais antigas
  END LOOP;
  RETURN left(_txt, 2000);
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aviso_corretor_historico(_lead uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.lead_aviso_corretor_historico(_lead, NULL::timestamptz)
$function$;
REVOKE ALL ON FUNCTION public.lead_aviso_corretor_historico(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_aviso_corretor_historico(uuid, timestamptz) TO service_role;

-- Reserva dos avisos: igual à de antes + o 2º aviso "pronto" e as mensagens novas.
CREATE OR REPLACE FUNCTION public.lead_avisos_corretor_reservar(_lead uuid)
 RETURNS TABLE(aviso_id uuid, telefone text, texto text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _a record; _tel text; _txt text; _hist text; _hid uuid; _cod integer; _l public.leads; _desde timestamptz;
BEGIN
  FOR _a IN
    SELECT a.id, a.texto, a.evento, a.lead_id, a.organization_id, a.user_id, p.telefone AS fone, c.ia_aceite_whats AS aceite
      FROM public.lead_avisos_corretor a
      JOIN public.lead_config c ON c.organization_id = a.organization_id
      JOIN public.leads l ON l.id = a.lead_id AND l.organization_id = a.organization_id
      JOIN public.profiles p ON p.id = a.user_id
     WHERE a.status = 'pendente' AND a.evento IN ('passagem', 'reenvio', 'pronto') AND (_lead IS NULL OR a.lead_id = _lead)
       AND a.created_at > now() - interval '1 day'
       AND c.ia_aviso_corretor_whats AND c.ia_ativa AND c.ia_canal = 'ziontalk'
       AND l.responsavel_id = a.user_id
       -- o "pronto" só sai depois do 1º aviso (que já leva o resumo e a conversa inteira)
       AND (a.evento <> 'pronto' OR NOT EXISTS (SELECT 1 FROM public.lead_avisos_corretor b WHERE b.lead_id = a.lead_id
                                                  AND b.evento IN ('passagem', 'reenvio') AND b.status IN ('pendente', 'enviando')
                                                  AND b.created_at > now() - interval '1 day'))
     ORDER BY a.created_at
     LIMIT 3
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    _tel := regexp_replace(coalesce(_a.fone, ''), '[^0-9]', '', 'g');
    IF _tel !~ '^(55)?[1-9][0-9][0-9]{8,9}$' THEN
      UPDATE public.lead_avisos_corretor SET status = 'sem_telefone' WHERE id = _a.id;
      CONTINUE;
    END IF;
    _cod := NULL;
    IF _a.aceite THEN
      SELECT * INTO _l FROM public.leads WHERE id = _a.lead_id;
      IF public.lead_aceite_pendente(_l, _a.user_id) THEN
        _cod := public.lead_aceite_codigo(_a.lead_id, _a.user_id, _a.organization_id);
      END IF;
    END IF;
    IF _a.evento = 'pronto' THEN
      _txt := coalesce(public.lead_aviso_pronto_texto(_a.lead_id, _cod), _a.texto);
    ELSE
      _txt := coalesce(public.lead_aviso_corretor_texto(_a.lead_id, _a.evento = 'reenvio', _cod), _a.texto);
    END IF;
    UPDATE public.lead_avisos_corretor SET status = 'enviando', texto = _txt WHERE id = _a.id;
    aviso_id := _a.id; telefone := _tel; texto := _txt;
    RETURN NEXT;
    -- histórico: 1 por lead, logo depois do aviso; no "pronto", só as mensagens novas desde o 1º aviso
    IF _a.evento = 'pronto' THEN
      SELECT max(coalesce(b.enviado_em, b.created_at)) INTO _desde FROM public.lead_avisos_corretor b
       WHERE b.lead_id = _a.lead_id AND b.evento IN ('passagem', 'reenvio', 'historico');
      _hist := public.lead_aviso_corretor_historico(_a.lead_id, coalesce(_desde, '-infinity'::timestamptz));
    ELSE
      _hist := public.lead_aviso_corretor_historico(_a.lead_id);
    END IF;
    IF _hist IS NOT NULL THEN
      _hid := NULL;
      INSERT INTO public.lead_avisos_corretor (organization_id, lead_id, user_id, evento, texto, status)
      VALUES (_a.organization_id, _a.lead_id, _a.user_id,
              CASE WHEN _a.evento = 'pronto' THEN 'historico_pronto' ELSE 'historico' END, _hist, 'enviando')
      ON CONFLICT (lead_id, evento) DO NOTHING
      RETURNING id INTO _hid;
      IF _hid IS NOT NULL THEN
        aviso_id := _hid; telefone := _tel; texto := _hist;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END $function$;

-- lead_ia_passar: igual à versão no ar (20261030220000) + o 2º aviso "Cliente pronto".

CREATE OR REPLACE FUNCTION public.lead_ia_passar(_conversa uuid, _motivo text, _resumo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _cv public.lead_conversas; _l public.leads; _g record; _titulo text; _msg text;
  _c public.lead_config; _de text; _cli text;
BEGIN
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa FOR UPDATE;
  IF _cv.id IS NULL OR _cv.estado <> 'ativa' THEN RETURN; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id;
  UPDATE public.lead_conversas
     SET estado = CASE _motivo WHEN 'optout' THEN 'optout' WHEN 'parada_manual' THEN 'parada' ELSE 'passada' END,
         motivo_fim = _motivo, resumo = left(public.lead_ia_mascarar(_resumo), 1000), passo = 'fim', encerrada_em = now(), updated_at = now()
   WHERE id = _cv.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
  VALUES (_cv.organization_id, _cv.lead_id, 'ia', _motivo, auth.uid());
  -- t_ccaa41c0: modo "Nicole passa". Cliente que fala com corretor (qualificado, visita, pediu pessoa, sensível,
  -- conversa longa) vai AGORA para o corretor da passagem; o prazo de aceite conta daqui. Um só sino (abaixo) e,
  -- com ia_aviso_corretor_whats, 1 WhatsApp por lead (lead_avisos_corretor, único por lead+evento).
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _cv.organization_id;
  IF _c.ia_corretor_passagem_id IS NOT NULL AND _c.ia_ativa AND _l.responsavel_id IS NULL
     AND _l.etapa NOT IN ('ganho', 'perdido')
     AND _motivo IN ('qualificado', 'visita', 'pediu_pessoa', 'sensivel', 'limite')
     AND public.lead_pode_ser_responsavel(_c.ia_corretor_passagem_id, _cv.organization_id) THEN
    _de := CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'banco' END;
    UPDATE public.leads SET responsavel_id = _c.ia_corretor_passagem_id, atribuido_em = now(), aceito_em = NULL,
           ultima_interacao_em = NULL, no_banco_desde = NULL, tentativas_aceite = tentativas_aceite + 1, updated_at = now()
     WHERE id = _l.id RETURNING * INTO _l;
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota)
    VALUES (_cv.organization_id, _l.id, 'atribuido', _de, _c.ia_corretor_passagem_id::text,
            left('passagem da ' || coalesce(nullif(btrim(_c.ia_nome), ''), 'IA') || ': ' || _motivo, 2000));
    IF _c.ia_aviso_corretor_whats AND NOT _l.simulado THEN
      _cli := split_part(btrim(coalesce(_l.nome, '')), ' ', 1);
      IF btrim(coalesce(_l.nome, '')) ~* '^lead( grupo zap)?$' OR _cli = '' OR _cli ~ '[0-9@/:]' OR char_length(_cli) > 30 THEN
        _cli := 'um cliente';
      ELSE
        _cli := 'o cliente ' || _cli;
      END IF;
      INSERT INTO public.lead_avisos_corretor (organization_id, lead_id, user_id, evento, texto)
      VALUES (_cv.organization_id, _l.id, _c.ia_corretor_passagem_id, 'passagem',
              left(coalesce(public.lead_ia_org_nome(_cv.organization_id) || ': ', '')
                   || 'a ' || coalesce(nullif(btrim(_c.ia_nome), ''), 'IA') || ' passou ' || _cli || ' para você. '
                   || 'Veja o resumo no ADM, em Meus leads (aceite em até ' || public.lead_prazo_txt(_c.prazo_aceite_min) || ').', 500))
      ON CONFLICT (lead_id, evento) DO NOTHING;
    END IF;
  -- t_99359490: o lead já foi encaminhado na 1ª resposta (ia_encaminha_cedo). Agora a IA julgou que o cliente está
  -- pronto: 2º aviso ao MESMO corretor ("Cliente pronto" + mensagens novas). Sem redistribuir nem reiniciar o prazo.
  ELSIF coalesce(_c.ia_encaminha_cedo, false) AND _c.ia_aviso_corretor_whats AND _c.ia_ativa AND NOT _l.simulado
     AND _l.responsavel_id IS NOT NULL AND _l.etapa NOT IN ('ganho', 'perdido')
     AND _motivo IN ('qualificado', 'visita', 'pediu_pessoa', 'sensivel', 'limite')
     AND EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = _l.id AND e.tipo = 'ia' AND e.para = 'encaminhado_cedo') THEN
    INSERT INTO public.lead_avisos_corretor (organization_id, lead_id, user_id, evento, texto)
    VALUES (_cv.organization_id, _l.id, _l.responsavel_id, 'pronto',
            left(coalesce(public.lead_ia_org_nome(_cv.organization_id) || ': ', '') || 'Cliente pronto: '
                 || coalesce(nullif(btrim(public.lead_ia_mascarar(_resumo)), ''), 'veja a conversa no ADM'), 500))
    ON CONFLICT (lead_id, evento) DO NOTHING;
  END IF;
  _titulo := CASE _motivo
    WHEN 'qualificado' THEN 'IA qualificou um lead seu'
    WHEN 'visita' THEN 'Pré-agendamento de visita: confirme com o cliente'
    WHEN 'pediu_pessoa' THEN 'Cliente pediu para falar com o corretor'
    WHEN 'sensivel' THEN 'Atenção: assunto sensível em um lead'
    WHEN 'nao_lead' THEN 'Contato que não é comprador nem locatário'
    WHEN 'sem_interesse' THEN 'Lead disse que não tem interesse'
    WHEN 'optout' THEN 'Lead pediu para não receber mensagens'
    WHEN 'limite' THEN 'Conversa da IA passou para você'
    ELSE 'IA parada neste lead' END;
  _msg := 'Lead "' || _l.nome || '": ' || left(public.lead_ia_mascarar(_resumo), 300) || ' Veja a conversa em Meus leads.';
  IF _l.responsavel_id IS NOT NULL THEN
    PERFORM public.lead_notificar(_l.responsavel_id, _cv.organization_id, _titulo,
      CASE WHEN _l.aceito_em IS NOT NULL THEN _msg
           ELSE 'Lead "' || _l.nome || '": aceite o lead em Meus leads para ver o resumo e a conversa.' END);
  END IF;
  -- Sem responsável, assunto sensível ou contato que não é lead (proprietário, parceiro, fornecedor,
  -- pessoal): gestores e administradores da imobiliária também recebem. No assunto sensível, o
  -- Administrador principal (super_admin da própria imobiliária) também. DISTINCT: 1 aviso por pessoa.
  IF _l.responsavel_id IS NULL OR _motivo IN ('sensivel', 'nao_lead') THEN
    FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
               WHERE r.organization_id = _cv.organization_id
                 AND (r.role::text IN ('admin', 'gestor')
                      OR (_motivo = 'sensivel' AND r.role::text = 'super_admin'))
                 AND r.user_id IS DISTINCT FROM _l.responsavel_id LOOP
      PERFORM public.lead_notificar(_g.user_id, _cv.organization_id, _titulo, _msg);
    END LOOP;
  END IF;
END $function$;

-- lead_ia_retorno_receber: igual à versão no ar (20261031040000) + encaminhamento antecipado na 1ª resposta real.

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
  -- t_99359490: 1ª resposta real do cliente (a resposta automática e o SAIR já saíram acima) = o lead vai ao corretor
  -- agora (ia_encaminha_cedo; 1 vez por lead). A Nicole continua a conversa normalmente.
  IF _ctx->>'estado' = 'ativa' THEN
    PERFORM public.lead_ia_encaminhar_cedo(_cv.id);
  END IF;

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

-- lead_ia_reengajar_reservar: igual à versão no ar (20261030220000) + lembrete coerente e sem lembrete após aceite/permuta encaminhada.

CREATE OR REPLACE FUNCTION public.lead_ia_reengajar_reservar()
 RETURNS TABLE(lead_id uuid, toque integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _r record; _hoje integer; _sp timestamp := now() AT TIME ZONE 'America/Sao_Paulo'; _alt uuid; _txt text;
  _frase text; _alt_frase text; _nome text; _cap uuid;
  _pend text; _oi text; _ult text; _ult_em timestamptz; _bem text; _visita text;
BEGIN
  IF extract(hour FROM _sp) < 9 OR extract(hour FROM _sp) >= 19 THEN RETURN; END IF;
  -- t_99359490 (Denis 31/10): domingo só para quem tem lead_config.ia_domingo (filtro abaixo, por imobiliária).
  FOR _r IN
    SELECT cv.id AS conversa_id, cv.organization_id, cv.lead_id, cv.reengaje_1_em, cv.dados, c.ia_envio_limite_dia,
           c.ia_reengajar_h0 AS h0, q.cli, coalesce(c.ia_permuta_fluxo, false) AS pf, c.ia_envio_intervalo_min_s AS imin, c.ia_envio_intervalo_max_s AS imax,
           CASE WHEN cv.reengaje_1_em IS NOT NULL THEN 2
                WHEN c.ia_reengajar_h0 IS NOT NULL AND cv.reengaje_0_em IS NULL AND NOT q.cli
                     AND cv.primeira_enviada_em > now() - make_interval(hours => c.ia_reengajar_h1 - c.ia_reengajar_h0) THEN 0
                ELSE 1 END AS t
      FROM public.lead_conversas cv
      JOIN public.lead_config c ON c.organization_id = cv.organization_id
      JOIN public.leads l ON l.id = cv.lead_id
      JOIN public.organizations o ON o.id = cv.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = cv.organization_id AND m.module = 'leads' AND m.enabled
      LEFT JOIN LATERAL (SELECT max(x.created_at) AS em, (array_agg(x.autor ORDER BY x.created_at DESC))[1] AS autor
                           FROM public.lead_mensagens x WHERE x.conversa_id = cv.id) u ON true
      LEFT JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM public.lead_mensagens y WHERE y.conversa_id = cv.id
                                          AND y.autor = 'cliente') AS cli) q ON true
     WHERE c.ia_reengajar AND c.ia_ativa AND c.ia_canal = 'ziontalk'
       AND (extract(isodow FROM _sp) <> 7 OR coalesce(c.ia_domingo, false))
       AND (c.ia_reengajar_proximo_em IS NULL OR c.ia_reengajar_proximo_em <= now())
       AND cv.estado = 'ativa' AND cv.canal = 'ziontalk' AND cv.primeira_enviada_em IS NOT NULL
       AND cv.reengaje_2_em IS NULL
       AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido')
       -- t_99359490: com o encaminhamento antecipado, o corretor que aceitou conduz; a IA não manda mais lembrete.
       AND NOT (coalesce(c.ia_encaminha_cedo, false) AND l.aceito_em IS NOT NULL)
       -- t_99359490 item 1d: permuta já encaminhada ao corretor = sem lembrete de qualificação.
       AND NOT (coalesce(c.ia_permuta_fluxo, false) AND coalesce(cv.dados->'permuta'->>'etapa', '') = 'encaminhada')
       AND public.lead_ia_liberado(c, l)
       AND NOT EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = cv.organization_id
                        AND op.contato = ANY (public.lead_ia_contatos(l.telefone, l.email)))
       AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens p WHERE p.conversa_id = cv.id
                        AND p.status IN ('pendente', 'enviando'))
       AND u.autor IN ('ia', 'sistema')
       -- t_ccaa41c0: com ia_reengajar_h0 (ex.: 3 h), quem NUNCA respondeu recebe 3 lembretes contados da 1ª mensagem:
       -- h0, h1 e h2 (ex.: 3 h, 24 h, 48 h). Fora da janela espera a abertura; o de h0 não sai se já faltar menos de h0
       -- para o de h1, e entre dois lembretes há pelo menos h0 horas (nunca 2 juntos). Quem já respondeu: regra antiga.
       AND ((c.ia_reengajar_h0 IS NOT NULL AND NOT q.cli AND cv.reengaje_0_em IS NULL AND cv.reengaje_1_em IS NULL
             AND cv.primeira_enviada_em <= now() - make_interval(hours => c.ia_reengajar_h0)
             AND cv.primeira_enviada_em > now() - make_interval(hours => c.ia_reengajar_h1 - c.ia_reengajar_h0))
         OR (cv.reengaje_1_em IS NULL AND (c.ia_reengajar_h0 IS NULL OR q.cli)
             AND greatest(u.em, cv.primeira_enviada_em) <= now() - make_interval(hours => c.ia_reengajar_h1))
         OR (cv.reengaje_1_em IS NULL AND c.ia_reengajar_h0 IS NOT NULL AND NOT q.cli
             AND cv.primeira_enviada_em <= now() - make_interval(hours => c.ia_reengajar_h1)
             AND (cv.reengaje_0_em IS NULL OR cv.reengaje_0_em <= now() - make_interval(hours => c.ia_reengajar_h0)))
         OR (cv.reengaje_1_em IS NOT NULL AND (c.ia_reengajar_h0 IS NULL OR q.cli)
             AND cv.reengaje_1_em <= now() - make_interval(hours => c.ia_reengajar_h2 - c.ia_reengajar_h1)
             AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens k WHERE k.conversa_id = cv.id AND k.autor = 'cliente'
                              AND k.created_at > cv.reengaje_1_em))
         OR (cv.reengaje_1_em IS NOT NULL AND c.ia_reengajar_h0 IS NOT NULL AND NOT q.cli
             AND cv.primeira_enviada_em <= now() - make_interval(hours => coalesce(c.ia_reengajar_h2_sem_resposta, c.ia_reengajar_h2))
             AND cv.reengaje_1_em <= now() - make_interval(hours => c.ia_reengajar_h0)))
     ORDER BY u.em
     LIMIT 50
     FOR UPDATE OF cv, c SKIP LOCKED
  LOOP
    -- Limite diário da imobiliária: 1ª mensagem + toques de reengajamento.
    SELECT count(*) FILTER (WHERE (x.primeira_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
         + count(*) FILTER (WHERE (x.reengaje_1_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
         + count(*) FILTER (WHERE (x.reengaje_2_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
         + count(*) FILTER (WHERE (x.reengaje_0_em AT TIME ZONE 'America/Sao_Paulo')::date = _sp::date)
      INTO _hoje FROM public.lead_conversas x WHERE x.organization_id = _r.organization_id;
    CONTINUE WHEN _hoje >= _r.ia_envio_limite_dia;

    SELECT * INTO _nome FROM split_part(btrim((SELECT nome FROM public.leads WHERE id = _r.lead_id)), ' ', 1);
    IF btrim((SELECT nome FROM public.leads WHERE id = _r.lead_id)) ~* '^lead( grupo zap)?$' THEN _nome := ''; END IF;
    _cap := public.lead_ia_captacao((SELECT l FROM public.leads l WHERE l.id = _r.lead_id), _r.dados);
    _frase := CASE WHEN _cap IS NOT NULL THEN public.lead_ia_imovel_frase(_cap, _r.organization_id, 'def') END;
    -- t_99359490 item 4 (ia_permuta_fluxo): o lembrete retoma a pergunta que ficou aberta. Sem pendência, o de antes.
    _pend := NULL; _txt := NULL; _alt := NULL; _alt_frase := NULL; _oi := CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END;
    IF _r.pf AND _r.cli THEN
      SELECT m.texto, m.created_at INTO _ult, _ult_em FROM public.lead_mensagens m
       WHERE m.conversa_id = _r.conversa_id AND m.autor = 'ia' AND m.texto !~* '(fico por aqui|responda SAIR)'
       ORDER BY m.created_at DESC, m.id DESC LIMIT 1;
      _pend := CASE
        WHEN coalesce(_r.dados->'permuta'->>'etapa', '') IN ('perguntar', 'detalhes') THEN 'permuta'
        WHEN coalesce(_r.dados->>'visita_dia_pendente', '') <> '' THEN 'periodo'
        WHEN public.lead_ia_norm(coalesce(_ult, '')) ~ '(qual dia e periodo|que dia e periodo|manha ou (a )?tarde)'
             AND NOT EXISTS (SELECT 1 FROM public.lead_mensagens k WHERE k.conversa_id = _r.conversa_id
                              AND k.autor = 'cliente' AND k.created_at > _ult_em) THEN 'dia' END;
      _bem := CASE lower(coalesce(_r.dados->'permuta'->>'bem', ''))
        WHEN '' THEN 'do bem que você quer dar na troca'
        ELSE CASE WHEN lower(_r.dados->'permuta'->>'bem') IN ('casa', 'chácara', 'fazenda', 'sala', 'loja', 'moto', 'caminhonete')
                  THEN 'da ' ELSE 'do ' END || lower(_r.dados->'permuta'->>'bem') END;
      _visita := CASE WHEN _frase IS NULL THEN 'a sua visita'
                      ELSE 'a visita ' || regexp_replace(regexp_replace(_frase, '^o ', 'ao '), '^a ', 'à ') END;
      IF _pend = 'permuta' AND _r.t < 2 THEN
        _txt := format('Oi%s! Quando puder, me conta um pouco mais %s: tamanho e quanto você estima que vale. Assim eu aviso o corretor para verificar a permuta com o proprietário. (Se não quiser mais mensagens, responda SAIR.)', _oi, _bem);
      ELSIF _pend = 'permuta' THEN
        _txt := format('Oi%s! Vou deixar seu atendimento aberto por aqui. Quando puder, me conta um pouco %s que eu aviso o corretor sobre a permuta. (Se não quiser mais mensagens, responda SAIR.)', _oi, _bem);
      ELSIF _pend = 'periodo' AND _r.t < 2 THEN
        _txt := format('Oi%s! Sobre a visita de %s, fica melhor de manhã ou à tarde? Assim eu já aviso o corretor. (Se não quiser mais mensagens, responda SAIR.)', _oi, _r.dados->>'visita_dia_pendente');
      ELSIF _pend = 'dia' AND _r.t < 2 THEN
        _txt := format('Oi%s! Qual dia e período ficam melhores para %s? Assim eu já aviso o corretor. (Se não quiser mais mensagens, responda SAIR.)', _oi, _visita);
      ELSIF _pend IN ('dia', 'periodo') THEN
        _txt := format('Oi%s! Vou deixar seu atendimento aberto por aqui. Quando quiser marcar a visita, é só me dizer o dia e o período. (Se não quiser mais mensagens, responda SAIR.)', _oi);
      ELSIF _r.t = 1 THEN
        _txt := format('Oi%s! Ainda faz sentido para você ver %s? Se quiser, tiro suas dúvidas por aqui. (Se não quiser mais mensagens, responda SAIR.)', _oi, coalesce(_frase, 'o imóvel que você viu'));
      END IF;
    END IF;
    IF _txt IS NOT NULL THEN
      NULL; -- texto coerente já escolhido acima
    ELSIF _r.t = 0 THEN
      _txt := format('Oi%s! Conseguiu ver minha mensagem sobre %s? Se quiser, te conto mais detalhes por aqui. (Se não quiser mais mensagens, responda SAIR.)',
                     CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END, coalesce(_frase, 'o imóvel que você viu'));
    ELSIF _r.t = 1 THEN
      _txt := format('Oi%s! Ainda faz sentido para você ver %s? Posso separar 2 horários de visita. (Se não quiser mais mensagens, responda SAIR.)',
                     CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END, coalesce(_frase, 'o imóvel que você viu'));
    ELSE
      _alt := NULL; _txt := NULL;
      IF _cap IS NOT NULL THEN
        SELECT a.id INTO _alt FROM public.exclusive_captures o2, public.exclusive_captures a
         WHERE o2.id = _cap AND a.organization_id = _r.organization_id AND a.id <> _cap
           AND a.status = 'aprovada' AND a.discarded_at IS NULL AND a.archived_at IS NULL
           AND public.lead_ia_tipo(a.form_data->'imovel'->>'tipo_imovel') IS NOT NULL
           AND public.lead_ia_tipo(a.form_data->'imovel'->>'tipo_imovel') = public.lead_ia_tipo(o2.form_data->'imovel'->>'tipo_imovel')
           AND public.lead_ia_norm(btrim(a.form_data->'imovel'->>'municipio')) = public.lead_ia_norm(btrim(o2.form_data->'imovel'->>'municipio'))
         ORDER BY (public.lead_ia_norm(btrim(a.form_data->'imovel'->>'bairro')) = public.lead_ia_norm(btrim(o2.form_data->'imovel'->>'bairro'))) DESC,
                  a.created_at DESC
         LIMIT 1;
      END IF;
      _alt_frase := CASE WHEN _alt IS NOT NULL THEN public.lead_ia_imovel_frase(_alt, _r.organization_id, 'indef') END;
      IF _alt_frase IS NULL AND _r.h0 IS NOT NULL AND NOT _r.cli THEN
        -- t_ccaa41c0: no modo de 3 lembretes, sem alternativa compatível o último lembrete é curto (sem outro imóvel).
        _txt := format('Oi%s! Vou deixar seu atendimento aberto por aqui. Se ainda tiver interesse em %s, é só me responder. (Se não quiser mais mensagens, responda SAIR.)',
                       CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END, coalesce(_frase, 'o imóvel que você viu'));
      END IF;
      CONTINUE WHEN _alt_frase IS NULL AND _txt IS NULL; -- sem alternativa compatível: não manda o 2º toque
      IF _alt_frase IS NOT NULL THEN
      _txt := format('Oi%s! Caso %s não seja o ideal, temos também %s. Quer que eu peça ao corretor os detalhes? (Se não quiser mais mensagens, responda SAIR.)',
                     CASE WHEN _nome = '' THEN '' ELSE ', ' || _nome END, coalesce(_frase, 'o imóvel que você viu'), _alt_frase);
      END IF;
    END IF;
    CONTINUE WHEN public.lead_ia_status_saida(_r.conversa_id) <> 'pendente';
    INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
    VALUES (_r.organization_id, _r.conversa_id, 'ia', left(_txt, 2000), 'pendente');
    UPDATE public.lead_conversas
       SET reengaje_0_em = CASE WHEN _r.t = 0 THEN now() ELSE reengaje_0_em END,
           reengaje_1_em = CASE WHEN _r.t = 1 THEN now() ELSE reengaje_1_em END,
           reengaje_2_em = CASE WHEN _r.t = 2 THEN now() ELSE reengaje_2_em END,
           -- t_99359490: o lembrete pediu os detalhes da permuta: a próxima resposta do cliente já encaminha.
           dados = CASE WHEN _pend = 'permuta' THEN jsonb_set(dados, '{permuta,etapa}', '"detalhes"')
                        WHEN _r.t = 2 AND _alt_frase IS NOT NULL THEN dados || jsonb_build_object('alternativa', _alt_frase, 'alternativa_id', _alt) ELSE dados END,
           updated_at = now()
     WHERE id = _r.conversa_id;
    UPDATE public.lead_config
       SET ia_reengajar_proximo_em = now() + make_interval(secs => _r.imin + floor(random() * (_r.imax - _r.imin + 1)))
     WHERE organization_id = _r.organization_id;
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_r.organization_id, _r.lead_id, 'ia', 'reengaje_' || _r.t, 'IA preparou o toque ' || _r.t || ' de reengajamento.');
    lead_id := _r.lead_id; toque := _r.t;
    RETURN NEXT;
    RETURN;
  END LOOP;
END $function$;

COMMIT;
