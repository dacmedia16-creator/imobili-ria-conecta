-- Leads — recepção do Grupo ZAP/OLX ("Receber leads no CRM" do Canal Pro). Card t_478b211e;
-- "sim" de Denis em 25/10/2026, tópico 6238. Base: 20261025160000_leads_contato_apos_aceite.
--
-- ADITIVA. Rollback: docs/sql/rollback/20261025170000_leads_grupo_olx.rollback.sql
--
-- Como funciona:
--  - O Canal Pro faz POST JSON (1 lead por requisição) em /api/leads/grupo-olx/<token>.
--    Doc oficial: https://developers.grupozap.com/webhooks/integration_leads.html
--  - O token da URL identifica a imobiliária. É aleatório (32 bytes) e o banco guarda SÓ o hash
--    SHA-256 (lead_config.grupo_olx_token_hash). A URL completa aparece uma vez, ao gerar.
--  - Só o servidor do ADM (service_role) chama lead_grupo_olx_receber. Token desconhecido ou
--    módulo "leads" desligado = recusa SEM gravar nada.
--  - Duplicado: externo_id = originLeadId (índice único leads_externo_uniq). Reenvio = "duplicado" (2xx).
--  - Imóvel: clientListingId/originListingId -> anúncio ligado à captação (exclusive_listing_links,
--    vigente) ou o código curto da captação (8 primeiros caracteres do id). Achou = vai para o
--    captador (lead_distribuir); não achou = rodízio.
--  - Guarda mensagem (sem o link/código de acesso da IZI), tipo (extraData.leadType), temperatura,
--    transactionType e o código do anúncio. NÃO guarda extraData.izi nem o payload bruto.
--  - Limite contra abuso: 600 requisições/hora por imobiliária (acima disso, "limite" -> 429 e o
--    Grupo OLX tenta de novo). Só conta quem já passou pelo token.
--  - Nada é enviado para fora (nenhum WhatsApp/e-mail). O aviso ao corretor continua só no sino.
BEGIN;

-- 1) Origem nova ----------------------------------------------------------------------------------
ALTER TABLE public.leads DROP CONSTRAINT leads_origem_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_origem_check
  CHECK (origem IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro', 'grupo_olx'));

-- 2) Dados do portal no lead (sem contato; o app lê por coluna, ver 20261025160000) ------------------
ALTER TABLE public.leads
  -- clientListingId (código do anúncio no CRM/anunciante) e originListingId (id do anúncio no portal).
  ADD COLUMN IF NOT EXISTS anuncio_codigo text CONSTRAINT leads_anuncio_codigo_check CHECK (char_length(anuncio_codigo) <= 60),
  ADD COLUMN IF NOT EXISTS anuncio_portal_id text CONSTRAINT leads_anuncio_portal_id_check CHECK (char_length(anuncio_portal_id) <= 60),
  -- extraData.leadType (CONTACT_FORM, CONTACT_CHAT, CLICK_WHATSAPP, PHONE_VIEW, VISIT_REQUEST, CLICK_SCHEDULE) ou MCMV.
  ADD COLUMN IF NOT EXISTS portal_tipo text CONSTRAINT leads_portal_tipo_check CHECK (portal_tipo ~ '^[A-Z_]{1,40}$'),
  ADD COLUMN IF NOT EXISTS portal_temperatura text CONSTRAINT leads_portal_temperatura_check CHECK (portal_temperatura IN ('baixa', 'media', 'alta')),
  ADD COLUMN IF NOT EXISTS portal_transacao text CONSTRAINT leads_portal_transacao_check CHECK (portal_transacao IN ('venda', 'aluguel'));
GRANT SELECT (anuncio_codigo, anuncio_portal_id, portal_tipo, portal_temperatura, portal_transacao)
  ON public.leads TO authenticated;

