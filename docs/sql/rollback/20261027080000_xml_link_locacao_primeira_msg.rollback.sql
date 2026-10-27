-- Rollback de 20261027080000_xml_link_locacao_primeira_msg.sql (card t_25fe1197).
-- ORDEM: (1) rollback de 20261027090000 (parecido), que usa as colunas novas; (2) publicar o servidor
-- antigo (o novo manda negocio/preco_aluguel, que a ingestão antiga ignora sem erro); (3) este arquivo.
-- Restaura as funções exatamente como estão em produção hoje (cópia lida em 27/10/2026), apaga as
-- linhas de LOCAÇÃO (antes não existiam), limpa os links não-remax.com.br do modo genérico, remove as
-- funções/gatilho novos e as colunas. O nome padrão da IA volta para 'Assistente virtual'.
BEGIN;
DROP TRIGGER IF EXISTS zz_lead_ia_primeira_atualizar ON public.leads;
DROP FUNCTION IF EXISTS public.lead_ia_primeira_atualizar();

CREATE OR REPLACE FUNCTION public.remax_xml_ingest(_org uuid, _listings jsonb, _total integer, _started timestamptz,
  _modo text DEFAULT 'remax')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _run uuid := gen_random_uuid(); _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _prev public.remax_xml_runs%ROWTYPE; _n int; _coord int; _gen boolean := _modo = 'generico';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN RAISE EXCEPTION 'Imobiliária inexistente'; END IF;
  IF jsonb_typeof(_listings) <> 'array' THEN RAISE EXCEPTION 'Formato inválido'; END IF;
  IF _modo IS NULL OR _modo NOT IN ('remax', 'generico') THEN RAISE EXCEPTION 'Modo inválido'; END IF;
  DROP TABLE IF EXISTS pg_temp._x;
  CREATE TEMP TABLE _x ON COMMIT DROP AS
  SELECT DISTINCT ON (public.portal_code_key(i.code)) i.*
    FROM jsonb_to_recordset(_listings) AS i(code text, tipo text, rua text, numero text, bairro text, cidade text,
      cep text, lat double precision, lon double precision, area numeric, quartos int, banheiros int, vagas int,
      preco numeric, url text, escritorio text, corretor_nome text, corretor_email text, corretor_telefone text,
      titulo text, condominio numeric, iptu numeric, iptu_periodo text, suites int, fotos_qtd int,
      area_util numeric, area_terreno numeric)
   WHERE CASE WHEN _gen THEN btrim(i.code) ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$'
              ELSE i.code ~ '^[0-9]{9}-[0-9]{1,6}$' END
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
    titulo, condominio, iptu, iptu_periodo, suites, fotos_qtd, area_util, area_terreno,
    first_seen, last_seen, last_run)
  SELECT _org, btrim(code), CASE WHEN _gen THEN NULL ELSE substr(code, 1, 9) END, left(tipo, 60), left(rua, 200),
    left(numero, 20), left(bairro, 120), left(cidade, 120), left(cep, 12),
    CASE WHEN lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND NOT (lat = 0 AND lon = 0) THEN lat END,
    CASE WHEN lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND NOT (lat = 0 AND lon = 0) THEN lon END,
    CASE WHEN area > 0 AND area < 1e9 THEN area END, CASE WHEN quartos BETWEEN 0 AND 99 THEN quartos END,
    CASE WHEN banheiros BETWEEN 0 AND 99 THEN banheiros END, CASE WHEN vagas BETWEEN 0 AND 99 THEN vagas END,
    CASE WHEN preco >= 0 AND preco < 1e12 THEN preco END,
    CASE WHEN url ~ '^https?://(www\.)?remax\.com\.br/' THEN left(url, 300) END,
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
    last_seen = EXCLUDED.last_seen, last_run = EXCLUDED.last_run;
  -- dado pessoal não fica guardado sem uso: anúncio fora do XML há mais de 60 dias é apagado
  DELETE FROM public.remax_xml_listings WHERE organization_id = _org AND last_seen < _hoje - 60;
  INSERT INTO public.remax_xml_runs (id, organization_id, status, total, venda, com_coord, started_at)
  VALUES (_run, _org, 'ok', _total, _n, _coord, _started);
  RETURN jsonb_build_object('status', 'ok', 'venda', _n, 'com_coord', _coord);
