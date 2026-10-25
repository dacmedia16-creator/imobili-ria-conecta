-- Leads — IA de atendimento: RETORNO ZionTalk -> ADM (a Emanuella responde no WhatsApp) + escolha do modelo
-- (Gemini padrão, OpenRouter opcional) + registro de uso por conversa. Card t_6f688b4b, "sim constrói o
-- retorno" e "vamos de OpenRouter", Denis 25/10/2026, tópico 6238. Base: 20261025180000 + 20261025190000.
--
-- ADITIVA. Rollback: docs/sql/rollback/20261025200000_leads_ia_retorno_ziontalk.rollback.sql
--
-- Regras:
--  1) A ZionTalk faz POST em /api/leads/ziontalk/<token>. O token identifica a imobiliária; o banco guarda
--     SÓ o hash SHA-256 (lead_config.ia_retorno_token_hash). Token inválido -> nada é gravado.
--  2) Recusa SEM gravar quando: módulo leads desligado, IA desligada, canal da imobiliária <> 'ziontalk'.
--  3) Grupo, status, mensagem do próprio número e mensagem vazia: ignorados, sem gravar.
--  4) Deduplicação pelo id da mensagem da ZionTalk (hash por imobiliária, UNIQUE): reenvio = 'duplicado',
--     nenhuma resposta nova.
--  5) Só contatos da LISTA de liberados (ia_envio_allowlist) entram na conversa. Fora da lista: só o registro
--     mínimo do evento (hash do id + resultado), sem telefone e sem texto.
--  6) Número desconhecido (sem lead/conversa na imobiliária): só o registro mínimo; não cria lead, não responde.
--  7) A mensagem do cliente segue o fluxo já publicado (lead_ia_registrar_cliente: SAIR no banco, conta como
--     interação, trava de conversa longa). Limites de resposta: por conversa (total), 2 por minuto na
--     conversa e N por minuto na imobiliária.
--  8) Modelo: 'gemini' (padrão) ou 'openrouter' + id do modelo; gestor/admin escolhe na tela. Uso (modelo,
--     tokens, custo estimado) registrado por conversa, SEM conteúdo.
BEGIN;

