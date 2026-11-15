-- Nicole: "Aquecer leads parados" por chip ZionTalk SEPARADO (t_a2cae373, decisões de Denis em 15/11/2026, tópico 6238).
-- Recontata leads sem conversa há N dias (padrão 30) para saber se ainda procuram imóvel. Respondeu sim -> a Nicole
-- retoma a conversa normal (parecidos, visita, passagem ao corretor). Não -> registra o motivo e encerra. SAIR -> opt-out.
-- Sem resposta -> 1 único lembrete e depois "frio".
--  * Sistema separado da Reativa/Emanuelle e do chip de atendimento: fila de saída própria (lead_aquecer_envios), link
--    de retorno próprio (lead_config.aquecer_retorno_token_hash) e número próprio (aquecer_chip_numero, diferente do
--    ia_canal_numero por CHECK). O servidor só envia de verdade com LEADS_AQUECER_ENVIO_REAL=on +
--    ZIONTALK_LEADS_AQUECER_API_KEY + LEADS_AQUECER_CHIP_NUMERO igual ao número cadastrado na imobiliária.
--    Sem isso é modo teste (nada sai). Nunca usa o chip de atendimento.
--  * Nasce DESLIGADO em todas as imobiliárias (aquecer_ativo = false). Só administrador liga, na tela.
--  * Freios: limite diário por chip com rampa (começa em aquecer_rampa_inicio e sobe aquecer_rampa_passo por dia até
--    aquecer_limite_dia), intervalo aleatório entre envios, horário comercial (seg-sáb 9h-19h; domingo só com ia_domingo),
--    1 envio por imobiliária a cada chamada do pg_cron (5 min). Freio automático: erro de canal (401/403/404) ou taxa
--    de falha/opt-out acima de aquecer_freio_taxa pausa sozinho e registra o motivo (lead_aquecer_pausas).
--  * Nada é agendado aqui: o servidor chama dentro da rota /api/leads/reengajar (o pg_cron já chama a cada 5 min).
-- Rollback: docs/sql/rollback/20261125120000_leads_aquecer.rollback.sql
BEGIN;

