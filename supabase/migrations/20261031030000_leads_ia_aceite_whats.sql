-- t_63c55cee (Denis, 31/10/2026, tópico 6238): "Se ele responder que aceita, você muda no sistema automaticamente que
-- ele aceitou". O corretor aceita o lead respondendo "ACEITO <código>" no WhatsApp da Nicole.
--
-- Chave por imobiliária: lead_config.ia_aceite_whats (nasce DESLIGADA). Só vale junto com ia_aviso_corretor_whats
-- (o rollback da liberação, que desliga o aviso, desliga isto também).
--
-- Quem é "corretor" aqui: telefone do CADASTRO (profiles.telefone) de alguém da imobiliária que pode ser responsável
-- E que é o corretor da passagem ou já recebeu aviso de passagem da Nicole. Assim o administrador que testa como
-- cliente continua sendo tratado como cliente. Mensagem de corretor NUNCA vira conversa de cliente: não cria
-- lead/conversa, não chama a IA, não entra em lead_ia_retorno_eventos (limites por minuto/dia).
--
-- O aceite usa a MESMA função do botão "Aceitar" (lead_aceitar), executada com a identidade do corretor só dentro
-- desta transação: mesmas regras e o mesmo registro de evento ('aceite'), com a nota "aceito pelo WhatsApp".
-- Só aceita lead que a Nicole passou para AQUELE corretor (lead_avisos_corretor), ainda dele, sem aceite e no prazo.
-- Idempotente: 1 linha por mensagem (hash do id da mensagem); reenvio da ZionTalk = 'duplicado', nada muda.
-- Nada de telefone nem texto gravado em log: lead_aceite_whats guarda só a ação.

ALTER TABLE public.lead_config ADD COLUMN IF NOT EXISTS ia_aceite_whats boolean NOT NULL DEFAULT false;

-- Código curto (4 dígitos) do lead para aquele corretor. Único por corretor.
CREATE TABLE IF NOT EXISTS public.lead_aceite_codigos (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  codigo integer NOT NULL CHECK (codigo BETWEEN 1000 AND 9999),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, user_id),
  UNIQUE (user_id, codigo)
);
ALTER TABLE public.lead_aceite_codigos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lead_aceite_codigos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lead_aceite_codigos TO service_role;

-- Registro de cada mensagem de corretor (dedup + o que foi feito). Sem telefone e sem texto.
CREATE TABLE IF NOT EXISTS public.lead_aceite_whats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  externo_hash text NOT NULL CHECK (externo_hash ~ '^[0-9a-f]{64}$'),
  acao text NOT NULL DEFAULT 'recebido' CHECK (acao IN ('recebido', 'aceito', 'ja_aceito', 'lista', 'sem_pendente',
        'codigo_invalido', 'expirado', 'ajuda', 'ignorado', 'ambiguo', 'erro', 'nao_corretor')),
  status text NOT NULL DEFAULT 'nenhuma' CHECK (status IN ('nenhuma', 'pendente', 'enviada', 'falhou')),
  created_at timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz,
  UNIQUE (organization_id, externo_hash)
);
CREATE INDEX IF NOT EXISTS lead_aceite_whats_user_idx ON public.lead_aceite_whats (user_id, created_at DESC);
ALTER TABLE public.lead_aceite_whats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lead_aceite_whats FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lead_aceite_whats TO service_role;