-- 1) Configuração -----------------------------------------------------------------------------------
ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS ia_retorno_token_hash text
    CONSTRAINT lead_config_ia_retorno_hash_check CHECK (ia_retorno_token_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS ia_retorno_token_em timestamptz,
  -- Número do próprio canal (sem o 55), para nunca responder a si mesmo. Só a plataforma define.
  ADD COLUMN IF NOT EXISTS ia_canal_numero text
    CONSTRAINT lead_config_ia_canal_numero_check CHECK (ia_canal_numero ~ '^[0-9]{10,11}$'),
  ADD COLUMN IF NOT EXISTS ia_resp_max_conversa integer NOT NULL DEFAULT 20
    CONSTRAINT lead_config_ia_resp_max_conversa_check CHECK (ia_resp_max_conversa BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS ia_resp_max_minuto integer NOT NULL DEFAULT 6
    CONSTRAINT lead_config_ia_resp_max_minuto_check CHECK (ia_resp_max_minuto BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS ia_modelo_provedor text NOT NULL DEFAULT 'gemini'
    CONSTRAINT lead_config_ia_modelo_provedor_check CHECK (ia_modelo_provedor IN ('gemini', 'openrouter')),
  ADD COLUMN IF NOT EXISTS ia_modelo text
    CONSTRAINT lead_config_ia_modelo_check CHECK (ia_modelo ~ '^[a-z0-9][a-z0-9._-]{0,40}/[a-z0-9][a-z0-9._:-]{0,80}$');
CREATE UNIQUE INDEX IF NOT EXISTS lead_config_ia_retorno_hash_uniq ON public.lead_config (ia_retorno_token_hash)
  WHERE ia_retorno_token_hash IS NOT NULL;
-- A tela lê só: quando o retorno foi ligado e o modelo escolhido. Hash, número do canal e limites: só o servidor.
GRANT SELECT (ia_retorno_token_em, ia_modelo_provedor, ia_modelo) ON public.lead_config TO authenticated;

-- 2) Eventos do retorno (dedup + auditoria mínima, sem telefone e sem texto) ---------------------------
CREATE TABLE IF NOT EXISTS public.lead_ia_retorno_eventos (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  externo_hash text NOT NULL CHECK (externo_hash ~ '^[0-9a-f]{64}$'),
  resultado text NOT NULL CHECK (resultado IN ('recebido', 'ok', 'fora_lista', 'desconhecido', 'limite_minuto')),
  conversa_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_ia_retorno_eventos_uniq UNIQUE (organization_id, externo_hash)
);
CREATE INDEX IF NOT EXISTS lead_ia_retorno_eventos_org_idx ON public.lead_ia_retorno_eventos (organization_id, created_at);

-- 3) Uso dos modelos (para comparar depois). Sem conteúdo. ------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_ia_uso (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversa_id uuid,
  provedor text NOT NULL CHECK (provedor IN ('gemini', 'openrouter')),
  modelo text NOT NULL CHECK (char_length(modelo) BETWEEN 1 AND 120),
  ok boolean NOT NULL,
  fallback boolean NOT NULL DEFAULT false, -- true = esta chamada foi o plano B (o modelo escolhido falhou)
  erro text CHECK (char_length(erro) <= 40),
  tokens_entrada integer CHECK (tokens_entrada >= 0),
  tokens_saida integer CHECK (tokens_saida >= 0),
  custo_usd numeric(12, 8) CHECK (custo_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_ia_uso_org_idx ON public.lead_ia_uso (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_ia_uso_conversa_idx ON public.lead_ia_uso (conversa_id);

ALTER TABLE public.lead_ia_retorno_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_ia_uso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_ia_retorno_eventos, public.lead_ia_uso FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_ia_retorno_eventos, public.lead_ia_uso TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.lead_ia_retorno_eventos_id_seq, public.lead_ia_uso_id_seq TO service_role;
-- Uso dos modelos: gestor/admin da própria imobiliária lê (comparação de custo). Eventos: só o servidor.
GRANT SELECT ON public.lead_ia_uso TO authenticated;
CREATE POLICY org_isolation ON public.lead_ia_uso AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()));
CREATE POLICY zz_mt_modulo_leads ON public.lead_ia_uso AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.leads_enabled()));
CREATE POLICY lead_ia_uso_read ON public.lead_ia_uso FOR SELECT TO authenticated
  USING ((SELECT public.leads_gestor()));