-- 1) Configuração por imobiliária ----------------------------------------------------------------------------------
ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS aquecer_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aquecer_dias integer NOT NULL DEFAULT 30
    CONSTRAINT lead_config_aquecer_dias_check CHECK (aquecer_dias BETWEEN 7 AND 365),
  ADD COLUMN IF NOT EXISTS aquecer_limite_dia integer NOT NULL DEFAULT 15
    CONSTRAINT lead_config_aquecer_limite_dia_check CHECK (aquecer_limite_dia BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS aquecer_rampa_inicio integer NOT NULL DEFAULT 5
    CONSTRAINT lead_config_aquecer_rampa_inicio_check CHECK (aquecer_rampa_inicio BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS aquecer_rampa_passo integer NOT NULL DEFAULT 2
    CONSTRAINT lead_config_aquecer_rampa_passo_check CHECK (aquecer_rampa_passo BETWEEN 0 AND 20),
  ADD COLUMN IF NOT EXISTS aquecer_rampa_desde date,
  ADD COLUMN IF NOT EXISTS aquecer_intervalo_min_s integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS aquecer_intervalo_max_s integer NOT NULL DEFAULT 900,
  ADD COLUMN IF NOT EXISTS aquecer_lembrete_dias integer NOT NULL DEFAULT 3
    CONSTRAINT lead_config_aquecer_lembrete_dias_check CHECK (aquecer_lembrete_dias BETWEEN 1 AND 14),
  ADD COLUMN IF NOT EXISTS aquecer_freio_taxa numeric(4,2) NOT NULL DEFAULT 0.20
    CONSTRAINT lead_config_aquecer_freio_taxa_check CHECK (aquecer_freio_taxa BETWEEN 0.05 AND 0.50),
  ADD COLUMN IF NOT EXISTS aquecer_freio_min integer NOT NULL DEFAULT 5
    CONSTRAINT lead_config_aquecer_freio_min_check CHECK (aquecer_freio_min BETWEEN 3 AND 50),
  ADD COLUMN IF NOT EXISTS aquecer_pausado_em timestamptz,
  ADD COLUMN IF NOT EXISTS aquecer_pausa_motivo text
    CONSTRAINT lead_config_aquecer_pausa_motivo_check CHECK (char_length(aquecer_pausa_motivo) <= 200),
  ADD COLUMN IF NOT EXISTS aquecer_proximo_em timestamptz,
  ADD COLUMN IF NOT EXISTS aquecer_chip_numero text
    CONSTRAINT lead_config_aquecer_chip_numero_check CHECK (aquecer_chip_numero ~ '^[0-9]{10,11}$'),
  ADD COLUMN IF NOT EXISTS aquecer_retorno_token_hash text
    CONSTRAINT lead_config_aquecer_retorno_hash_check CHECK (aquecer_retorno_token_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS aquecer_retorno_token_em timestamptz;
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_aquecer_intervalo_check;
ALTER TABLE public.lead_config ADD CONSTRAINT lead_config_aquecer_intervalo_check
  CHECK (aquecer_intervalo_min_s BETWEEN 120 AND 3600 AND aquecer_intervalo_max_s BETWEEN aquecer_intervalo_min_s AND 7200);
-- O chip do aquecimento nunca é o chip de atendimento da Nicole (se um cair, o outro segue).
ALTER TABLE public.lead_config DROP CONSTRAINT IF EXISTS lead_config_aquecer_chip_separado;
ALTER TABLE public.lead_config ADD CONSTRAINT lead_config_aquecer_chip_separado
  CHECK (aquecer_chip_numero IS NULL OR aquecer_chip_numero IS DISTINCT FROM ia_canal_numero);
CREATE UNIQUE INDEX IF NOT EXISTS lead_config_aquecer_hash_uniq ON public.lead_config (aquecer_retorno_token_hash)
  WHERE aquecer_retorno_token_hash IS NOT NULL;
-- A tela lê tudo por lead_aquecer_config() (número mascarado); nenhuma coluna nova é liberada ao navegador.

-- 2) Tabelas (só o servidor grava; a tela lê por funções) ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_aquecer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  conversa_id uuid,
  estado text NOT NULL DEFAULT 'enviando'
    CHECK (estado IN ('enviando', 'enviado', 'lembrete', 'retomado', 'nao', 'optout', 'frio', 'falhou')),
  modo_real boolean NOT NULL,           -- false = modo teste (nada saiu do ADM)
  chip_numero text CHECK (chip_numero ~ '^[0-9]{10,11}$'),
  motivo text CHECK (motivo IN ('ja_comprou', 'desistiu', 'sem_interesse')),
  enviado_em timestamptz,
  lembrete_em timestamptz,
  respondeu_em timestamptz,
  retomado_em timestamptz,
  finalizado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_aquecer_lead_org_fk FOREIGN KEY (lead_id, organization_id)
    REFERENCES public.leads(id, organization_id) ON DELETE CASCADE
);
-- 1 aquecimento aberto por lead.
CREATE UNIQUE INDEX IF NOT EXISTS lead_aquecer_aberto_uniq ON public.lead_aquecer (lead_id)
  WHERE estado IN ('enviando', 'enviado', 'lembrete');
CREATE INDEX IF NOT EXISTS lead_aquecer_lead_idx ON public.lead_aquecer (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_aquecer_org_idx ON public.lead_aquecer (organization_id, estado, created_at DESC);

CREATE TABLE IF NOT EXISTS public.lead_aquecer_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  aquecer_id uuid NOT NULL REFERENCES public.lead_aquecer(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('primeira', 'lembrete')),
  texto text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 600),
  modo_real boolean NOT NULL,
  chip_numero text CHECK (chip_numero ~ '^[0-9]{10,11}$'),
  status text NOT NULL DEFAULT 'enviando' CHECK (status IN ('enviando', 'enviada', 'teste', 'falhou')),
  erro text CHECK (erro ~ '^[a-z0-9_]{1,40}$'), -- só o código (nunca corpo da resposta)
  created_at timestamptz NOT NULL DEFAULT now(),
  resultado_em timestamptz
);
CREATE INDEX IF NOT EXISTS lead_aquecer_envios_org_idx ON public.lead_aquecer_envios (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_aquecer_envios_chip_idx ON public.lead_aquecer_envios (chip_numero, created_at DESC) WHERE modo_real;
CREATE INDEX IF NOT EXISTS lead_aquecer_envios_aquecer_idx ON public.lead_aquecer_envios (aquecer_id);

CREATE TABLE IF NOT EXISTS public.lead_aquecer_pausas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  motivo text NOT NULL CHECK (char_length(motivo) BETWEEN 1 AND 200),
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detalhe) = 'object' AND pg_column_size(detalhe) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  retomada_em timestamptz,
  retomada_por uuid
);
CREATE INDEX IF NOT EXISTS lead_aquecer_pausas_org_idx ON public.lead_aquecer_pausas (organization_id, created_at DESC);

ALTER TABLE public.lead_aquecer ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_aquecer_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_aquecer_pausas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_aquecer, public.lead_aquecer_envios, public.lead_aquecer_pausas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.lead_aquecer, public.lead_aquecer_envios, public.lead_aquecer_pausas TO service_role;

