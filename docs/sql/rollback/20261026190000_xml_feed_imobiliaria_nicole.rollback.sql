-- Rollback de 20261026190000_xml_feed_imobiliaria_nicole (card t_76243950).
-- Volta ao estado da 20261026170000 (roteiro da Nicole só com a captação) e da 20261016200000 (XML só RE/MAX).
-- Perde: os links de XML cadastrados na tela e os imóveis do modo genérico (linhas com agent_id vazio).
-- ANTES de rodar, publique de novo o servidor anterior (a task xml-feed-collect chama remax_xml_ingest com _modo).
-- O XML da Única Escolha (REMAX_XML_FEEDS, modo RE/MAX) não é afetado.
BEGIN;

-- 5) Nicole volta a usar só a captação (texto igual ao da 20261026170000).
CREATE OR REPLACE FUNCTION public.lead_ia_imovel_por_codigo(_conversa uuid, _codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid; _cap uuid;
BEGIN
  SELECT organization_id INTO _org FROM public.lead_conversas WHERE id = _conversa;
  IF _org IS NULL OR char_length(btrim(coalesce(_codigo, ''))) NOT BETWEEN 4 AND 60 THEN RETURN NULL; END IF;
  _cap := public.lead_portal_captacao(_org, _codigo);
  IF _cap IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('capture_id', _cap, 'frase', public.lead_ia_imovel_frase(_cap, _org, 'def'),
                            'ficha', public.lead_ia_ficha(_cap, _org));
END $$;

CREATE OR REPLACE FUNCTION public.lead_ia_registrar_cliente(_conversa uuid, _texto text, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _t text := left(btrim(coalesce(_texto, '')), 1000);
  _n integer; _outra uuid; _cap uuid; _org text;
BEGIN
  IF char_length(_t) = 0 THEN RAISE EXCEPTION 'Mensagem vazia' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa FOR UPDATE;
  IF _cv.id IS NULL THEN RAISE EXCEPTION 'Conversa nao encontrada' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id;
  SELECT * INTO _c FROM public.lead_config WHERE organization_id = _cv.organization_id;
  INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
  VALUES (_cv.organization_id, _cv.id, 'cliente', _t, _status);
  UPDATE public.lead_conversas SET versao = versao + 1, updated_at = now() WHERE id = _cv.id
  RETURNING * INTO _cv;
  PERFORM public.lead_ia_tocar(_l.id);

  IF public.lead_ia_e_optout(_t) THEN
    INSERT INTO public.lead_ia_optouts (organization_id, contato)
    SELECT _cv.organization_id, x FROM unnest(public.lead_ia_contatos(_l.telefone, _l.email)) x
    ON CONFLICT DO NOTHING;
    FOR _outra IN SELECT cv.id FROM public.lead_conversas cv JOIN public.leads l2 ON l2.id = cv.lead_id
                   WHERE cv.organization_id = _cv.organization_id AND cv.id <> _cv.id AND cv.estado = 'ativa'
                     AND public.lead_ia_contatos(l2.telefone, l2.email) && public.lead_ia_contatos(_l.telefone, _l.email) LOOP
      PERFORM public.lead_ia_passar(_outra, 'optout', 'Este contato pediu para não receber mais mensagens (SAIR) em outro lead.');
    END LOOP;
    IF _cv.estado = 'ativa' THEN
      INSERT INTO public.lead_mensagens (organization_id, conversa_id, autor, texto, status)
      VALUES (_cv.organization_id, _cv.id, 'sistema',
              'Pronto, você não vai mais receber mensagens nossas por aqui. Obrigado!',
              public.lead_ia_status_saida(_cv.id));
      PERFORM public.lead_ia_passar(_cv.id, 'optout', 'Cliente pediu para não receber mais mensagens (SAIR). Não envie mensagens automáticas.');
    END IF;
    RETURN jsonb_build_object('conversa_id', _cv.id, 'estado', 'optout');
  END IF;

  IF _cv.estado <> 'ativa' THEN
    RETURN jsonb_build_object('conversa_id', _cv.id, 'estado', _cv.estado);
  END IF;
  SELECT count(*) INTO _n FROM public.lead_mensagens WHERE conversa_id = _cv.id AND autor = 'cliente';
  IF _n > 30 THEN
    PERFORM public.lead_ia_passar(_cv.id, 'limite', 'Conversa longa: a IA parou e o atendimento segue com você.');
    RETURN jsonb_build_object('conversa_id', _cv.id, 'estado', 'passada');
  END IF;
  _cap := public.lead_ia_captacao(_l, _cv.dados);
  SELECT nome INTO _org FROM public.organizations WHERE id = _cv.organization_id;
  RETURN jsonb_build_object(
    'conversa_id', _cv.id, 'estado', _cv.estado, 'versao', _cv.versao, 'passo', _cv.passo, 'dados', _cv.dados,
    'ia_nome', coalesce(_c.ia_nome, 'Assistente virtual'),
    'lead_nome', split_part(btrim(_l.nome), ' ', 1),
    'imovel', CASE WHEN _l.capture_id IS NOT NULL THEN public.lead_ia_imovel(_l.capture_id, _l.organization_id) END,
    'org_nome', _org,
    'transacao', _l.portal_transacao,
    'anuncio_codigo', _l.anuncio_codigo,
    'tem_captacao', _cap IS NOT NULL,
    'imovel_frase', CASE WHEN _cap IS NOT NULL THEN public.lead_ia_imovel_frase(_cap, _l.organization_id, 'def') END,
    'ficha', CASE WHEN _cap IS NOT NULL THEN public.lead_ia_ficha(_cap, _l.organization_id) END);
END $$;

CREATE OR REPLACE FUNCTION public.lead_ia_imovel_frase(_capture uuid, _org uuid, _forma text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN t IS NULL AND b IS NULL THEN NULL ELSE
    CASE _forma
      WHEN 'em' THEN CASE WHEN fem THEN 'na ' ELSE 'no ' END
      WHEN 'indef' THEN CASE WHEN fem THEN 'uma ' ELSE 'um ' END
      ELSE CASE WHEN fem THEN 'a ' ELSE 'o ' END END
    || coalesce(t, 'imóvel')
    || coalesce(CASE WHEN _forma = 'indef' THEN ' no bairro ' ELSE ' do bairro ' END || b, '') END
  FROM (SELECT public.lead_ia_tipo(c.form_data->'imovel'->>'tipo_imovel') AS t,
               left(nullif(btrim(c.form_data->'imovel'->>'bairro'), ''), 60) AS b,
               public.lead_ia_tipo(c.form_data->'imovel'->>'tipo_imovel') IN ('casa', 'cobertura') AS fem
          FROM public.exclusive_captures c WHERE c.id = _capture AND c.organization_id = _org) x
$$;

DROP FUNCTION IF EXISTS public.lead_ia_ficha_xml(uuid, text);
DROP FUNCTION IF EXISTS public.lead_ia_reais(numeric);
DROP FUNCTION IF EXISTS public.lead_ia_num(numeric);
DROP FUNCTION IF EXISTS public.lead_ia_frase(text, text, text);

-- 3) Ingestão volta a ter 4 argumentos (texto igual ao da 20261016200000).
DROP FUNCTION IF EXISTS public.remax_xml_ingest(uuid, jsonb, integer, timestamptz, text);
CREATE OR REPLACE FUNCTION public.remax_xml_ingest(_org uuid, _listings jsonb, _total integer, _started timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _run uuid := gen_random_uuid(); _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _prev public.remax_xml_runs%ROWTYPE; _n int; _coord int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN RAISE EXCEPTION 'Imobiliária inexistente'; END IF;
  IF jsonb_typeof(_listings) <> 'array' THEN RAISE EXCEPTION 'Formato inválido'; END IF;
  DROP TABLE IF EXISTS pg_temp._x;
  CREATE TEMP TABLE _x ON COMMIT DROP AS
  SELECT DISTINCT ON (public.portal_code_key(i.code)) i.*
    FROM jsonb_to_recordset(_listings) AS i(code text, tipo text, rua text, numero text, bairro text, cidade text,
      cep text, lat double precision, lon double precision, area numeric, quartos int, banheiros int, vagas int,
      preco numeric, url text, escritorio text, corretor_nome text, corretor_email text, corretor_telefone text)
   WHERE i.code ~ '^[0-9]{9}-[0-9]{1,6}$'
   ORDER BY public.portal_code_key(i.code), i.code;
  SELECT count(*), count(*) FILTER (WHERE lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND NOT (lat = 0 AND lon = 0))
    INTO _n, _coord FROM _x;
  _prev := public.remax_xml_last_ok(_org);
  IF _n = 0 OR (_prev.id IS NOT NULL AND _prev.venda >= 20 AND _n < _prev.venda / 2) THEN
    INSERT INTO public.remax_xml_runs (organization_id, status, total, venda, com_coord, message, started_at)
    VALUES (_org, 'rejeitado', _total, _n, _coord, format('XML com %s imóveis de venda (antes: %s). Versão anterior mantida.',
      _n, coalesce(_prev.venda, 0)), _started);
    RETURN jsonb_build_object('status', 'rejeitado', 'venda', _n, 'antes', _prev.venda);
  END IF;
  INSERT INTO public.remax_xml_listings AS t (organization_id, code, agent_id, tipo, rua, numero, bairro, cidade, cep,
    lat, lon, area, quartos, banheiros, vagas, preco, url, escritorio, corretor_nome, corretor_email, corretor_telefone,
    first_seen, last_seen, last_run)
  SELECT _org, code, substr(code, 1, 9), left(tipo, 60), left(rua, 200), left(numero, 20), left(bairro, 120),
    left(cidade, 120), left(cep, 12),
    CASE WHEN lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND NOT (lat = 0 AND lon = 0) THEN lat END,
    CASE WHEN lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND NOT (lat = 0 AND lon = 0) THEN lon END,
    CASE WHEN area > 0 AND area < 1e9 THEN area END, CASE WHEN quartos BETWEEN 0 AND 99 THEN quartos END,
    CASE WHEN banheiros BETWEEN 0 AND 99 THEN banheiros END, CASE WHEN vagas BETWEEN 0 AND 99 THEN vagas END,
    CASE WHEN preco >= 0 AND preco < 1e12 THEN preco END,
    CASE WHEN url ~ '^https?://(www\.)?remax\.com\.br/' THEN left(url, 300) END, left(escritorio, 120),
    left(btrim(corretor_nome), 160), left(lower(btrim(corretor_email)), 200), left(corretor_telefone, 30),
    _hoje, _hoje, _run
    FROM _x
  ON CONFLICT (organization_id, code_key) DO UPDATE SET code = EXCLUDED.code, agent_id = EXCLUDED.agent_id,
    tipo = EXCLUDED.tipo, rua = EXCLUDED.rua, numero = EXCLUDED.numero, bairro = EXCLUDED.bairro,
    cidade = EXCLUDED.cidade, cep = EXCLUDED.cep, lat = EXCLUDED.lat, lon = EXCLUDED.lon, area = EXCLUDED.area,
    quartos = EXCLUDED.quartos, banheiros = EXCLUDED.banheiros, vagas = EXCLUDED.vagas, preco = EXCLUDED.preco,
    url = EXCLUDED.url, escritorio = EXCLUDED.escritorio, corretor_nome = EXCLUDED.corretor_nome,
    corretor_email = EXCLUDED.corretor_email, corretor_telefone = EXCLUDED.corretor_telefone,
    last_seen = EXCLUDED.last_seen, last_run = EXCLUDED.last_run;
  DELETE FROM public.remax_xml_listings WHERE organization_id = _org AND last_seen < _hoje - 60;
  INSERT INTO public.remax_xml_runs (id, organization_id, status, total, venda, com_coord, started_at)
  VALUES (_run, _org, 'ok', _total, _n, _coord, _started);
  RETURN jsonb_build_object('status', 'ok', 'venda', _n, 'com_coord', _coord);
END $$;
REVOKE ALL ON FUNCTION public.remax_xml_ingest(uuid, jsonb, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remax_xml_ingest(uuid, jsonb, integer, timestamptz) TO service_role;

-- 2) Imóveis do modo genérico (sem corretor) saem; colunas novas saem; agent_id volta a ser obrigatório.
DELETE FROM public.remax_xml_listings WHERE agent_id IS NULL;
ALTER TABLE public.remax_xml_listings ALTER COLUMN agent_id SET NOT NULL;
ALTER TABLE public.remax_xml_listings
  DROP COLUMN IF EXISTS titulo, DROP COLUMN IF EXISTS condominio, DROP COLUMN IF EXISTS iptu,
  DROP COLUMN IF EXISTS iptu_periodo, DROP COLUMN IF EXISTS suites, DROP COLUMN IF EXISTS fotos_qtd,
  DROP COLUMN IF EXISTS area_util, DROP COLUMN IF EXISTS area_terreno;

-- 1) Link do XML por imobiliária.
DROP FUNCTION IF EXISTS public.platform_xml_feed_salvar(uuid, text);
DROP TABLE IF EXISTS public.organization_xml_feeds;

COMMIT;