-- 4) Recepção (só o servidor do ADM, service_role) --------------------------------------------------
-- _msg já normalizado pelo adaptador ZionTalk (src/lib/leads-ia-retorno.server.ts):
--   {id, telefone, texto, tipo: 'texto'|'midia', grupo, status, proprio}
-- Devolve {"r": token | desligada | invalido | ignorado | duplicado | fora_lista | desconhecido | ok, ...}.
CREATE OR REPLACE FUNCTION public.lead_ia_retorno_receber(_token text, _msg jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.lead_config; _ok boolean; _id text; _chave text; _tipo text; _texto text;
  _cv public.lead_conversas; _ctx jsonb; _ev bigint; _n integer;
BEGIN
  -- Token primeiro: nada é gravado antes disso.
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{40,64}$' THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT * INTO _c FROM public.lead_config
   WHERE ia_retorno_token_hash = encode(extensions.digest(_token, 'sha256'), 'hex');
  IF _c.organization_id IS NULL THEN RETURN jsonb_build_object('r', 'token'); END IF;
  SELECT (m.enabled AND o.status = 'ativa') INTO _ok FROM public.organization_modules m
    JOIN public.organizations o ON o.id = m.organization_id
   WHERE m.organization_id = _c.organization_id AND m.module = 'leads';
  IF NOT coalesce(_ok, false) OR NOT _c.ia_ativa OR _c.ia_canal <> 'ziontalk' THEN
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
     OR (SELECT count(*) FROM public.lead_mensagens WHERE organization_id = _c.organization_id
        AND autor IN ('ia', 'sistema') AND created_at > now() - interval '1 minute') >= _c.ia_resp_max_minuto THEN
    UPDATE public.lead_ia_retorno_eventos SET resultado = 'limite_minuto' WHERE id = _ev;
    RETURN jsonb_build_object('r', 'ok', 'responder', false, 'lead_id', _cv.lead_id, 'limite', true);
  END IF;
  RETURN jsonb_build_object('r', 'ok', 'responder', true, 'lead_id', _cv.lead_id, 'tipo', _tipo,
    'organization_id', _c.organization_id, 'ia_modelo_provedor', _c.ia_modelo_provedor, 'ia_modelo', _c.ia_modelo,
    'ctx', _ctx);
END $$;

-- Número do próprio canal (a IA nunca responde a ele). Só a plataforma.
CREATE OR REPLACE FUNCTION public.lead_ia_canal_numero_definir(_org uuid, _tel text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  UPDATE public.lead_config SET ia_canal_numero = (public.lead_ia_contatos(_tel, NULL))[1], updated_at = now()
   WHERE organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.lead_ia_retorno_receber(text, jsonb), public.lead_ia_canal_numero_definir(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_retorno_receber(text, jsonb), public.lead_ia_canal_numero_definir(uuid, text)
  TO service_role;

-- 5) Tela de configuração ---------------------------------------------------------------------------
-- Token do retorno (só administrador, como a config da IA). 'gerar' devolve o token em claro UMA vez;
-- o anterior para na hora. 'desligar' apaga o hash: a ZionTalk passa a receber 401.
CREATE OR REPLACE FUNCTION public.lead_ia_retorno_token(_acao text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _tok text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador configura o retorno do WhatsApp' USING ERRCODE = '42501';
  END IF;
  IF _acao IS NULL OR _acao NOT IN ('gerar', 'desligar') THEN
    RAISE EXCEPTION 'Acao invalida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  IF _acao = 'gerar' THEN
    _tok := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  END IF;
  UPDATE public.lead_config
     SET ia_retorno_token_hash = CASE WHEN _tok IS NULL THEN NULL ELSE encode(extensions.digest(_tok, 'sha256'), 'hex') END,
         ia_retorno_token_em = CASE WHEN _tok IS NULL THEN NULL ELSE now() END, updated_at = now()
   WHERE organization_id = _org;
  RETURN _tok;
END $$;

-- Modelo da IA (gestor ou administrador). Trocar não exige deploy. OpenRouter só funciona com a chave
-- OPENROUTER_API_KEY no servidor; sem ela (ou se falhar), a IA usa o Gemini e depois as regras.
CREATE OR REPLACE FUNCTION public.lead_ia_modelo_salvar(_provedor text, _modelo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _m text := nullif(lower(btrim(coalesce(_modelo, ''))), '');
BEGIN
  IF NOT public.leads_gestor() THEN
    RAISE EXCEPTION 'Apenas gestor ou administrador escolhe o modelo' USING ERRCODE = '42501';
  END IF;
  IF _provedor IS NULL OR _provedor NOT IN ('gemini', 'openrouter')
     OR (_provedor = 'openrouter' AND (_m IS NULL OR _m !~ '^[a-z0-9][a-z0-9._-]{0,40}/[a-z0-9][a-z0-9._:-]{0,80}$')) THEN
    RAISE EXCEPTION 'Modelo invalido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.lead_config SET ia_modelo_provedor = _provedor,
         ia_modelo = CASE WHEN _provedor = 'openrouter' THEN _m END, updated_at = now()
   WHERE organization_id = _org;
END $$;

REVOKE ALL ON FUNCTION public.lead_ia_retorno_token(text), public.lead_ia_modelo_salvar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_ia_retorno_token(text), public.lead_ia_modelo_salvar(text, text)
  TO authenticated, service_role;

COMMIT;
