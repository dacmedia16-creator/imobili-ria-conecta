-- t_32f5458d (Denis 24/11/2026, tópico 6238): leads do C2S entram no ADM, no MESMO corretor do C2S, sem prazo de aceite,
-- com aviso por WhatsApp ao corretor (telefone do cliente + imóvel + histórico) na chegada e na transferência manual.
-- Entrada: webhook oficial do C2S (POST /integration/api/subscribe, hook_action on_create_lead) -> /api/leads/c2s/<token>.
-- Só leads NOVOS: criados no C2S a partir de lead_config.c2s_desde (sem importação de estoque antigo; Denis 24/11).
-- Tudo nasce DESLIGADO: sem token (c2s_token_hash) nada entra; sem c2s_aviso_whats nenhum WhatsApp sai.
-- Nicole/aquecimento: nada muda (ia_* e aquecer_* intocados).
-- Rollback: lead_c2s_desligar(org) (ou c2s_token_hash = NULL) + c2s_aviso_whats = false. As funções antigas voltam com
-- a reaplicação dos corpos de 20261025170000 (lead_inserir), 20261025150000 (lead_atribuir, leads_processar_prazos) e
-- 20261031030000 (lead_avisos_corretor_reservar). As colunas novas podem ficar (não mudam nada com tudo desligado).