-- 3) Token por imobiliária (só o hash) --------------------------------------------------------------
ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS grupo_olx_token_hash text
    CONSTRAINT lead_config_grupo_olx_hash_check CHECK (grupo_olx_token_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS grupo_olx_token_em timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS lead_config_grupo_olx_hash_uniq ON public.lead_config (grupo_olx_token_hash)
  WHERE grupo_olx_token_hash IS NOT NULL;
-- O app lê a config por coluna: tudo, menos o hash do token.
REVOKE SELECT ON public.lead_config FROM authenticated;
DO $$
DECLARE _cols text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO _cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.lead_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'grupo_olx_token_hash';
  EXECUTE format('GRANT SELECT (%s) ON public.lead_config TO authenticated', _cols);
END $$;

-- 4) Contador anti-abuso (sem dado pessoal) ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_portal_recebimentos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resultado text NOT NULL CHECK (resultado IN ('ok', 'duplicado', 'sem_contato', 'invalido', 'limite', 'modulo')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_portal_recebimentos_idx ON public.lead_portal_recebimentos (organization_id, created_at);
ALTER TABLE public.lead_portal_recebimentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_portal_recebimentos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_portal_recebimentos TO service_role;

-- 5) lead_inserir aceita a origem nova (mesmo corpo da 20261025150000) --------------------------------
CREATE OR REPLACE FUNCTION public.lead_inserir(_org uuid, _nome text, _telefone text, _email text, _origem text,
  _mensagem text, _capture_id uuid, _autor uuid, _simulado boolean, _consentimento text, _externo_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _id uuid; _captador uuid;
  _tel text := nullif(regexp_replace(coalesce(_telefone, ''), '[^0-9+]', '', 'g'), '');
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('manual', 'formulario', 'simulador', 'whatsapp', 'olx', 'meta', 'site', 'outro', 'grupo_olx') THEN
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
END $$;
REVOKE ALL ON FUNCTION public.lead_inserir(uuid, text, text, text, text, text, uuid, uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;

-- 6) Peças internas ----------------------------------------------------------------------------------
-- Tira da mensagem o link e o código de acesso da conversa na IZI (dão acesso à conversa do cliente).
CREATE OR REPLACE FUNCTION public.lead_portal_limpar_mensagem(_m text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT nullif(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(_m, ''),
           '(,\s*)?(para acessar a conversa\s*)?utilize o c[oó]digo:?\s*\S+', '', 'gi'),
           '\S*lead-conversation\.\S*', '', 'gi'),
           'Visualize o hist[oó]rico de mensage(m|ns) do cliente com IZI:?', '', 'gi'),
           '\s{2,}', ' ', 'g')), '')
$$;

