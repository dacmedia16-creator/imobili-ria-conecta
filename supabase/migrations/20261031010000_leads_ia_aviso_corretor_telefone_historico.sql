-- t_50cf73f3 (Denis, 31/10/2026, tópico 6238): "Mandar o telefone do lead junto" + "Manda o histórico da conversa
-- também via WhatsApp". Vale para quem tem ia_aviso_corretor_whats ligado (hoje só a ZZ); desligar = rollback de
-- t_ccaa41c0 (ia_aviso_corretor_whats = false). O sino do ADM NÃO muda (continua sem telefone antes do aceite).
--
-- O aviso de passagem passa a ser MONTADO NA HORA DO ENVIO (lead_avisos_corretor_reservar), já com a última fala da
-- Nicole gravada:
--   1ª mensagem: nome e TELEFONE do cliente (+ link wa.me), imóvel (código + link do anúncio), resumo e prazo de aceite.
--   2ª mensagem (logo em seguida): histórico Nicole x cliente, em ordem, "HH:MM Nicole: ..." / "HH:MM Cliente: ...".
--     Sem mensagens do sistema e sem o link do anúncio em cada linha; acima de 2000 caracteres (limite do envio),
--     corta as mais antigas e avisa "(conversa completa no ADM)".
-- Idempotente: 1 linha por (lead, evento) — 'passagem' e 'reenvio' (aviso), 'historico' (histórico). Nunca repete.
-- Não conta no limite diário dos clientes (tabela própria). Nada disso vai para log.

ALTER TABLE public.lead_avisos_corretor DROP CONSTRAINT IF EXISTS lead_avisos_corretor_evento_check;
ALTER TABLE public.lead_avisos_corretor ADD CONSTRAINT lead_avisos_corretor_evento_check
  CHECK (evento IN ('passagem', 'reenvio', 'historico'));
ALTER TABLE public.lead_avisos_corretor DROP CONSTRAINT IF EXISTS lead_avisos_corretor_texto_check;
ALTER TABLE public.lead_avisos_corretor ADD CONSTRAINT lead_avisos_corretor_texto_check
  CHECK (char_length(texto) BETWEEN 1 AND 2000);