-- 1) Colunas -------------------------------------------------------------------------------------------------------
ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS c2s_token_hash text CHECK (c2s_token_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS c2s_desde timestamptz,
  ADD COLUMN IF NOT EXISTS c2s_aviso_whats boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS lead_config_c2s_hash_uniq ON public.lead_config (c2s_token_hash)
  WHERE c2s_token_hash IS NOT NULL;

-- sem_prazo: o lead fica com o corretor até ser arquivado (sem prazo de aceite e sem volta ao banco por tempo).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sem_prazo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS imovel_interesse text CHECK (char_length(imovel_interesse) <= 300);

-- leads usa permissão por coluna (20261025160000: telefone/e-mail fora). A tela lê as 2 colunas novas (LEAD_COLS).
GRANT SELECT (sem_prazo, imovel_interesse) ON public.leads TO authenticated;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_origem_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_origem_check
  CHECK (origem IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro', 'grupo_olx', 'c2s'));

ALTER TABLE public.lead_avisos_corretor DROP CONSTRAINT IF EXISTS lead_avisos_corretor_evento_check;
ALTER TABLE public.lead_avisos_corretor ADD CONSTRAINT lead_avisos_corretor_evento_check
  CHECK (evento IN ('passagem', 'reenvio', 'historico', 'pronto', 'historico_pronto', 'c2s', 'transferencia'));

-- 2) lead_inserir aceita a origem 'c2s' (mesmo corpo de 20261025170000) ---------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_inserir(_org uuid, _nome text, _telefone text, _email text, _origem text,
  _mensagem text, _capture_id uuid, _autor uuid, _simulado boolean, _consentimento text, _externo_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _id uuid; _captador uuid;
  _tel text := nullif(regexp_replace(coalesce(_telefone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro', 'grupo_olx', 'c2s') THEN
    RAISE EXCEPTION 'Origem invalida' USING ERRCODE = '22023';
  END IF;
  IF _capture_id IS NOT NULL THEN
    SELECT c.captor_id INTO _captador FROM public.exclusive_captures c
     WHERE c.id = _capture_id AND c.organization_id = _org AND c.discarded_at IS NULL AND c.archived_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Captacao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  END IF;
  INSERT INTO public.leads (organization_id, nome, telefone, email, origem, mensagem, capture_id, captador_id,
                            created_by, simulado, consentimento_em, consentimento_texto, externo_id)
  VALUES (_org, btrim(_nome), _tel, nullif(lower(btrim(coalesce(_email, ''))), ''), _origem,
          nullif(btrim(coalesce(_mensagem, '')), ''), _capture_id, _captador, _autor, coalesce(_simulado, false),
          CASE WHEN nullif(btrim(coalesce(_consentimento, '')), '') IS NOT NULL THEN now() END,
          nullif(btrim(coalesce(_consentimento, '')), ''), _externo_id)
  RETURNING id INTO _id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
  VALUES (_org, _id, 'criado', _origem, _autor);
  IF _capture_id IS NOT NULL THEN
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
    VALUES (_org, _id, 'vinculo', _captador::text, _autor);
  END IF;
  RETURN _id;
END $function$;

-- 3) Mapeamento corretor C2S -> usuário ADM ---------------------------------------------------------------------------
-- Nome normalizado: minúsculo, sem acento, só letras e 1 espaço.
CREATE OR REPLACE FUNCTION public.lead_c2s_norm(_t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT nullif(btrim(regexp_replace(regexp_replace(
           translate(lower(coalesce(_t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
           '[^a-z ]', ' ', 'g'), '\s+', ' ', 'g')), '')
$function$;

-- 1º e-mail igual; 2º nome igual e ÚNICO entre quem pode ser responsável. Senão NULL (quem chama usa o padrão).
CREATE OR REPLACE FUNCTION public.lead_c2s_responsavel(_org uuid, _email text, _nome text, OUT responsavel uuid, OUT casou text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _e text := nullif(lower(btrim(coalesce(_email, ''))), ''); _n text := public.lead_c2s_norm(_nome); _ids uuid[];
BEGIN
  IF _e IS NOT NULL THEN
    SELECT p.id INTO responsavel FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE p.organization_id = _org AND lower(u.email) = _e AND public.lead_pode_ser_responsavel(p.id, _org)
     LIMIT 1;
    IF responsavel IS NOT NULL THEN casou := 'email'; RETURN; END IF;
  END IF;
  IF _n IS NOT NULL THEN
    SELECT array_agg(p.id) INTO _ids FROM public.profiles p
     WHERE p.organization_id = _org AND public.lead_c2s_norm(p.nome) = _n AND public.lead_pode_ser_responsavel(p.id, _org);
    IF cardinality(_ids) = 1 THEN responsavel := _ids[1]; casou := 'nome'; RETURN; END IF;
  END IF;
END $function$;

-- 4) Texto do aviso (3 itens: telefone, imóvel, histórico) ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_c2s_aviso_texto(_lead uuid, _transferido boolean)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT left(concat_ws(E'\n',
    coalesce(public.lead_ia_org_nome(l.organization_id) || ': ', '')
      || CASE WHEN _transferido THEN 'um lead do C2S foi transferido para você.' ELSE 'novo lead do C2S para você.' END,
    'Cliente: ' || coalesce(nullif(btrim(l.nome), ''), 'sem nome'),
    'Telefone: ' || coalesce(public.lead_aviso_telefone_txt(l.telefone), 'não informado'),
    CASE WHEN l.telefone IS NULL AND l.email IS NOT NULL THEN 'E-mail: ' || l.email END,
    'Imóvel: ' || coalesce(nullif(concat_ws(' · ', 'ref. ' || nullif(btrim(l.anuncio_codigo), ''), nullif(btrim(l.imovel_interesse), '')), ''),
                           'não informado no C2S'),
    'Histórico: ' || coalesce(nullif(btrim(l.historico), ''), 'sem mensagens no C2S'),
    'O lead já está em Meus leads no ADM, sem prazo de aceite.'), 2000)
  FROM (SELECT x.*, CASE WHEN x.mensagem LIKE 'Imóvel: %' THEN nullif(btrim(substr(x.mensagem, strpos(x.mensagem, E'\n') + 1)), '')
                         ELSE x.mensagem END AS historico
          FROM public.leads x WHERE x.id = _lead) l
$function$;

-- 5) Recebimento do webhook -------------------------------------------------------------------------------------------
-- Aceita o lead no formato do GET /leads/:id do C2S ({data:{id, attributes, messages}}) ou o objeto do lead direto.
CREATE OR REPLACE FUNCTION public.lead_c2s_receber(_token text, _lead jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c public.lead_config; _ok boolean; _x jsonb; _a jsonb; _ext text; _criado timestamptz; _id uuid;
  _nome text; _tel text; _mail text; _ref text; _imovel text; _hist text; _origem_c2s text; _p jsonb;
  _s jsonb; _resp uuid; _casou text; _msgs jsonb;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT c.* INTO _c FROM public.lead_config c
   WHERE c.c2s_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex');
  IF _c.organization_id IS NULL THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT (o.status = 'ativa' AND coalesce((SELECT m.enabled FROM public.organization_modules m
            WHERE m.organization_id = o.id AND m.module = 'leads'), false))
    INTO _ok FROM public.organizations o WHERE o.id = _c.organization_id;
  IF NOT coalesce(_ok, false) OR _c.c2s_desde IS NULL THEN RETURN jsonb_build_object('r', 'modulo'); END IF;

  -- Um recebimento por vez por imobiliária (o C2S pode mandar on_create e reenvios ao mesmo tempo).
  PERFORM pg_advisory_xact_lock(hashtextextended('lead_c2s:' || _c.organization_id::text, 0));

  _x := CASE WHEN jsonb_typeof(_lead->'data') = 'object' THEN _lead->'data' ELSE _lead END;
  _a := CASE WHEN jsonb_typeof(_x->'attributes') = 'object' THEN _x->'attributes' END;
  _ext := CASE WHEN jsonb_typeof(_x->'id') IN ('string', 'number') THEN btrim(_x->>'id') END;
  IF _a IS NULL OR _ext IS NULL OR char_length(_ext) NOT BETWEEN 1 AND 200 THEN
    RETURN jsonb_build_object('r', 'invalido');
  END IF;
  BEGIN
    _criado := (_a->>'created_at')::timestamptz;
  EXCEPTION WHEN OTHERS THEN _criado := NULL;
  END;
  IF _criado IS NULL THEN RETURN jsonb_build_object('r', 'invalido'); END IF;
  -- Só leads novos (Denis 24/11: sem estoque antigo).
  IF _criado < _c.c2s_desde THEN RETURN jsonb_build_object('r', 'antigo'); END IF;
  IF EXISTS (SELECT 1 FROM public.leads WHERE organization_id = _c.organization_id AND origem = 'c2s' AND externo_id = _ext) THEN
    RETURN jsonb_build_object('r', 'duplicado');
  END IF;

  -- Cliente
  _nome := left(coalesce(nullif(btrim(regexp_replace(coalesce(_a->'customer'->>'name', ''), '\s+', ' ', 'g')), ''), 'Lead C2S'), 120);
  _tel := regexp_replace(coalesce(_a->'customer'->>'phone', ''), '[^0-9]', '', 'g');
  IF _tel !~ '^[0-9]{10,13}$' THEN _tel := regexp_replace(coalesce(_a->'customer'->>'phone2', ''), '[^0-9]', '', 'g'); END IF;
  IF _tel ~ '^55[1-9][0-9]{9,10}$' THEN _tel := substr(_tel, 3); END IF;
  IF _tel !~ '^[0-9]{8,15}$' THEN _tel := NULL; END IF;
  _mail := lower(btrim(coalesce(_a->'customer'->>'email', '')));
  IF char_length(_mail) > 160 OR _mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN _mail := NULL; END IF;
  IF _tel IS NULL AND _mail IS NULL THEN RETURN jsonb_build_object('r', 'sem_contato'); END IF;

  -- Imóvel de interesse
  _p := CASE WHEN jsonb_typeof(_a->'product') = 'object' THEN _a->'product' ELSE '{}'::jsonb END;
  _ref := left(nullif(btrim(coalesce(_p->>'prop_ref', '')), ''), 60);
  _imovel := left(nullif(concat_ws(' · ',
               nullif(btrim(regexp_replace(coalesce(_p->>'description', _a->>'description', ''), '^\[[^]]*\]\s*', '')), ''),
               nullif(concat_ws('/', nullif(btrim(_p->>'neighbourhood'), ''), nullif(btrim(_p->>'city'), '')), ''),
               CASE WHEN nullif(btrim(_p->>'price'), '') IS NOT NULL THEN 'R$ ' || btrim(_p->>'price') END,
               nullif(btrim(_p->'real_estate_detail'->>'negotiation_name'), ''),
               CASE WHEN btrim(coalesce(_a->>'url', '')) ~ '^https?://' THEN btrim(_a->>'url') END), ''), 300);

  -- Histórico: mensagens do C2S (cliente e corretor), mais antigas cortadas acima do limite.
  _msgs := CASE WHEN jsonb_typeof(_x->'messages') = 'array' AND jsonb_array_length(_x->'messages') > 0 THEN _x->'messages'
                WHEN jsonb_typeof(_a->'messages') = 'array' THEN _a->'messages' ELSE '[]'::jsonb END;
  SELECT string_agg(linha, E'\n' ORDER BY quando, ord) INTO _hist FROM (
    SELECT m.ord, (m.v->>'created_at') AS quando,
           coalesce(to_char((m.v->>'created_at')::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') || ' ', '')
           || CASE WHEN m.v->>'sender_type' = 'Customer' THEN 'Cliente' ELSE 'Corretor/C2S' END || ': '
           || left(btrim(regexp_replace(coalesce(m.v->>'body', ''), '[[:space:]]+', ' ', 'g')), 400) AS linha
      FROM jsonb_array_elements(_msgs) WITH ORDINALITY m(v, ord)
     WHERE jsonb_typeof(m.v) = 'object' AND btrim(coalesce(m.v->>'body', '')) <> ''
     ORDER BY m.ord DESC LIMIT 15) h;
  _origem_c2s := left(nullif(btrim(coalesce(_a->'lead_source'->>'name', '')), ''), 60);
  _hist := concat_ws(E'\n', CASE WHEN _origem_c2s IS NOT NULL THEN 'Origem no C2S: ' || _origem_c2s END, right(_hist, 3000));

  -- Responsável = o MESMO corretor do C2S; sem correspondência = responsável padrão (ia_corretor_passagem_id).
  _s := CASE WHEN jsonb_typeof(_a->'seller') = 'object' THEN _a->'seller' ELSE '{}'::jsonb END;
  SELECT r.responsavel, r.casou INTO _resp, _casou FROM public.lead_c2s_responsavel(_c.organization_id, _s->>'email', _s->>'name') r;
  IF _resp IS NULL AND public.lead_pode_ser_responsavel(_c.ia_corretor_passagem_id, _c.organization_id) THEN
    _resp := _c.ia_corretor_passagem_id;
  END IF;

  BEGIN
    _id := public.lead_inserir(_c.organization_id, _nome, _tel, _mail, 'c2s',
             left(concat_ws(E'\n', 'Imóvel: ' || coalesce(concat_ws(' · ', 'ref. ' || _ref, _imovel), 'não informado no C2S'),
                            nullif(_hist, '')), 4000),
             NULL, NULL, false, NULL, _ext);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('r', 'duplicado');
  END;
  -- Sem rodízio nem captador: só o corretor do C2S. Já aceito (sem prazo de aceite) e sem prazo por tempo.
  UPDATE public.leads SET anuncio_codigo = _ref, imovel_interesse = _imovel, sem_prazo = true,
         responsavel_id = _resp, atribuido_em = CASE WHEN _resp IS NOT NULL THEN now() END,
         aceito_em = CASE WHEN _resp IS NOT NULL THEN now() END,
         tentativas_aceite = CASE WHEN _resp IS NOT NULL THEN 1 ELSE 0 END, updated_at = now()
   WHERE id = _id;
  IF _resp IS NOT NULL THEN
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    VALUES (_c.organization_id, _id, 'atribuido', _resp::text,
            left(CASE _casou WHEN 'email' THEN 'C2S: mesmo corretor do C2S (e-mail)'
                             WHEN 'nome' THEN 'C2S: mesmo corretor do C2S (nome)'
                             ELSE 'C2S: corretor do C2S sem correspondência no ADM ('
                                  || coalesce(left(nullif(btrim(_s->>'name'), ''), 60), 'sem nome') || '); ficou com o responsável padrão' END
                 || '; sem prazo de aceite', 2000));
    PERFORM public.lead_notificar(_resp, _c.organization_id, 'Novo lead do C2S para você',
      'Lead "' || _nome || '": já está em Meus leads, sem prazo de aceite.');
    IF _c.c2s_aviso_whats THEN
      INSERT INTO public.lead_avisos_corretor (organization_id, lead_id, user_id, evento, texto)
      VALUES (_c.organization_id, _id, _resp, 'c2s', 'Novo lead do C2S (texto montado no envio).')
      ON CONFLICT (lead_id, evento) DO NOTHING;
    END IF;
  END IF;
  RETURN jsonb_build_object('r', 'ok', 'casou', coalesce(_casou, CASE WHEN _resp IS NOT NULL THEN 'padrao' ELSE 'sem_responsavel' END));
END $function$;

-- 6) Token do webhook (só o servidor/operador; o token aparece 1 vez e o banco guarda só o hash) ----------------------
CREATE OR REPLACE FUNCTION public.lead_c2s_token_gerar(_org uuid, _desde timestamptz)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _tok text := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
BEGIN
  IF _desde IS NULL THEN RAISE EXCEPTION 'Informe desde quando os leads entram' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.lead_config SET c2s_token_hash = encode(extensions.digest(_tok, 'sha256'), 'hex'), c2s_desde = _desde,
         updated_at = now()
   WHERE organization_id = _org;
  RETURN _tok;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_c2s_desligar(_org uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  UPDATE public.lead_config SET c2s_token_hash = NULL, c2s_desde = NULL, c2s_aviso_whats = false, updated_at = now()
   WHERE organization_id = _org
$function$;

-- 7) Transferência manual: lead sem prazo continua sem prazo de aceite + WhatsApp ao novo corretor -----------------------
-- (mesmo corpo de 20261025150000; só os trechos marcados t_32f5458d mudam)
CREATE OR REPLACE FUNCTION public.lead_atribuir(_lead uuid, _responsavel_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.lead_ctx(); _me uuid := auth.uid(); _l public.leads; _prazo integer; _whats boolean;
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador atribui lead' USING ERRCODE = '42501';
  END IF;
  _l := public.lead_pega(_lead, _org);
  IF NOT public.lead_pode_ser_responsavel(_responsavel_id, _org) THEN
    RAISE EXCEPTION 'Responsavel invalido' USING ERRCODE = '22023';
  END IF;
  IF _l.responsavel_id IS NOT DISTINCT FROM _responsavel_id THEN RETURN _responsavel_id; END IF;
  -- t_32f5458d: lead sem prazo (C2S) já nasce aceito para o novo corretor.
  UPDATE public.leads SET responsavel_id = _responsavel_id, atribuido_em = now(),
         aceito_em = CASE WHEN _l.sem_prazo THEN now() END,
         ultima_interacao_em = NULL, no_banco_desde = NULL, tentativas_aceite = 1, updated_at = now()
   WHERE id = _l.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, de, para, nota, autor_id)
  VALUES (_org, _l.id, CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'redistribuido' ELSE 'atribuido' END,
          coalesce(_l.responsavel_id::text, CASE WHEN _l.no_banco_desde IS NOT NULL THEN 'banco' END),
          _responsavel_id::text, 'pelo gestor', _me);
  SELECT coalesce(c.prazo_aceite_min, 30), coalesce(c.c2s_aviso_whats, false) INTO _prazo, _whats
    FROM public.lead_config c WHERE c.organization_id = _org;
  IF _l.sem_prazo THEN
    PERFORM public.lead_notificar(_responsavel_id, _org, 'Novo lead para você',
      'Lead "' || _l.nome || '": já está em Meus leads, sem prazo de aceite.');
    IF coalesce(_whats, false) AND NOT _l.simulado THEN
      INSERT INTO public.lead_avisos_corretor (organization_id, lead_id, user_id, evento, texto)
      VALUES (_org, _l.id, _responsavel_id, 'transferencia', 'Lead do C2S transferido (texto montado no envio).')
      ON CONFLICT (lead_id, evento) DO UPDATE
        SET user_id = EXCLUDED.user_id, texto = EXCLUDED.texto, status = 'pendente', created_at = now(), enviado_em = NULL;
    END IF;
  ELSE
    PERFORM public.lead_notificar(_responsavel_id, _org, 'Novo lead para você',
      'Lead "' || _l.nome || '": aceite em até ' || public.lead_prazo_txt(coalesce(_prazo, 30)) || ' em Meus leads.');
  END IF;
  RETURN _responsavel_id;
END $function$;

-- 8) Prazos: lead sem prazo nunca volta ao banco nem é redistribuído por tempo ----------------------------------------
-- (mesmo corpo de 20261025150000; só o WHERE ganha "NOT l.sem_prazo" nas 3 regras de tempo)
CREATE OR REPLACE FUNCTION public.leads_processar_prazos()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _r record; _sem_dono integer := 0; _papel integer := 0; _aceite integer := 0;
  _primeira integer := 0; _parado integer := 0; _falhas integer := 0;
BEGIN
  FOR _r IN
    SELECT l.id, l.responsavel_id, l.aceito_em, l.ultima_interacao_em, l.atribuido_em, l.organization_id,
           c.prazo_aceite_min, c.prazo_primeira_interacao_dias AS d1, c.prazo_sem_interacao_dias AS d30
      FROM public.leads l
      JOIN public.organizations o ON o.id = l.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = l.organization_id AND m.module = 'leads' AND m.enabled
      JOIN public.lead_config c ON c.organization_id = l.organization_id
     WHERE l.etapa NOT IN ('ganho', 'perdido') AND l.no_banco_desde IS NULL
       AND (l.responsavel_id IS NULL
         OR NOT public.lead_pode_ser_responsavel(l.responsavel_id, l.organization_id)
         OR (NOT l.sem_prazo AND l.aceito_em IS NULL
             AND coalesce(l.atribuido_em, l.created_at) + make_interval(mins => c.prazo_aceite_min) <= now())
         OR (NOT l.sem_prazo AND l.aceito_em IS NOT NULL AND l.ultima_interacao_em IS NULL
             AND l.aceito_em + make_interval(days => c.prazo_primeira_interacao_dias) <= now())
         OR (NOT l.sem_prazo AND l.ultima_interacao_em IS NOT NULL
             AND l.ultima_interacao_em + make_interval(days => c.prazo_sem_interacao_dias) <= now()))
     ORDER BY l.created_at
     LIMIT 500
     FOR UPDATE OF l SKIP LOCKED
  LOOP
   -- Um lead com problema não trava a rodada: desfaz só ele, avisa no log e segue.
   BEGIN
    IF _r.responsavel_id IS NULL THEN
      PERFORM public.lead_distribuir(_r.id, NULL, 'sem responsavel', NULL); _sem_dono := _sem_dono + 1;
    ELSIF NOT public.lead_pode_ser_responsavel(_r.responsavel_id, _r.organization_id) THEN
      IF _r.aceito_em IS NULL THEN
        PERFORM public.lead_distribuir(_r.id, _r.responsavel_id, 'responsavel sem papel de atendimento', NULL);
      ELSE
        PERFORM public.lead_mandar_banco(_r.id, 'responsavel sem papel de atendimento', NULL);
      END IF;
      _papel := _papel + 1;
    ELSIF _r.aceito_em IS NULL THEN
      PERFORM public.lead_distribuir(_r.id, _r.responsavel_id,
        'nao aceito em ' || public.lead_prazo_txt(_r.prazo_aceite_min), NULL);
      _aceite := _aceite + 1;
    ELSIF _r.ultima_interacao_em IS NULL THEN
      PERFORM public.lead_mandar_banco(_r.id, 'sem 1a interacao em ' || _r.d1 || ' dias', NULL);
      _primeira := _primeira + 1;
    ELSE
      PERFORM public.lead_mandar_banco(_r.id, _r.d30 || ' dias sem interacao', NULL);
      _parado := _parado + 1;
    END IF;
   EXCEPTION WHEN OTHERS THEN
    _falhas := _falhas + 1;
    RAISE WARNING 'leads_processar_prazos: lead % falhou: %', _r.id, SQLERRM;
   END;
  END LOOP;
  DELETE FROM public.lead_form_tentativas WHERE created_at < now() - interval '1 day';
  RETURN jsonb_build_object('sem_responsavel', _sem_dono, 'papel', _papel, 'aceite_vencido', _aceite,
                            'sem_primeira_interacao', _primeira, 'sem_interacao', _parado, 'falhas', _falhas);
END $function$;

-- 9) Envio dos avisos: os eventos do C2S saem com a chave própria (c2s_aviso_whats), sem depender da Nicole ----------
-- (mesmo corpo de 20261031030000 / produção; mudam só o filtro e o texto dos eventos 'c2s'/'transferencia')
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
     WHERE a.status = 'pendente' AND (_lead IS NULL OR a.lead_id = _lead)
       AND a.created_at > now() - interval '1 day'
       AND ((a.evento IN ('passagem', 'reenvio', 'pronto')
             AND c.ia_aviso_corretor_whats AND c.ia_ativa AND c.ia_canal = 'ziontalk')
         -- t_32f5458d: aviso do C2S (chegada e transferência manual), com chave própria.
         OR (a.evento IN ('c2s', 'transferencia') AND c.c2s_aviso_whats))
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
    -- t_32f5458d: 1 mensagem só, com telefone, imóvel e histórico do C2S. Sem código de aceite (já aceito).
    IF _a.evento IN ('c2s', 'transferencia') THEN
      _txt := coalesce(public.lead_c2s_aviso_texto(_a.lead_id, _a.evento = 'transferencia'), _a.texto);
      UPDATE public.lead_avisos_corretor SET status = 'enviando', texto = _txt WHERE id = _a.id;
      aviso_id := _a.id; telefone := _tel; texto := _txt;
      RETURN NEXT;
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

-- 10) Permissões: funções novas só para o servidor (service_role) -----------------------------------------------------
REVOKE ALL ON FUNCTION public.lead_c2s_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_c2s_responsavel(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_c2s_aviso_texto(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_c2s_receber(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_c2s_token_gerar(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lead_c2s_desligar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_c2s_norm(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_c2s_responsavel(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_c2s_aviso_texto(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_c2s_receber(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_c2s_token_gerar(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_c2s_desligar(uuid) TO service_role;