END $$;

CREATE OR REPLACE FUNCTION public.feedback_xml_base()
RETURNS TABLE(code text, code_key text, agent_id text, broker_id uuid, corretor_xml text, tipo text,
  bairro text, cidade text, preco numeric, url text, coleta timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _run public.remax_xml_runs%ROWTYPE;
  _admin boolean; _lead boolean;
BEGIN
  IF NOT public.remax_xml_can_read() THEN RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501'; END IF;
  IF NOT coalesce(public.owner_feedback_enabled(), false) THEN RETURN; END IF;
  _run := public.remax_xml_last_ok(_org);
  IF _run.id IS NULL THEN RETURN; END IF;
  _admin := public.has_any_role(_uid, ARRAY['admin','super_admin']::public.app_role[]);
  _lead := public.has_any_role(_uid, ARRAY['gestor','team_leader']::public.app_role[]);
  RETURN QUERY
  SELECT l.code, l.code_key, l.agent_id, m.profile_id,
         CASE WHEN _admin AND m.profile_id IS NULL THEN nullif(btrim(l.corretor_nome), '') END,
         l.tipo, l.bairro, l.cidade, l.preco, l.url, _run.finished_at
    FROM public.remax_xml_listings l
    LEFT JOIN public.remax_xml_broker_match(_org) m ON m.agent_id = l.agent_id
   WHERE l.organization_id = _org AND l.last_run = _run.id
     AND (_admin OR m.profile_id = _uid
          OR (_lead AND m.profile_id IS NOT NULL AND public.is_lead_of(_uid, m.profile_id)))
   ORDER BY l.code;
END $$;

CREATE OR REPLACE FUNCTION public.mapa_anuncios_xml()
 RETURNS TABLE (code text, url text, transacao text, tipo text, rua text, bairro text, cidade text,
  lat double precision, lon double precision, area numeric, quartos smallint, preco numeric,
  exclusivo boolean, corretor text, capture_id uuid, coleta timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _org uuid := public.current_org_id();
  _run public.remax_xml_runs%ROWTYPE;
BEGIN
  IF _uid IS NULL OR _org IS NULL OR NOT coalesce(public.mt_1b_gate(), false)
     OR NOT coalesce(public.exclusive_actor_active(_uid), false)
     OR NOT coalesce(public.has_any_role(_uid,
       ARRAY['corretor','team_leader','gestor','admin','super_admin']::public.app_role[]), false) THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(public.exclusive_capture_enabled(), false) THEN RETURN; END IF;
  IF NOT coalesce((SELECT o.mapa_site_enabled FROM public.organizations o WHERE o.id = _org), true) THEN RETURN; END IF;
  _run := public.remax_xml_last_ok(_org);
  IF _run.id IS NULL THEN RETURN; END IF;  -- sem XML bom: a tela usa mapa_anuncios_site
  RETURN QUERY
  SELECT l.code, l.url, 'venda'::text, l.tipo,
         nullif(btrim(l.rua), ''), nullif(btrim(l.bairro), ''), nullif(btrim(l.cidade), ''),
         l.lat, l.lon, l.area, l.quartos, l.preco, coalesce(s.exclusivo, false),
         coalesce(p.nome, nullif(btrim(l.corretor_nome), '')),
         CASE WHEN k.capture_id IS NOT NULL AND coalesce(public.exclusive_can_view(k.capture_id, _uid), false)
              THEN k.capture_id END,
         _run.finished_at
    FROM public.remax_xml_listings l
    LEFT JOIN public.remax_site_listings s ON s.organization_id = l.organization_id AND s.code_key = l.code_key
    LEFT JOIN LATERAL (
      SELECT nullif(btrim(u.nome), '') AS nome FROM public.profiles u
       WHERE u.organization_id = l.organization_id AND u.remax_id = l.agent_id AND u.ativo
       ORDER BY u.nome LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT x.capture_id FROM public.exclusive_listing_links x
        JOIN public.exclusive_captures c ON c.id = x.capture_id AND c.organization_id = x.organization_id
       WHERE x.organization_id = l.organization_id AND x.code_key = l.code_key
         AND x.status IN ('ativo', 'aguardando_gestor')
         AND c.discarded_at IS NULL AND c.archived_at IS NULL
       ORDER BY (x.status = 'ativo') DESC
       LIMIT 1
    ) k ON true
   WHERE l.organization_id = _org AND l.last_run = _run.id
   ORDER BY l.code;
END $function$;

CREATE OR REPLACE FUNCTION public.lead_ia_ficha_xml(_org uuid, _codigo text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'tipo', public.lead_ia_tipo(l.tipo),
    'bairro', left(nullif(btrim(l.bairro), ''), 60),
    'cidade', left(nullif(btrim(l.cidade), ''), 60),
    'quartos', l.quartos::text,
    'suites', l.suites::text,
    'banheiros', l.banheiros::text,
    'vagas', l.vagas::text,
    'area_util_m2', public.lead_ia_num(l.area_util),
    'area_terreno_m2', public.lead_ia_num(l.area_terreno),
    'condominio', public.lead_ia_reais(l.condominio),
    'iptu', public.lead_ia_reais(l.iptu) || CASE l.iptu_periodo WHEN 'mensal' THEN ' por mês' WHEN 'anual' THEN ' por ano' ELSE '' END))
    FROM public.remax_xml_listings l
   WHERE _org IS NOT NULL AND char_length(btrim(coalesce(_codigo, ''))) BETWEEN 1 AND 60
     AND l.organization_id = _org
     AND l.code_key = public.portal_code_key(btrim(_codigo))
     AND l.last_run = (public.remax_xml_last_ok(_org)).id
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.lead_ia_primeira_msg(_l public.leads, _c public.lead_config, _org_nome text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _t text; _nome text; _imovel text;
BEGIN
  _t := coalesce(nullif(btrim(_c.ia_primeira_msg), ''),
    'Oi, {nome}! Aqui é a {assistente}, assistente virtual da {imobiliaria}. Vi seu interesse {imovel}. Quer saber valores e condições, ou já prefere agendar uma visita?');
  -- Lead sem nome (ex.: "Lead Grupo ZAP"): "Oi!" em vez de "Oi, !".
  _nome := CASE WHEN btrim(_l.nome) ~* '^lead( grupo zap)?$' THEN '' ELSE split_part(btrim(_l.nome), ' ', 1) END;
  IF _nome = '' THEN _t := regexp_replace(_t, ',?\s*\{nome\}', '', 'g'); END IF;
  IF _l.capture_id IS NOT NULL THEN _imovel := public.lead_ia_imovel_frase(_l.capture_id, _l.organization_id, 'em'); END IF;
  _t := replace(_t, '{nome}', _nome);
  _t := replace(_t, '{assistente}', btrim(_c.ia_nome));
  _t := replace(_t, '{imobiliaria}', coalesce(_org_nome, 'imobiliária'));
  _t := replace(_t, '{imovel}', coalesce(_imovel, 'no imóvel que você viu'));
  RETURN left(btrim(regexp_replace(_t, '\s+', ' ', 'g')), 2000);
END $$;

REVOKE ALL ON FUNCTION public.remax_xml_ingest(uuid, jsonb, integer, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remax_xml_ingest(uuid, jsonb, integer, timestamptz, text) TO service_role;

-- Dados: locação e links que a versão antiga nunca gravaria.
DELETE FROM public.remax_xml_listings WHERE negocio <> 'venda';
UPDATE public.remax_xml_listings SET url = NULL
 WHERE url IS NOT NULL AND url !~ '^https?://(www\.)?remax\.com\.br/';

DROP FUNCTION IF EXISTS public.lead_ia_xml_frase_msg(public.remax_xml_listings, text);
DROP FUNCTION IF EXISTS public.lead_ia_reais_curto(numeric);
DROP FUNCTION IF EXISTS public.xml_url_host(text);
DROP FUNCTION IF EXISTS public.xml_url_anuncio_ok(text);
ALTER TABLE public.remax_xml_listings DROP COLUMN IF EXISTS preco_aluguel, DROP COLUMN IF EXISTS negocio;
ALTER TABLE public.lead_config ALTER COLUMN ia_nome SET DEFAULT 'Assistente virtual';
COMMIT;