-- Telefone legível: (15) 99999-9999 e link wa.me. NULL se não for número brasileiro válido.
CREATE OR REPLACE FUNCTION public.lead_aviso_telefone_txt(_tel text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN d ~ '^[1-9][0-9][0-9]{8,9}$' THEN
      '(' || left(d, 2) || ') ' || substr(d, 3, char_length(d) - 6) || '-' || right(d, 4) || ' · wa.me/55' || d
    END
    FROM (SELECT regexp_replace(regexp_replace(coalesce(_tel, ''), '[^0-9]', '', 'g'), '^55(?=[0-9]{10,11}$)', '') AS d) x
$function$;

-- Texto do aviso ao corretor (1ª mensagem). _reenvio = reenvio manual de um lead já passado.
CREATE OR REPLACE FUNCTION public.lead_aviso_corretor_texto(_lead uuid, _reenvio boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.leads; _c public.lead_config; _cv public.lead_conversas; _ia text; _tel text; _link text; _imovel text;
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
  RETURN left(concat_ws(E'\n',
    coalesce(public.lead_ia_org_nome(_l.organization_id) || ': ', '')
      || CASE WHEN _reenvio THEN 'reenvio, agora com o telefone, do cliente que a ' || _ia || ' passou para você.'
              ELSE 'a ' || _ia || ' passou um cliente para você.' END,
    'Cliente: ' || coalesce(nullif(btrim(_l.nome), ''), 'sem nome'),
    'Telefone: ' || coalesce(_tel, 'não informado'),
    'Imóvel: ' || coalesce(_imovel, 'ver no ADM'),
    CASE WHEN nullif(btrim(_cv.resumo), '') IS NOT NULL THEN 'Resumo: ' || btrim(_cv.resumo) END,
    'Aceite no ADM em Meus leads em até ' || public.lead_prazo_txt(_c.prazo_aceite_min) || '.',
    'A conversa com a ' || _ia || ' vem na próxima mensagem.'), 2000);
END $function$;

-- Histórico Nicole x cliente (2ª mensagem). Só mensagens que de fato saíram/chegaram; sem as do sistema.
CREATE OR REPLACE FUNCTION public.lead_aviso_corretor_historico(_lead uuid)
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
     AND ((m.autor = 'ia' AND m.status = 'enviada') OR (m.autor = 'cliente' AND m.status = 'recebida'));
  IF coalesce(array_length(_linhas, 1), 0) = 0 THEN RETURN NULL; END IF;
  _cab := 'Conversa com a ' || _ia || ' (horário de Brasília):';
  LOOP
    _txt := _cab || CASE WHEN _cortou THEN E'\n(início cortado; conversa completa no ADM)' ELSE '' END
            || E'\n' || array_to_string(_linhas, E'\n');
    EXIT WHEN char_length(_txt) <= 2000 OR array_length(_linhas, 1) <= 1;
    _linhas := _linhas[2:]; _cortou := true;  -- corta as mais antigas
  END LOOP;
  RETURN left(_txt, 2000);
END $function$;

-- Reserva: agora devolve o aviso montado na hora (com telefone) e, logo depois, o histórico (linha própria,
-- evento 'historico', única por lead). Corretor sem telefone válido = 'sem_telefone' (fica só o sino).
CREATE OR REPLACE FUNCTION public.lead_avisos_corretor_reservar(_lead uuid)
 RETURNS TABLE(aviso_id uuid, telefone text, texto text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _a record; _tel text; _txt text; _hist text; _hid uuid;
BEGIN
  FOR _a IN
    SELECT a.id, a.texto, a.evento, a.lead_id, a.organization_id, a.user_id, p.telefone AS fone
      FROM public.lead_avisos_corretor a
      JOIN public.lead_config c ON c.organization_id = a.organization_id
      JOIN public.leads l ON l.id = a.lead_id AND l.organization_id = a.organization_id
      JOIN public.profiles p ON p.id = a.user_id
     WHERE a.status = 'pendente' AND a.evento IN ('passagem', 'reenvio') AND (_lead IS NULL OR a.lead_id = _lead)
       AND a.created_at > now() - interval '1 day'
       AND c.ia_aviso_corretor_whats AND c.ia_ativa AND c.ia_canal = 'ziontalk'
       AND l.responsavel_id = a.user_id
     ORDER BY a.created_at
     LIMIT 3
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    _tel := regexp_replace(coalesce(_a.fone, ''), '[^0-9]', '', 'g');
    IF _tel !~ '^(55)?[1-9][0-9][0-9]{8,9}$' THEN
      UPDATE public.lead_avisos_corretor SET status = 'sem_telefone' WHERE id = _a.id;
      CONTINUE;
    END IF;
    _txt := coalesce(public.lead_aviso_corretor_texto(_a.lead_id, _a.evento = 'reenvio'), _a.texto);
    UPDATE public.lead_avisos_corretor SET status = 'enviando', texto = _txt WHERE id = _a.id;
    aviso_id := _a.id; telefone := _tel; texto := _txt;
    RETURN NEXT;
    -- histórico: 1 por lead, logo depois do aviso
    _hist := public.lead_aviso_corretor_historico(_a.lead_id);
    IF _hist IS NOT NULL THEN
      _hid := NULL;
      INSERT INTO public.lead_avisos_corretor (organization_id, lead_id, user_id, evento, texto, status)
      VALUES (_a.organization_id, _a.lead_id, _a.user_id, 'historico', _hist, 'enviando')
      ON CONFLICT (lead_id, evento) DO NOTHING
      RETURNING id INTO _hid;
      IF _hid IS NOT NULL THEN
        aviso_id := _hid; telefone := _tel; texto := _hist;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;
END $function$;

REVOKE ALL ON FUNCTION public.lead_aviso_telefone_txt(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aviso_corretor_texto(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aviso_corretor_historico(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_avisos_corretor_reservar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_aviso_telefone_txt(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aviso_corretor_texto(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aviso_corretor_historico(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_avisos_corretor_reservar(uuid) TO service_role;
