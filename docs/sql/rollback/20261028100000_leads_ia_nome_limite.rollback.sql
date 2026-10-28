-- Rollback de 20261028100000_leads_ia_nome_limite.sql (t_228659f0): volta remax_xml_ingest e
-- lead_ia_retorno_receber aos corpos de produção de 28/10 e remove a busca por nome e a coluna busca_texto.
-- Depois, apagar a linha 20261028100000 de supabase_migrations.schema_migrations (se tiver sido registrada).
BEGIN;

DROP FUNCTION IF EXISTS public.lead_ia_imoveis_nome(uuid, text, text, text[], integer);

CREATE OR REPLACE FUNCTION public.remax_xml_ingest(_org uuid, _listings jsonb, _total integer, _started timestamp with time zone, _modo text DEFAULT 'remax'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _run uuid := gen_random_uuid(); _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _prev public.remax_xml_runs%ROWTYPE; _n int; _nv int; _coord int; _gen boolean := _modo = 'generico'; _host text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN RAISE EXCEPTION 'Imobiliária inexistente'; END IF;
  IF jsonb_typeof(_listings) <> 'array' THEN RAISE EXCEPTION 'Formato inválido'; END IF;
  IF _modo IS NULL OR _modo NOT IN ('remax', 'generico') THEN RAISE EXCEPTION 'Modo inválido'; END IF;
  DROP TABLE IF EXISTS pg_temp._x;
  CREATE TEMP TABLE _x ON COMMIT DROP AS
  SELECT DISTINCT ON (public.portal_code_key(i.code)) i.*,
         CASE WHEN _gen AND i.negocio IN ('locacao', 'venda_locacao') THEN i.negocio ELSE 'venda' END AS neg
    FROM jsonb_to_recordset(_listings) AS i(code text, tipo text, rua text, numero text, bairro text, cidade text,
      cep text, lat double precision, lon double precision, area numeric, quartos int, banheiros int, vagas int,
      preco numeric, url text, escritorio text, corretor_nome text, corretor_email text, corretor_telefone text,
      titulo text, condominio numeric, iptu numeric, iptu_periodo text, suites int, fotos_qtd int,
      area_util numeric, area_terreno numeric, negocio text, preco_aluguel numeric)
   WHERE CASE WHEN _gen THEN btrim(i.code) ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$'
              ELSE i.code ~ '^[0-9]{9}-[0-9]{1,6}$' END
   ORDER BY public.portal_code_key(i.code), (CASE WHEN _gen AND i.negocio IN ('locacao', 'venda_locacao') THEN i.negocio ELSE 'venda' END) = 'venda' DESC, i.code;
  -- Contagens da coleta: SÓ venda (como antes; a locação não existia aqui).
  SELECT count(*), count(*) FILTER (WHERE neg = 'venda'),
         count(*) FILTER (WHERE neg = 'venda' AND lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND NOT (lat = 0 AND lon = 0))
    INTO _n, _nv, _coord FROM _x;
  _prev := public.remax_xml_last_ok(_org);
  IF _n = 0 OR (_prev.id IS NOT NULL AND _prev.venda >= 20 AND _nv < _prev.venda / 2) THEN
    INSERT INTO public.remax_xml_runs (organization_id, status, total, venda, com_coord, message, started_at)
    VALUES (_org, 'rejeitado', _total, _nv, _coord, format('XML com %s imóveis de venda (antes: %s). Versão anterior mantida.',
      _nv, coalesce(_prev.venda, 0)), _started);
    RETURN jsonb_build_object('status', 'rejeitado', 'venda', _nv, 'antes', _prev.venda);
  END IF;
  -- Genérico: o link só fica se for seguro E do domínio que o próprio feed mais usa (o site da imobiliária).
  IF _gen THEN
    SELECT public.xml_url_host(url) INTO _host FROM _x WHERE public.xml_url_anuncio_ok(url)
     GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1;
  END IF;
  INSERT INTO public.remax_xml_listings AS t (organization_id, code, agent_id, tipo, rua, numero, bairro, cidade, cep,
    lat, lon, area, quartos, banheiros, vagas, preco, url, escritorio, corretor_nome, corretor_email, corretor_telefone,
    titulo, condominio, iptu, iptu_periodo, suites, fotos_qtd, area_util, area_terreno, negocio, preco_aluguel,
    first_seen, last_seen, last_run)
  SELECT _org, btrim(code), CASE WHEN _gen THEN NULL ELSE substr(code, 1, 9) END, left(tipo, 60), left(rua, 200),
    left(numero, 20), left(bairro, 120), left(cidade, 120), left(cep, 12),
    CASE WHEN lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND NOT (lat = 0 AND lon = 0) THEN lat END,
    CASE WHEN lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND NOT (lat = 0 AND lon = 0) THEN lon END,
    CASE WHEN area > 0 AND area < 1e9 THEN area END, CASE WHEN quartos BETWEEN 0 AND 99 THEN quartos END,
    CASE WHEN banheiros BETWEEN 0 AND 99 THEN banheiros END, CASE WHEN vagas BETWEEN 0 AND 99 THEN vagas END,
    CASE WHEN preco >= 0 AND preco < 1e12 THEN preco END,
    CASE WHEN _gen THEN CASE WHEN public.xml_url_anuncio_ok(url) AND public.xml_url_host(url) = _host THEN url END
         WHEN url ~ '^https?://(www\.)?remax\.com\.br/' THEN left(url, 300) END,
    -- Modo genérico: nenhum contato é guardado, mesmo que venha no JSON.
    CASE WHEN _gen THEN NULL ELSE left(escritorio, 120) END,
    CASE WHEN _gen THEN NULL ELSE left(btrim(corretor_nome), 160) END,
    CASE WHEN _gen THEN NULL ELSE left(lower(btrim(corretor_email)), 200) END,
    CASE WHEN _gen THEN NULL ELSE left(corretor_telefone, 30) END,
    CASE WHEN _gen AND titulo !~* '(https?:|www\.|@|[0-9]{4,5}-?[0-9]{4})' THEN left(btrim(titulo), 200) END,
    CASE WHEN _gen AND condominio >= 0 AND condominio < 1e7 THEN condominio END,
    CASE WHEN _gen AND iptu >= 0 AND iptu < 1e8 THEN iptu END,
    CASE WHEN _gen AND iptu_periodo IN ('mensal', 'anual') THEN iptu_periodo END,
    CASE WHEN _gen AND suites BETWEEN 0 AND 99 THEN suites END,
    CASE WHEN _gen AND fotos_qtd BETWEEN 0 AND 999 THEN fotos_qtd END,
    CASE WHEN _gen AND area_util > 0 AND area_util < 1e9 THEN area_util END,
    CASE WHEN _gen AND area_terreno > 0 AND area_terreno < 1e9 THEN area_terreno END,
    neg,
    CASE WHEN _gen AND preco_aluguel > 0 AND preco_aluguel < 1e9 THEN preco_aluguel END,
    _hoje, _hoje, _run
    FROM _x
  ON CONFLICT (organization_id, code_key) DO UPDATE SET code = EXCLUDED.code, agent_id = EXCLUDED.agent_id,
    tipo = EXCLUDED.tipo, rua = EXCLUDED.rua, numero = EXCLUDED.numero, bairro = EXCLUDED.bairro,
    cidade = EXCLUDED.cidade, cep = EXCLUDED.cep, lat = EXCLUDED.lat, lon = EXCLUDED.lon, area = EXCLUDED.area,
    quartos = EXCLUDED.quartos, banheiros = EXCLUDED.banheiros, vagas = EXCLUDED.vagas, preco = EXCLUDED.preco,
    url = EXCLUDED.url, escritorio = EXCLUDED.escritorio, corretor_nome = EXCLUDED.corretor_nome,
    corretor_email = EXCLUDED.corretor_email, corretor_telefone = EXCLUDED.corretor_telefone,
    titulo = EXCLUDED.titulo, condominio = EXCLUDED.condominio, iptu = EXCLUDED.iptu,
    iptu_periodo = EXCLUDED.iptu_periodo, suites = EXCLUDED.suites, fotos_qtd = EXCLUDED.fotos_qtd,
    area_util = EXCLUDED.area_util, area_terreno = EXCLUDED.area_terreno,
    negocio = EXCLUDED.negocio, preco_aluguel = EXCLUDED.preco_aluguel,
    last_seen = EXCLUDED.last_seen, last_run = EXCLUDED.last_run;
  -- dado pessoal não fica guardado sem uso: anúncio fora do XML há mais de 60 dias é apagado
  DELETE FROM public.remax_xml_listings WHERE organization_id = _org AND last_seen < _hoje - 60;
  INSERT INTO public.remax_xml_runs (id, organization_id, status, total, venda, com_coord, started_at)
  VALUES (_run, _org, 'ok', _total, _nv, _coord, _started);
  RETURN jsonb_build_object('status', 'ok', 'venda', _nv, 'locacao', _n - _nv, 'com_coord', _coord);
END $function$;

CREATE OR REPLACE FUNCTION public.lead_ia_retorno_receber(_token text, _msg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;

ALTER TABLE public.remax_xml_listings DROP COLUMN IF EXISTS busca_texto;

COMMIT;