-- "aceito", "aceita", "ok aceito", "ACEITO 1234", "aceito o lead 1234" (sem diferenciar maiúscula/acento/pontuação).
-- NULL = não é um pedido de aceite (ex.: "não aceito", "aceito o da Daniela"). Senão {codigo} (NULL = sem código).
CREATE OR REPLACE FUNCTION public.lead_aceite_whats_parse(_texto text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN m IS NOT NULL THEN ARRAY[m[1]] END
    FROM (SELECT regexp_match(
            btrim(regexp_replace(public.lead_ia_norm(left(coalesce(_texto, ''), 200)), '[^a-z0-9]+', ' ', 'g')),
            '^(?:(?:ok|okay|sim|certo|beleza|blz|confirmo|pode ser) )?(?:eu )?(?:aceito|aceita|aceitar|aceitei|aceite)'
            || '(?: (?:o )?(?:lead|cliente))?(?: (?:codigo |cod |numero |n )?([0-9]{1,8}))?$') AS m) x
$function$;

-- Código do lead para o corretor (cria na 1ª vez). shortcut: códigos de 30+ dias são reciclados (9000 por corretor).
CREATE OR REPLACE FUNCTION public.lead_aceite_codigo(_lead uuid, _user uuid, _org uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _cod integer; _i integer := 0;
BEGIN
  SELECT codigo INTO _cod FROM public.lead_aceite_codigos WHERE lead_id = _lead AND user_id = _user;
  IF _cod IS NOT NULL THEN RETURN _cod; END IF;
  DELETE FROM public.lead_aceite_codigos WHERE user_id = _user AND created_at < now() - interval '30 days';
  LOOP
    _i := _i + 1;
    INSERT INTO public.lead_aceite_codigos (organization_id, lead_id, user_id, codigo)
    VALUES (_org, _lead, _user, 1000 + floor(random() * 9000)::integer)
    ON CONFLICT DO NOTHING RETURNING codigo INTO _cod;
    IF _cod IS NOT NULL THEN RETURN _cod; END IF;
    SELECT codigo INTO _cod FROM public.lead_aceite_codigos WHERE lead_id = _lead AND user_id = _user;
    IF _cod IS NOT NULL OR _i >= 50 THEN RETURN _cod; END IF;
  END LOOP;
END $function$;

-- Lead "pendente para aquele corretor": a Nicole passou para ele, ainda é dele, sem aceite, aberto e no prazo.
CREATE OR REPLACE FUNCTION public.lead_aceite_pendente(_l public.leads, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT _l.id IS NOT NULL AND _l.responsavel_id = _user AND _l.aceito_em IS NULL
     AND _l.etapa NOT IN ('ganho', 'perdido') AND _l.no_banco_desde IS NULL
     AND coalesce(_l.atribuido_em, _l.created_at)
         + make_interval(mins => (SELECT c.prazo_aceite_min FROM public.lead_config c WHERE c.organization_id = _l.organization_id)) > now()
     AND EXISTS (SELECT 1 FROM public.lead_avisos_corretor a
                  WHERE a.lead_id = _l.id AND a.user_id = _user AND a.evento IN ('passagem', 'reenvio'))
$function$;

-- Lista "• Daniela: ACEITO 1234" dos pendentes do corretor (mais antigos primeiro, até 10). Cria os códigos que faltam.
CREATE OR REPLACE FUNCTION public.lead_aceite_lista(_user uuid, _org uuid, OUT n integer, OUT lista text, OUT unico uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.leads; _nome text; _linhas text[] := '{}';
BEGIN
  n := 0;
  FOR _l IN SELECT l.* FROM public.leads l
             WHERE l.organization_id = _org AND l.responsavel_id = _user AND l.aceito_em IS NULL
             ORDER BY coalesce(l.atribuido_em, l.created_at), l.id LOOP
    CONTINUE WHEN NOT public.lead_aceite_pendente(_l, _user);
    n := n + 1;
    unico := CASE WHEN n = 1 THEN _l.id END;
    IF n <= 10 THEN
      _nome := split_part(btrim(coalesce(_l.nome, '')), ' ', 1);
      IF _nome = '' OR _nome ~ '[0-9@/:]' OR char_length(_nome) > 30 THEN _nome := 'Cliente'; END IF;
      _linhas := _linhas || ('• ' || _nome || ': ACEITO ' || public.lead_aceite_codigo(_l.id, _user, _org));
    END IF;
  END LOOP;
  lista := array_to_string(_linhas, E'\n') || CASE WHEN n > 10 THEN E'\n(e mais ' || (n - 10) || ' no ADM)' ELSE '' END;
END $function$;

-- Mensagem que chegou no número da IA. NULL = não é de corretor (segue o fluxo de cliente de sempre).
CREATE OR REPLACE FUNCTION public.lead_aceite_whats_receber(_c public.lead_config, _chave text, _id text, _texto text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := _c.organization_id; _n integer; _u uuid; _ev uuid; _p text[]; _cod integer; _lead uuid;
  _l public.leads; _np integer; _lista text; _unico uuid; _acao text; _resp text; _old text; _oldsub text;
  _nome text; _rodape text;
BEGIN
  SELECT count(*), (array_agg(p.id))[1] INTO _n, _u
    FROM public.profiles p
    JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
   WHERE coalesce(p.telefone, '') <> '' AND (public.lead_ia_contatos(p.telefone, NULL))[1] = _chave
     AND public.lead_pode_ser_responsavel(p.id, _org)
     AND (p.id = _c.ia_corretor_passagem_id
          OR EXISTS (SELECT 1 FROM public.lead_avisos_corretor a WHERE a.organization_id = _org AND a.user_id = p.id));
  IF coalesce(_n, 0) = 0 THEN RETURN NULL; END IF;

  DELETE FROM public.lead_aceite_whats WHERE organization_id = _org AND created_at < now() - interval '30 days';
  INSERT INTO public.lead_aceite_whats (organization_id, user_id, externo_hash)
  VALUES (_org, CASE WHEN _n = 1 THEN _u END, encode(extensions.digest(_org::text || ':' || _id, 'sha256'), 'hex'))
  ON CONFLICT (organization_id, externo_hash) DO NOTHING RETURNING id INTO _ev;
  IF _ev IS NULL THEN RETURN jsonb_build_object('r', 'duplicado'); END IF;

  _rodape := 'Nada foi alterado.';
  IF _n > 1 THEN
    _acao := 'ambiguo';
    _resp := 'Este telefone está no cadastro de mais de um corretor. Aceite o lead pelo ADM, em Meus leads. ' || _rodape;
  ELSE
    _p := public.lead_aceite_whats_parse(_texto);
    IF _p IS NULL THEN
      -- Não é aceite (conversa, "não aceito", mídia): nunca vai para a IA. Ajuda só se houver pendente, 1x a cada 30 min.
      SELECT x.n, x.lista INTO _np, _lista FROM public.lead_aceite_lista(_u, _org) x;
      IF _np = 0 OR EXISTS (SELECT 1 FROM public.lead_aceite_whats w WHERE w.user_id = _u AND w.acao = 'ajuda'
                              AND w.id <> _ev AND w.created_at > now() - interval '30 minutes') THEN
        _acao := 'ignorado';
      ELSE
        _acao := 'ajuda';
        _resp := 'Este número é o atendimento automático da ' || coalesce(nullif(btrim(_c.ia_nome), ''), 'IA')
                 || '. Leads aguardando o seu aceite:' || E'\n' || _lista || E'\n'
                 || 'Para aceitar, responda ACEITO e o código.';
      END IF;
    ELSIF _p[1] IS NOT NULL THEN
      _cod := CASE WHEN _p[1] ~ '^[0-9]{4}$' THEN _p[1]::integer END;
      SELECT k.lead_id INTO _lead FROM public.lead_aceite_codigos k
       WHERE k.user_id = _u AND k.organization_id = _org AND k.codigo = _cod;
      IF _lead IS NULL THEN
        SELECT x.n, x.lista INTO _np, _lista FROM public.lead_aceite_lista(_u, _org) x;
        _acao := 'codigo_invalido';
        _resp := 'Não achei o código ' || _p[1] || ' entre os leads que a ' || coalesce(nullif(btrim(_c.ia_nome), ''), 'IA')
                 || ' passou para você. ' || _rodape
                 || CASE WHEN _np > 0 THEN E'\nAguardando o seu aceite:\n' || _lista ELSE E'\nVocê não tem lead aguardando aceite agora.' END;
      END IF;
    ELSE
      SELECT x.n, x.lista, x.unico INTO _np, _lista, _unico FROM public.lead_aceite_lista(_u, _org) x;
      IF _np = 0 THEN
        _acao := 'sem_pendente';
        _resp := 'Você não tem lead aguardando aceite agora. ' || _rodape;
      ELSIF _np = 1 THEN
        _lead := _unico;
      ELSE
        _acao := 'lista';
        _resp := 'Você tem ' || _np || ' leads aguardando aceite:' || E'\n' || _lista || E'\n'
                 || 'Responda ACEITO e o código do lead que quer aceitar. Nenhum foi aceito ainda.';
      END IF;
    END IF;

    IF _acao IS NULL AND _lead IS NOT NULL THEN
      SELECT * INTO _l FROM public.leads WHERE id = _lead AND organization_id = _org FOR UPDATE;
      _nome := coalesce(nullif(btrim(_l.nome), ''), 'sem nome');
      IF _l.id IS NOT NULL AND _l.responsavel_id = _u AND _l.aceito_em IS NOT NULL THEN
        _acao := 'ja_aceito';
        _resp := 'O lead ' || _nome || ' já estava aceito ✅' || E'\n'
                 || 'Telefone: ' || coalesce(public.lead_aviso_telefone_txt(_l.telefone), 'não informado');
      ELSIF NOT public.lead_aceite_pendente(_l, _u) THEN
        _acao := 'expirado';
        _resp := 'O lead ' || split_part(_nome, ' ', 1) || ' não está mais aguardando o seu aceite '
                 || '(prazo encerrado, lead encerrado ou com outro corretor). ' || _rodape;
      ELSE
        -- Mesma função do botão "Aceitar", com a identidade do corretor só nesta transação.
        _old := current_setting('request.jwt.claims', true);
        _oldsub := current_setting('request.jwt.claim.sub', true);
        PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _u, 'role', 'authenticated')::text, true);
        PERFORM set_config('request.jwt.claim.sub', _u::text, true);
        BEGIN
          PERFORM public.lead_aceitar(_l.id);
          _acao := 'aceito';
        EXCEPTION WHEN OTHERS THEN
          _acao := 'erro';
        END;
        PERFORM set_config('request.jwt.claims', coalesce(_old, ''), true);
        PERFORM set_config('request.jwt.claim.sub', coalesce(_oldsub, ''), true);
        IF _acao = 'aceito' THEN
          UPDATE public.lead_eventos SET nota = 'aceito pelo WhatsApp'
           WHERE id = (SELECT e.id FROM public.lead_eventos e WHERE e.lead_id = _l.id AND e.tipo = 'aceite'
                        AND e.autor_id = _u ORDER BY e.created_at DESC LIMIT 1) AND nota IS NULL;
          _resp := 'Lead ' || _nome || ' aceito ✅' || E'\n'
                   || 'Telefone: ' || coalesce(public.lead_aviso_telefone_txt(_l.telefone), 'não informado') || E'\n'
                   || 'No ADM ele já aparece como aceito, em Meus leads. Bom atendimento!';
        ELSE
          _resp := 'Não consegui aceitar o lead ' || split_part(_nome, ' ', 1) || ' agora. Aceite pelo ADM, em Meus leads. '
                   || _rodape;
        END IF;
      END IF;
    END IF;
  END IF;

  UPDATE public.lead_aceite_whats
     SET acao = _acao, lead_id = _lead, status = CASE WHEN _resp IS NULL THEN 'nenhuma' ELSE 'pendente' END
   WHERE id = _ev;
  RETURN jsonb_build_object('r', 'corretor', 'resposta_id', CASE WHEN _resp IS NOT NULL THEN _ev END,
                            'resposta', left(_resp, 2000));
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aceite_whats_resultado(_id uuid, _ok boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  UPDATE public.lead_aceite_whats SET status = CASE WHEN _ok THEN 'enviada' ELSE 'falhou' END, enviado_em = now()
   WHERE id = _id AND status = 'pendente';
$function$;

-- Texto do aviso com o código de aceite (3º argumento). NULL = texto de antes (aceite no ADM).
CREATE OR REPLACE FUNCTION public.lead_aviso_corretor_texto(_lead uuid, _reenvio boolean, _codigo integer)
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
    CASE WHEN _codigo IS NOT NULL
         THEN 'Para aceitar, responda: ACEITO ' || _codigo || E'\n'
              || 'Prazo para aceitar: até ' || public.lead_prazo_txt(_c.prazo_aceite_min) || ' (ou aceite no ADM, em Meus leads).'
         ELSE 'Aceite no ADM em Meus leads em até ' || public.lead_prazo_txt(_c.prazo_aceite_min) || '.' END,
    'A conversa com a ' || _ia || ' vem na próxima mensagem.'), 2000);
END $function$;

CREATE OR REPLACE FUNCTION public.lead_aviso_corretor_texto(_lead uuid, _reenvio boolean)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.lead_aviso_corretor_texto(_lead, _reenvio, NULL::integer)
$function$;

-- Reserva (t_50cf73f3) + código de aceite no aviso quando a chave ia_aceite_whats está ligada e o lead está pendente.
CREATE OR REPLACE FUNCTION public.lead_avisos_corretor_reservar(_lead uuid)
 RETURNS TABLE(aviso_id uuid, telefone text, texto text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _a record; _tel text; _txt text; _hist text; _hid uuid; _cod integer; _l public.leads;
BEGIN
  FOR _a IN
    SELECT a.id, a.texto, a.evento, a.lead_id, a.organization_id, a.user_id, p.telefone AS fone, c.ia_aceite_whats AS aceite
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
    _cod := NULL;
    IF _a.aceite THEN
      SELECT * INTO _l FROM public.leads WHERE id = _a.lead_id;
      IF public.lead_aceite_pendente(_l, _a.user_id) THEN
        _cod := public.lead_aceite_codigo(_a.lead_id, _a.user_id, _a.organization_id);
      END IF;
    END IF;
    _txt := coalesce(public.lead_aviso_corretor_texto(_a.lead_id, _a.evento = 'reenvio', _cod), _a.texto);
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

-- Retorno ZionTalk: igual à 20261030220000, com 2 desvios para a chave ia_aceite_whats (marcados t_63c55cee).
CREATE OR REPLACE FUNCTION public.lead_ia_retorno_receber(_token text, _msg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.lead_config; _ok boolean; _id text; _chave text; _tipo text; _texto text;
  _cv public.lead_conversas; _ctx jsonb; _ev bigint; _n integer; _vis boolean; _aviso text; _ace jsonb; _rid uuid;
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

REVOKE ALL ON FUNCTION public.lead_aceite_whats_parse(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aceite_codigo(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aceite_pendente(public.leads, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aceite_lista(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aceite_whats_receber(public.lead_config, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aceite_whats_resultado(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aviso_corretor_texto(uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_aviso_corretor_texto(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_avisos_corretor_reservar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_ia_retorno_receber(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_aceite_whats_parse(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aceite_codigo(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aceite_pendente(public.leads, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aceite_lista(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aceite_whats_receber(public.lead_config, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aceite_whats_resultado(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aviso_corretor_texto(uuid, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_aviso_corretor_texto(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_avisos_corretor_reservar(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_ia_retorno_receber(text, jsonb) TO service_role;