-- Captação da imobiliária pelo código do anúncio: anúncio ligado (vigente) ou código curto da captação.
-- Mais de uma captação com o mesmo código curto = ambíguo = NULL (rodízio).
CREATE OR REPLACE FUNCTION public.lead_portal_captacao(_org uuid, _codigo text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c text := upper(btrim(coalesce(_codigo, ''))); _id uuid; _n integer;
BEGIN
  IF _c = '' OR char_length(_c) > 60 THEN RETURN NULL; END IF;
  SELECT l.capture_id INTO _id FROM public.exclusive_listing_links l
    JOIN public.exclusive_captures c ON c.id = l.capture_id AND c.organization_id = _org
     AND c.discarded_at IS NULL AND c.archived_at IS NULL
   WHERE l.organization_id = _org AND l.status = 'ativo' AND l.code_key = public.portal_code_key(_c)
   LIMIT 1;
  IF _id IS NOT NULL THEN RETURN _id; END IF;
  IF _c ~ '^[0-9A-F]{8}$' THEN
    SELECT count(*), min(c.id::text)::uuid INTO _n, _id FROM public.exclusive_captures c
     WHERE c.organization_id = _org AND c.discarded_at IS NULL AND c.archived_at IS NULL
       AND upper(left(c.id::text, 8)) = _c;
    IF _n = 1 THEN RETURN _id; END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.lead_portal_limpar_mensagem(text), public.lead_portal_captacao(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- 7) Recepção (só o servidor do ADM) ------------------------------------------------------------------
-- Devolve {"r": ...}: ok | duplicado | sem_contato (2xx); token (401); modulo (404); invalido (400);
-- limite (429). Erro inesperado = exceção -> o servidor responde 5xx e o Grupo OLX tenta de novo.
CREATE OR REPLACE FUNCTION public.lead_grupo_olx_receber(_token text, _lead jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid; _ok boolean; _ext text; _id uuid; _cap uuid; _x jsonb;
  _cli text; _por text; _tel text; _mail text; _nome text; _temp text; _tran text; _tipo text;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT c.organization_id,
         (o.status = 'ativa' AND coalesce((SELECT m.enabled FROM public.organization_modules m
            WHERE m.organization_id = c.organization_id AND m.module = 'leads'), false))
    INTO _org, _ok
    FROM public.lead_config c JOIN public.organizations o ON o.id = c.organization_id
   WHERE c.grupo_olx_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex');
  IF _org IS NULL THEN RETURN jsonb_build_object('r', 'token'); END IF;
  IF NOT _ok THEN RETURN jsonb_build_object('r', 'modulo'); END IF;

  -- Um recebimento por vez por imobiliária: limite e duplicado não são furados por envios simultâneos.
  PERFORM pg_advisory_xact_lock(hashtextextended('lead_grupo_olx:' || _org::text, 0));
  IF (SELECT count(*) FROM public.lead_portal_recebimentos WHERE organization_id = _org
        AND created_at > now() - interval '1 hour') >= 600 THEN
    RETURN jsonb_build_object('r', 'limite');
  END IF;
  DELETE FROM public.lead_portal_recebimentos WHERE organization_id = _org AND created_at < now() - interval '2 days';

  _ext := CASE WHEN jsonb_typeof(_lead) = 'object' AND jsonb_typeof(_lead->'originLeadId') IN ('string', 'number')
               THEN btrim(_lead->>'originLeadId') END;
  IF _ext IS NULL OR char_length(_ext) NOT BETWEEN 1 AND 200 THEN
    INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'invalido');
    RETURN jsonb_build_object('r', 'invalido');
  END IF;
  IF EXISTS (SELECT 1 FROM public.leads WHERE organization_id = _org AND origem = 'grupo_olx' AND externo_id = _ext) THEN
    INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'duplicado');
    RETURN jsonb_build_object('r', 'duplicado');
  END IF;

  _x := CASE WHEN jsonb_typeof(_lead->'extraData') = 'object' THEN _lead->'extraData' ELSE '{}'::jsonb END;
  _cli := left(nullif(btrim(coalesce(_lead->>'clientListingId', '')), ''), 60);
  _por := left(nullif(btrim(coalesce(_lead->>'originListingId', '')), ''), 60);
  _nome := left(coalesce(nullif(btrim(regexp_replace(coalesce(_lead->>'name', ''), '\s+', ' ', 'g')), ''),
                         'Lead Grupo ZAP'), 120);
  _tel := regexp_replace(coalesce(_lead->>'ddd', '') || coalesce(_lead->>'phone', ''), '[^0-9]', '', 'g');
  IF _tel !~ '^[0-9]{10,11}$' THEN _tel := regexp_replace(coalesce(_lead->>'phoneNumber', ''), '[^0-9]', '', 'g'); END IF;
  IF _tel !~ '^[0-9]{8,15}$' THEN _tel := NULL; END IF;
  _mail := lower(btrim(coalesce(_lead->>'email', '')));
  IF char_length(_mail) > 160 OR _mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN _mail := NULL; END IF;
  IF _tel IS NULL AND _mail IS NULL THEN
    INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'sem_contato');
    RETURN jsonb_build_object('r', 'sem_contato');
  END IF;
  _temp := CASE lower(btrim(coalesce(_lead->>'temperature', '')))
             WHEN 'baixa' THEN 'baixa' WHEN 'média' THEN 'media' WHEN 'media' THEN 'media' WHEN 'alta' THEN 'alta' END;
  _tran := CASE upper(btrim(coalesce(_lead->>'transactionType', ''))) WHEN 'SELL' THEN 'venda' WHEN 'RENT' THEN 'aluguel' END;
  _tipo := CASE WHEN _lead->>'leadOrigin' = 'MCMV_OLX' THEN 'MCMV'
                WHEN upper(btrim(coalesce(_x->>'leadType', ''))) ~ '^[A-Z_]{1,40}$' THEN upper(btrim(_x->>'leadType')) END;
  _cap := coalesce(public.lead_portal_captacao(_org, _cli), public.lead_portal_captacao(_org, _por));

  BEGIN
    _id := public.lead_inserir(_org, _nome, _tel, _mail, 'grupo_olx',
             left(public.lead_portal_limpar_mensagem(_lead->>'message'), 4000), _cap, NULL, false, NULL, _ext);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'duplicado');
    RETURN jsonb_build_object('r', 'duplicado');
  END;
  UPDATE public.leads SET anuncio_codigo = _cli, anuncio_portal_id = _por, portal_tipo = _tipo,
         portal_temperatura = _temp, portal_transacao = _tran
   WHERE id = _id;
  PERFORM public.lead_distribuir(_id, NULL, 'grupo zap', NULL);
  INSERT INTO public.lead_portal_recebimentos (organization_id, resultado) VALUES (_org, 'ok');
  RETURN jsonb_build_object('r', 'ok');
END $$;
REVOKE ALL ON FUNCTION public.lead_grupo_olx_receber(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_grupo_olx_receber(text, jsonb) TO service_role;

-- 8) Tela de configuração (gestor/admin): gerar token novo ou desligar ----------------------------------
-- 'gerar' devolve o token em claro UMA vez (o banco só guarda o hash); o token anterior para na hora.
-- 'desligar' apaga o hash: o Canal Pro passa a receber 401 até gerar outro.
CREATE OR REPLACE FUNCTION public.lead_grupo_olx_token(_acao text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _tok text;
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador configura o Grupo ZAP' USING ERRCODE = '42501';
  END IF;
  IF _acao IS NULL OR _acao NOT IN ('gerar', 'desligar') THEN
    RAISE EXCEPTION 'Acao invalida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  IF _acao = 'gerar' THEN
    _tok := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  END IF;
  UPDATE public.lead_config
     SET grupo_olx_token_hash = CASE WHEN _tok IS NULL THEN NULL ELSE encode(extensions.digest(_tok, 'sha256'), 'hex') END,
         grupo_olx_token_em = CASE WHEN _tok IS NULL THEN NULL ELSE now() END, updated_at = now()
   WHERE organization_id = _org;
  RETURN _tok;
END $$;
REVOKE ALL ON FUNCTION public.lead_grupo_olx_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_grupo_olx_token(text) TO authenticated, service_role;

COMMIT;