-- 3) Regras puras --------------------------------------------------------------------------------------------------
-- Horário comercial do aquecimento: seg-sáb 9h-19h de Brasília; domingo só com ia_domingo. shortcut: sem feriados.
CREATE OR REPLACE FUNCTION public.lead_aquecer_horario(_domingo boolean, _agora timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT extract(hour FROM (_agora AT TIME ZONE 'America/Sao_Paulo')) BETWEEN 9 AND 18
     AND (extract(isodow FROM (_agora AT TIME ZONE 'America/Sao_Paulo')) <> 7 OR coalesce(_domingo, false))
$$;

-- Limite do dia com rampa: começa em rampa_inicio e sobe rampa_passo por dia desde rampa_desde, até limite_dia.
CREATE OR REPLACE FUNCTION public.lead_aquecer_limite_hoje(_c public.lead_config, _agora timestamptz)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT least(_c.aquecer_limite_dia,
               _c.aquecer_rampa_inicio + _c.aquecer_rampa_passo
                 * greatest(0, coalesce((_agora AT TIME ZONE 'America/Sao_Paulo')::date - _c.aquecer_rampa_desde, 0)))
$$;

-- Tentativas de hoje (dia de Brasília): da imobiliária e, se for chip real, de todas as imobiliárias no mesmo chip.
CREATE OR REPLACE FUNCTION public.lead_aquecer_enviados_hoje(_org uuid, _chip text, _agora timestamptz)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT count(*)::integer FROM public.lead_aquecer_envios e
   WHERE (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date = (_agora AT TIME ZONE 'America/Sao_Paulo')::date
     AND (e.organization_id = _org OR (_chip IS NOT NULL AND e.modo_real AND e.chip_numero = _chip))
$$;

-- Último sinal de conversa/interação com o lead (mensagens da conversa, ações da equipe, aceite, interação registrada).
CREATE OR REPLACE FUNCTION public.lead_aquecer_ultima_interacao(_l public.leads)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT greatest(_l.created_at, _l.ultima_interacao_em, _l.aceito_em,
    (SELECT max(m.created_at) FROM public.lead_mensagens m JOIN public.lead_conversas cv ON cv.id = m.conversa_id
      WHERE cv.lead_id = _l.id AND cv.organization_id = _l.organization_id),
    (SELECT max(e.created_at) FROM public.lead_eventos e WHERE e.lead_id = _l.id AND e.autor_id IS NOT NULL))
$$;

-- Já teve contato com a imobiliária: corretor aceitou/interagiu, a Nicole falou de verdade ou a equipe registrou algo.
CREATE OR REPLACE FUNCTION public.lead_aquecer_teve_contato(_l public.leads)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _l.aceito_em IS NOT NULL OR _l.ultima_interacao_em IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.lead_conversas cv WHERE cv.lead_id = _l.id AND cv.primeira_enviada_em IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = _l.id AND e.autor_id IS NOT NULL
                  AND e.tipo IN ('nota', 'ligacao', 'etapa', 'aceite', 'proximo_contato'))
$$;

-- O lead pode ser aquecido agora? (regra única; a tela conta com ela e o preparo confere de novo)
CREATE OR REPLACE FUNCTION public.lead_aquecer_elegivel(_l public.leads, _dias integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _ct text[] := public.lead_ia_contatos(_l.telefone, _l.email);
BEGIN
  IF _l.id IS NULL OR _l.simulado OR _l.etapa IN ('ganho', 'perdido') OR _l.sale_id IS NOT NULL
     OR _l.funil <> 'venda' OR (_l.proximo_contato_em IS NOT NULL AND _l.proximo_contato_em > now()) THEN
    RETURN false;
  END IF;
  -- Telefone válido (celular/fixo BR com DDD).
  IF coalesce((public.lead_ia_contatos(_l.telefone, NULL))[1], '') !~ '^[0-9]{10,11}$' THEN RETURN false; END IF;
  -- Nunca quem pediu para sair (telefone ou e-mail, em qualquer lead da imobiliária).
  IF EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = _l.organization_id AND op.contato = ANY (_ct)) THEN
    RETURN false;
  END IF;
  IF NOT public.lead_aquecer_teve_contato(_l) THEN RETURN false; END IF;
  IF public.lead_aquecer_ultima_interacao(_l) > now() - make_interval(days => _dias) THEN RETURN false; END IF;
  -- Nada aberto e nenhum aquecimento real nos últimos 90 dias para este contato (em qualquer lead da imobiliária);
  -- simulação (modo teste) segura o mesmo contato por 7 dias.
  IF EXISTS (SELECT 1 FROM public.lead_aquecer a JOIN public.leads l2 ON l2.id = a.lead_id
              WHERE a.organization_id = _l.organization_id
                AND (a.lead_id = _l.id OR public.lead_ia_contatos(l2.telefone, l2.email) && _ct)
                AND (a.estado IN ('enviando', 'enviado', 'lembrete')
                     OR (a.modo_real AND a.created_at > now() - interval '90 days')
                     OR (NOT a.modo_real AND a.created_at > now() - interval '7 days'))) THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;

-- Classifica a 1ª resposta ao aquecimento: optout | nao | sim | outro ("outro" = a Nicole retoma e entende na conversa).
CREATE OR REPLACE FUNCTION public.lead_aquecer_resposta_tipo(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE
    WHEN public.lead_ia_e_optout(_t) THEN 'optout'
    WHEN n ~ '(ja (comprei|compramos|comprou|aluguei|alugamos|achei|encontrei|encontramos|fechei|fechamos|consegui|resolvi|resolvemos)|nao (estou|to|tou|esta|estamos) (mais )?procurando|nao procuro mais|nao (estou|to) mais (procurando|buscando)|desisti|desistimos|nao (tenho|temos) mais interesse|sem interesse|nao preciso mais|nao quero mais|nao tenho interesse)' THEN 'nao'
    WHEN n ~ '(^|\W)(sim|ainda (estou|to|tou|procuro|busco|quero|tenho)|estou procurando|to procurando|tou procurando|procurando sim|quero sim|tenho interesse|claro|com certeza|pode ser|quero ver|bora)(\W|$)' THEN 'sim'
    WHEN n ~ '^\s*(nao|n|nop|nope|negativo)[\s,.!]*(obrigad[oa]|valeu|vlw|obg)?[\s.!]*$' THEN 'nao'
    ELSE 'outro' END
  FROM (SELECT public.lead_ia_norm(coalesce(_t, '')) AS n) x
$$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_motivo_nao(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE
    WHEN n ~ 'ja (comprei|compramos|comprou|aluguei|alugamos|achei|encontrei|encontramos|fechei|fechamos|consegui)' THEN 'ja_comprou'
    WHEN n ~ '(desisti|desistimos|nao procuro mais|nao preciso mais|nao (estou|to|tou|esta|estamos) (mais )?procurando|nao (estou|to) mais)' THEN 'desistiu'
    ELSE 'sem_interesse' END
  FROM (SELECT public.lead_ia_norm(coalesce(_t, '')) AS n) x
$$;

-- Texto curto e humano, variado entre leads (semente = id do lead). Sem preço, sem link, sem promessa; termina em pergunta.
CREATE OR REPLACE FUNCTION public.lead_aquecer_texto(_tipo text, _nome text, _frase text, _ia text, _org text, _semente text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _h integer := abs(hashtext(coalesce(_semente, ''))); _n text := CASE WHEN coalesce(_nome, '') = '' THEN '' ELSE ', ' || _nome END;
  _a text; _q text; _ab text[]; _qs text[] := ARRAY['Ainda está procurando imóvel?', 'Você segue procurando um imóvel?',
    'Ainda faz sentido eu te ajudar a encontrar um imóvel?'];
  _sair text := ' (Se não quiser mais mensagens, responda SAIR.)';
BEGIN
  IF _tipo = 'lembrete' THEN
    RETURN (ARRAY[
      format('Oi%s! Passando só para saber: ainda está procurando imóvel? Pode me responder com um sim ou não.', _n),
      format('Oi%s, tudo bem? Só confirmando se ainda posso te ajudar a encontrar um imóvel. É só responder sim ou não.', _n)
    ])[1 + _h % 2] || _sair;
  END IF;
  _ab := ARRAY[
    format('Oi%s! Aqui é %s, da %s. Você chegou a ver %s com a gente há um tempo.', _n, _ia, _org, coalesce(_frase, 'um imóvel')),
    format('Olá%s, tudo bem? Aqui é %s, da %s. Faz um tempinho que você viu %s com a gente.', _n, _ia, _org, coalesce(_frase, 'um imóvel')),
    format('Oi%s, tudo certo? %s aqui, da %s. Lembrei de você, que viu %s com a gente.', _n, _ia, _org, coalesce(_frase, 'um imóvel'))];
  IF _frase IS NOT NULL THEN
    _ab := _ab || format('Oi%s! Sou %s, da %s. Um tempo atrás você se interessou por um imóvel nosso: %s.', _n, _ia, _org, _frase);
  END IF;
  _a := _ab[1 + _h % cardinality(_ab)];
  _q := _qs[1 + (_h / 7) % cardinality(_qs)];
  RETURN _a || ' ' || _q || _sair;
END $$;

-- Trava do texto (o banco confere): sem link, sem R$ e sem número fora do nome da imobiliária.
CREATE OR REPLACE FUNCTION public.lead_aquecer_texto_ok(_t text, _org text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT char_length(coalesce(_t, '')) BETWEEN 40 AND 600
     AND _t !~* '(h[t]tps?://|www\.|[a-z0-9-]+\.(com|net|org|br|me|ly|io|app|site|link)(\M|/)|r\$)'
     AND replace(_t, coalesce(_org, ''), '') !~ '[[:digit:]０-９]'
     AND right(btrim(replace(_t, ' (Se não quiser mais mensagens, responda SAIR.)', '')), 1) = '?'
$$;

-- Frase do imóvel que a pessoa viu (XML da própria imobiliária > captação). NULL = texto sem imóvel.
CREATE OR REPLACE FUNCTION public.lead_aquecer_frase(_l public.leads)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _fx jsonb; _cap uuid;
BEGIN
  IF nullif(btrim(coalesce(_l.anuncio_codigo, '')), '') IS NOT NULL THEN
    _fx := public.lead_ia_ficha_xml(_l.organization_id, _l.anuncio_codigo);
    IF _fx IS NOT NULL AND _fx <> '{}'::jsonb THEN RETURN public.lead_ia_frase(_fx->>'tipo', _fx->>'bairro', 'def'); END IF;
  END IF;
  _cap := public.lead_ia_captacao(_l, '{}'::jsonb);
  RETURN CASE WHEN _cap IS NOT NULL THEN public.lead_ia_imovel_frase(_cap, _l.organization_id, 'def') END;
END $$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_nome(_nome text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN btrim(coalesce(_nome, '')) ~* '^lead( grupo zap)?$' OR p = '' OR p ~ '[0-9@/:]' OR char_length(p) > 30
              THEN '' ELSE p END
  FROM (SELECT split_part(btrim(coalesce(_nome, '')), ' ', 1) AS p) x
$$;

-- 4) Freio automático ----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_aquecer_pausar_interno(_org uuid, _motivo text, _detalhe jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _g record;
BEGIN
  UPDATE public.lead_config SET aquecer_pausado_em = now(), aquecer_pausa_motivo = left(_motivo, 200), updated_at = now()
   WHERE organization_id = _org AND aquecer_pausado_em IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.lead_aquecer_pausas (organization_id, motivo, detalhe) VALUES (_org, left(_motivo, 200), coalesce(_detalhe, '{}'::jsonb));
  FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
             WHERE r.organization_id = _org AND r.role::text IN ('admin', 'super_admin') LOOP
    INSERT INTO public.notifications (user_id, organization_id, tipo, titulo, mensagem)
    VALUES (_g.user_id, _org, 'lead', 'Aquecimento de leads pausado',
            left('O aquecimento de leads parados foi pausado automaticamente (' || _motivo || '). Confira em Leads > Configurar.', 500));
  END LOOP;
  RETURN true;
END $$;

-- Confere as taxas da janela e pausa se passar do limite. _chip NULL = só a imobiliária (modo teste).
CREATE OR REPLACE FUNCTION public.lead_aquecer_freio(_org uuid, _chip text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
END $$;

-- 5) Preparo: no máximo 1 envio por imobiliária por chamada -------------------------------------------------------
-- _chip = número do chip configurado no servidor (LEADS_AQUECER_CHIP_NUMERO) quando o envio real está ligado; NULL =
-- modo teste. Só imobiliária com aquecer_chip_numero = _chip recebe envio real; as demais seguem em modo teste.
-- _agora: só para o horário e o dia do limite (o teste confere as bordas sem depender da hora em que roda).
CREATE OR REPLACE FUNCTION public.lead_aquecer_preparar(_chip text DEFAULT NULL, _agora timestamptz DEFAULT now())
RETURNS TABLE (envio_id uuid, lead_id uuid, telefone text, texto text, modo_real boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
END $$;

-- 6) Resultado do envio: grava na conversa do lead, avança o estado e aplica o freio ---------------------------------
-- _status: enviada (HTTP 201) | teste (nada saiu) | falhou (_erro = código, ex.: http_403, timeout).
CREATE OR REPLACE FUNCTION public.lead_aquecer_resultado(_envio uuid, _status text, _erro text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
END $$;

-- 7) Retorno pelo chip do aquecimento (POST /api/leads/aquecer/<token>) -----------------------------------------------
-- Mesmo formato de resposta do lead_ia_retorno_receber: o servidor reaproveita o mesmo handler e a mesma Nicole.
-- A mensagem cai na MESMA conversa do lead (lead_conversas é única por lead).
CREATE OR REPLACE FUNCTION public.lead_aquecer_retorno_receber(_token text, _msg jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
END $$;

-- 8) Por qual chip saem as mensagens do lead? (o servidor pergunta antes de cada envio pendente) --------------------
-- aquecer = conversa retomada pelo aquecimento real (sai pelo chip do aquecimento); aquecer_teste = retomada em modo
-- teste (nada sai); atendimento = fluxo normal da Nicole.
-- Regra ÚNICA (usada também por lead_ia_status_saida, lead_ia_envio_reservar e lead_aquecer_envio_reservar): vale o
-- aquecimento MAIS RECENTE do lead, retomado há no máximo 30 dias. Depois disso o lead volta ao fluxo normal.
CREATE OR REPLACE FUNCTION public.lead_aquecer_chip_do_lead(_lead uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT CASE WHEN a.estado = 'retomado' AND a.retomado_em > now() - interval '30 days'
                               THEN CASE WHEN a.modo_real THEN 'aquecer' ELSE 'aquecer_teste' END END
                     FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id AND l.organization_id = a.organization_id
                    WHERE a.lead_id = _lead AND a.enviado_em IS NOT NULL
                    ORDER BY a.created_at DESC LIMIT 1), 'atendimento')
$$;

-- Reserva de envio do CHIP DO AQUECIMENTO (espelho de lead_ia_envio_reservar, mas só para lead retomado pelo
-- aquecimento real, no MESMO chip que mandou a 1ª mensagem, com o aquecimento ligado e sem pausa).
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
END $$;

-- Leads retomados pelo aquecimento REAL com mensagem pendente (respostas da Nicole, lembretes): o servidor envia pelo
-- chip do aquecimento na rodada do pg_cron. As rotinas do chip de atendimento pulam estes leads (lead_aquecer_chip_do_lead).
CREATE OR REPLACE FUNCTION public.lead_aquecer_pendentes(_chip text)
RETURNS TABLE (lead_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
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
$$;

-- lead_ia_liberado (lista de liberados do chip de atendimento) NÃO muda. A separação dos chips fica nas 2 funções que
-- decidem a saída, com a MESMA regra (lead_aquecer_chip_do_lead):
--  * lead_ia_status_saida: resposta da Nicole a lead retomado pelo aquecimento real fica "pendente" (sai pelo chip do
--    aquecimento); retomado em modo teste fica "não enviada"; os demais seguem igual à versão no ar.
--  * lead_ia_envio_reservar (chip de atendimento: respostas, botão "Enviar" do gestor, lembretes): recusa todo lead
--    que não seja 'atendimento'. Trava no banco, vale para qualquer caminho do servidor.
-- Versões no ar (md5 conferido igual em produção e homologação em 15/11): restauradas pelo rollback.
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

CREATE OR REPLACE FUNCTION public.lead_ia_envio_reservar(_lead uuid)
 RETURNS TABLE(msg_id uuid, telefone text, texto text, primeira boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _m public.lead_mensagens; _hoje integer;
BEGIN
  -- t_a2cae373: lead do chip do aquecimento nunca sai pelo chip de atendimento (sem fallback).
  IF public.lead_aquecer_chip_do_lead(_lead) <> 'atendimento' THEN RETURN; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _lead FOR UPDATE;
  SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _lead FOR UPDATE;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _l.organization_id;
  IF _l.id IS NULL OR _cv.id IS NULL OR _c.organization_id IS NULL THEN RETURN; END IF;
  IF NOT _c.ia_ativa OR _c.ia_canal <> 'ziontalk' OR _cv.canal <> 'ziontalk' OR _l.simulado
     OR NOT public.lead_ia_liberado(_c, _l)
     OR NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE organization_id = _l.organization_id
                     AND module = 'leads' AND enabled)
     OR EXISTS (SELECT 1 FROM public.lead_ia_optouts WHERE organization_id = _l.organization_id
                 AND contato = ANY (public.lead_ia_contatos(_l.telefone, _l.email))
                 AND _cv.estado <> 'optout') THEN
    RETURN;
  END IF;
  SELECT * INTO _m FROM public.lead_mensagens WHERE conversa_id = _cv.id AND status = 'pendente'
   ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF _m.id IS NULL THEN RETURN; END IF;
  IF _cv.primeira_enviada_em IS NULL THEN
    SELECT count(*) INTO _hoje FROM public.lead_conversas
     WHERE organization_id = _cv.organization_id AND primeira_enviada_em IS NOT NULL
       AND (primeira_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date;
    IF _hoje >= _c.ia_envio_limite_dia THEN RETURN; END IF;
  END IF;
  UPDATE public.lead_mensagens SET status = 'enviando' WHERE id = _m.id;
  msg_id := _m.id; telefone := _l.telefone; texto := _m.texto; primeira := _cv.primeira_enviada_em IS NULL;
  RETURN NEXT;
END $function$;

-- Falha de envio de resposta pelo chip do aquecimento: erro de canal pausa todas as imobiliárias do chip (freio).
CREATE OR REPLACE FUNCTION public.lead_aquecer_falha_canal(_chip text, _erro text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
END $$;

-- 9) Tela (Leads > Configurar) ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_aquecer_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_salvar(_ativo boolean, _dias integer, _limite_dia integer,
  _rampa_inicio integer, _rampa_passo integer, _lembrete_dias integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _antes boolean;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador altera a configuracao' USING ERRCODE = '42501';
  END IF;
  IF _ativo IS NULL OR _dias IS NULL OR _limite_dia IS NULL OR _rampa_inicio IS NULL OR _rampa_passo IS NULL OR _lembrete_dias IS NULL
     OR _rampa_inicio > _limite_dia THEN
    RAISE EXCEPTION 'Configuracao do aquecimento invalida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  SELECT aquecer_ativo INTO _antes FROM public.lead_config WHERE organization_id = _org FOR UPDATE;
  UPDATE public.lead_config
     SET aquecer_ativo = _ativo, aquecer_dias = _dias, aquecer_limite_dia = _limite_dia,
         aquecer_rampa_inicio = _rampa_inicio, aquecer_rampa_passo = _rampa_passo, aquecer_lembrete_dias = _lembrete_dias,
         -- Ligar (de desligado) recomeça a rampa no dia de hoje.
         aquecer_rampa_desde = CASE WHEN _ativo AND NOT coalesce(_antes, false) THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date
                                    ELSE aquecer_rampa_desde END,
         updated_at = now()
   WHERE organization_id = _org;
END $$;

-- Pausar/retomar à mão. Retomar recomeça a rampa (protege o chip depois de uma pausa).
CREATE OR REPLACE FUNCTION public.lead_aquecer_pausar(_pausar boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx();
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Apenas administrador altera a configuracao' USING ERRCODE = '42501';
  END IF;
  IF _pausar IS NULL THEN RAISE EXCEPTION 'Acao invalida' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.lead_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  IF _pausar THEN
    PERFORM public.lead_aquecer_pausar_interno(_org, 'pausa manual', jsonb_build_object('por', auth.uid()));
  ELSE
    UPDATE public.lead_aquecer_pausas SET retomada_em = now(), retomada_por = auth.uid()
     WHERE organization_id = _org AND retomada_em IS NULL;
    UPDATE public.lead_config SET aquecer_pausado_em = NULL, aquecer_pausa_motivo = NULL,
           aquecer_rampa_desde = (now() AT TIME ZONE 'America/Sao_Paulo')::date, updated_at = now()
     WHERE organization_id = _org;
  END IF;
END $$;

-- Link do retorno do chip do aquecimento (só administrador). 'gerar' devolve o token UMA vez; o banco guarda o hash.
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
  RETURN _tok;
END $$;

-- Prévia: exemplos com nomes e imóvel fictícios (nenhum dado de cliente sai para a tela).
CREATE OR REPLACE FUNCTION public.lead_aquecer_previa()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _ia text; _o text;
BEGIN
  IF NOT public.leads_gestor() THEN RAISE EXCEPTION 'Apenas gestor ou administrador' USING ERRCODE = '42501'; END IF;
  _ia := coalesce((SELECT nullif(btrim(ia_nome), '') FROM public.lead_config WHERE organization_id = _org), 'Nicole');
  _o := public.lead_ia_org_nome(_org);
  RETURN jsonb_build_array(
    public.lead_aquecer_texto('primeira', 'Maria', 'o apartamento do bairro Centro', _ia, _o, 'exemplo-1'),
    public.lead_aquecer_texto('primeira', 'João', 'a casa do bairro Jardim Europa', _ia, _o, 'exemplo-22'),
    public.lead_aquecer_texto('primeira', '', NULL, _ia, _o, 'exemplo-3'),
    public.lead_aquecer_texto('lembrete', 'Maria', NULL, _ia, _o, 'exemplo-1'));
END $$;

CREATE OR REPLACE FUNCTION public.lead_aquecer_painel(_dias integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.lead_ctx(); _desde timestamptz; _r jsonb;
BEGIN
  IF NOT public.leads_gestor() THEN RAISE EXCEPTION 'Apenas gestor ou administrador' USING ERRCODE = '42501'; END IF;
  IF _dias IS NULL OR _dias NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Periodo invalido' USING ERRCODE = '22023'; END IF;
  _desde := now() - make_interval(days => _dias);
  SELECT jsonb_build_object(
    'dias', _dias,
    'enviados', (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.organization_id = _org AND e.tipo = 'primeira'
                  AND e.status IN ('enviada', 'teste') AND e.created_at >= _desde),
    'enviados_teste', (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.organization_id = _org AND e.tipo = 'primeira'
                  AND e.status = 'teste' AND e.created_at >= _desde),
    'lembretes', (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.organization_id = _org AND e.tipo = 'lembrete'
                  AND e.status IN ('enviada', 'teste') AND e.created_at >= _desde),
    'falhas', (SELECT count(*) FROM public.lead_aquecer_envios e WHERE e.organization_id = _org AND e.status = 'falhou'
                  AND e.created_at >= _desde),
    'responderam', count(*) FILTER (WHERE a.respondeu_em IS NOT NULL),
    'voltaram', count(*) FILTER (WHERE a.estado = 'retomado'),
    'visitas', count(*) FILTER (WHERE a.estado = 'retomado' AND (l.etapa = 'visita_agendada' OR cv.motivo_fim = 'visita'
                 OR EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = a.lead_id AND e.tipo = 'ia' AND e.para = 'visita'
                             AND e.created_at >= a.retomado_em))),
    'nao', count(*) FILTER (WHERE a.estado = 'nao'),
    'optouts', count(*) FILTER (WHERE a.estado = 'optout'),
    'frios', count(*) FILTER (WHERE a.estado = 'frio'),
    'aguardando', count(*) FILTER (WHERE a.estado IN ('enviando', 'enviado', 'lembrete')),
    'pausas', (SELECT count(*) FROM public.lead_aquecer_pausas p WHERE p.organization_id = _org AND p.created_at >= _desde),
    'ultima_pausa', (SELECT jsonb_build_object('motivo', p.motivo, 'em', p.created_at, 'retomada_em', p.retomada_em)
                       FROM public.lead_aquecer_pausas p WHERE p.organization_id = _org ORDER BY p.created_at DESC LIMIT 1))
    INTO _r
    FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id
    LEFT JOIN public.lead_conversas cv ON cv.id = a.conversa_id
   WHERE a.organization_id = _org AND a.created_at >= _desde AND a.enviado_em IS NOT NULL;
  RETURN _r;
END $$;

-- Cadastro do número do chip do aquecimento: só a plataforma (service_role), como o número do chip de atendimento.
CREATE OR REPLACE FUNCTION public.lead_aquecer_chip_definir(_org uuid, _tel text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  UPDATE public.lead_config SET aquecer_chip_numero = (public.lead_ia_contatos(_tel, NULL))[1], updated_at = now()
   WHERE organization_id = _org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002'; END IF;
END $$;

-- 10) Permissões --------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.lead_aquecer_horario(boolean, timestamptz), public.lead_aquecer_limite_hoje(public.lead_config, timestamptz),
  public.lead_aquecer_enviados_hoje(uuid, text, timestamptz), public.lead_aquecer_ultima_interacao(public.leads),
  public.lead_aquecer_teve_contato(public.leads), public.lead_aquecer_elegivel(public.leads, integer),
  public.lead_aquecer_resposta_tipo(text), public.lead_aquecer_motivo_nao(text),
  public.lead_aquecer_texto(text, text, text, text, text, text), public.lead_aquecer_texto_ok(text, text),
  public.lead_aquecer_frase(public.leads), public.lead_aquecer_nome(text),
  public.lead_aquecer_pausar_interno(uuid, text, jsonb), public.lead_aquecer_freio(uuid, text),
  public.lead_aquecer_preparar(text, timestamptz), public.lead_aquecer_resultado(uuid, text, text),
  public.lead_aquecer_retorno_receber(text, jsonb), public.lead_aquecer_chip_do_lead(uuid), public.lead_aquecer_pendentes(text),
  public.lead_aquecer_chip_definir(uuid, text), public.lead_aquecer_envio_reservar(uuid, text),
  public.lead_aquecer_falha_canal(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_aquecer_preparar(text, timestamptz), public.lead_aquecer_resultado(uuid, text, text),
  public.lead_aquecer_retorno_receber(text, jsonb), public.lead_aquecer_chip_do_lead(uuid), public.lead_aquecer_pendentes(text),
  public.lead_aquecer_chip_definir(uuid, text), public.lead_aquecer_envio_reservar(uuid, text),
  public.lead_aquecer_falha_canal(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.lead_aquecer_config(), public.lead_aquecer_salvar(boolean, integer, integer, integer, integer, integer),
  public.lead_aquecer_pausar(boolean), public.lead_aquecer_retorno_token(text), public.lead_aquecer_previa(),
  public.lead_aquecer_painel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_aquecer_config(), public.lead_aquecer_salvar(boolean, integer, integer, integer, integer, integer),
  public.lead_aquecer_pausar(boolean), public.lead_aquecer_retorno_token(text), public.lead_aquecer_previa(),
  public.lead_aquecer_painel(integer) TO authenticated, service_role;

COMMIT;
