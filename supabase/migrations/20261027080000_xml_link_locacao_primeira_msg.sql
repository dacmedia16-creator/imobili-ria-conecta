-- Link do anúncio + locação no XML das imobiliárias + 1ª mensagem da Nicole com o imóvel, o valor e o link
-- (card t_25fe1197; teste real de Denis 26/10/2026 com o VIP0040 na ZZ; ajustes de 26 e 27/10, tópico 6238).
-- Aplicar ANTES de 20261027090000 (imóvel parecido), que usa as colunas novas.
--
-- ADITIVA. Rollback: docs/sql/rollback/20261027080000_xml_link_locacao_primeira_msg.rollback.sql
-- O XML da Única Escolha (modo 'remax', segredo REMAX_XML_FEEDS) NÃO muda: mesma regra de link (só remax.com.br),
-- só venda, mesmos contatos de corretor.
--
-- O que muda:
--  1) remax_xml_listings ganha 'negocio' ('venda' padrão | 'locacao' | 'venda_locacao') e 'preco_aluguel'.
--     Linhas existentes = 'venda'. Só o modo genérico grava locação.
--  2) remax_xml_ingest (modo genérico): guarda o link do anúncio (só https com nome, sem usuário/senha, sem porta
--     estranha, até 300 caracteres, e só do domínio que o próprio feed mais usa) e os imóveis de locação.
--     A contagem da coleta (remax_xml_runs.venda/com_coord) e a regra de queda brusca continuam contando SÓ venda.
--  3) Mapa (mapa_anuncios_xml) e Feedback (feedback_xml_base) passam a filtrar negocio = 'venda': mostram
--     exatamente o mesmo conjunto de antes (antes a locação nem era guardada).
--  4) lead_ia_ficha_xml: agora traz negócio, preço (venda), aluguel e link do anúncio. Continua sem
--     disponibilidade, permuta, financiamento e andar.
--  5) 1ª mensagem: "Aqui é a <nome>, da <imobiliária>" (sem "assistente virtual"), o imóvel do XML com tipo,
--     quartos, bairro, cidade e valor, e o link do anúncio (marcador {link}). Sem XML, a captação, como antes.
--     Nome do lead com cara de link nunca entra no texto.
--  6) Quando o código do anúncio chega DEPOIS da criação do lead (Grupo ZAP grava o código num UPDATE logo após
--     o INSERT, que é quando a 1ª mensagem nasce), a 1ª mensagem é remontada, mas só se ainda não saiu.
--  7) Nome padrão da IA para imobiliárias novas: 'Nicole' (antes 'Assistente virtual').
BEGIN;

-- 1) Negócio e aluguel ------------------------------------------------------------------------------------
ALTER TABLE public.remax_xml_listings
  ADD COLUMN IF NOT EXISTS negocio text NOT NULL DEFAULT 'venda'
    CONSTRAINT remax_xml_listings_negocio_check CHECK (negocio IN ('venda', 'locacao', 'venda_locacao')),
  ADD COLUMN IF NOT EXISTS preco_aluguel numeric;

-- Link de anúncio seguro (mesma regra de urlAnuncioSegura em src/lib/remax-xml.ts).
CREATE OR REPLACE FUNCTION public.xml_url_anuncio_ok(_u text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT coalesce(char_length(_u) <= 300
    AND _u ~ '^https://[A-Za-z0-9.-]+(:443)?/[^[:space:]<>"''@\\]*$'
    AND _u !~ '^https://[0-9.]+(:443)?/'
    AND substring(_u from '^https://([A-Za-z0-9.-]+)') ~ '\.', false)
$$;
CREATE OR REPLACE FUNCTION public.xml_url_host(_u text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT regexp_replace(lower(substring(_u from '^https://([A-Za-z0-9.-]+)')), '^www\.', '')
$$;

-- 2) Ingestão (mesma assinatura) --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remax_xml_ingest(_org uuid, _listings jsonb, _total integer, _started timestamptz,
  _modo text DEFAULT 'remax')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
   ORDER BY public.portal_code_key(i.code), i.code;
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
END $$;
REVOKE ALL ON FUNCTION public.remax_xml_ingest(uuid, jsonb, integer, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remax_xml_ingest(uuid, jsonb, integer, timestamptz, text) TO service_role;

-- 3) Telas que usam o XML: continuam só com VENDA (mesmo conjunto de antes) --------------------------------
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
   WHERE l.organization_id = _org AND l.last_run = _run.id AND l.negocio = 'venda'
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
   WHERE l.organization_id = _org AND l.last_run = _run.id AND l.negocio = 'venda'
   ORDER BY l.code;
END $function$;

-- 4) Ficha do XML com valor e link ------------------------------------------------------------------------
-- "R$ 430.000" (sem centavos quando inteiro) para falar com o cliente.
CREATE OR REPLACE FUNCTION public.lead_ia_reais_curto(_v numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN _v IS NULL OR _v <= 0 THEN NULL
              WHEN _v = trunc(_v) THEN 'R$ ' || translate(to_char(_v, 'FM999,999,999,990'), ',', '.')
              ELSE public.lead_ia_reais(_v) END
$$;

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
    'iptu', public.lead_ia_reais(l.iptu) || CASE l.iptu_periodo WHEN 'mensal' THEN ' por mês' WHEN 'anual' THEN ' por ano' ELSE '' END,
    -- t_25fe1197: negócio, valor anunciado (venda e/ou aluguel) e link do anúncio, só se vierem do XML.
    'negocio', l.negocio,
    'preco', CASE WHEN l.negocio <> 'locacao' THEN public.lead_ia_reais_curto(l.preco) END,
    'preco_valor', CASE WHEN l.negocio <> 'locacao' AND l.preco > 0 THEN l.preco END,
    'aluguel', public.lead_ia_reais_curto(l.preco_aluguel),
    'aluguel_valor', CASE WHEN l.preco_aluguel > 0 THEN l.preco_aluguel END,
    'link', CASE WHEN public.xml_url_anuncio_ok(l.url) THEN l.url END))
    FROM public.remax_xml_listings l
   WHERE _org IS NOT NULL AND char_length(btrim(coalesce(_codigo, ''))) BETWEEN 1 AND 60
     AND l.organization_id = _org
     AND l.code_key = public.portal_code_key(btrim(_codigo))
     AND l.last_run = (public.remax_xml_last_ok(_org)).id
   LIMIT 1
$$;

-- 5) 1ª mensagem ------------------------------------------------------------------------------------------
-- "no apartamento de 2 quartos no bairro Jardim São Carlos, em Sorocaba, anunciado por R$ 430.000"
-- Aluguel quando o anúncio é de locação (ou venda e locação com lead de aluguel). Sem disponibilidade,
-- permuta, financiamento nem andar.
CREATE OR REPLACE FUNCTION public.lead_ia_xml_frase_msg(_x public.remax_xml_listings, _transacao text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE _tipo text := public.lead_ia_tipo(_x.tipo); _fem boolean; _alug boolean; _s text;
  _b text := left(nullif(btrim(_x.bairro), ''), 60); _c text := left(nullif(btrim(_x.cidade), ''), 60);
BEGIN
  IF _x.code IS NULL THEN RETURN NULL; END IF;
  _fem := coalesce(_tipo IN ('casa', 'cobertura'), false);
  _alug := _x.negocio = 'locacao' OR (_x.negocio = 'venda_locacao' AND _transacao = 'aluguel');
  _s := CASE WHEN _fem THEN 'na ' ELSE 'no ' END || coalesce(_tipo, 'imóvel')
     || CASE WHEN _x.quartos > 0 AND coalesce(_tipo NOT IN ('terreno', 'imóvel comercial'), true)
             THEN ' de ' || _x.quartos || CASE WHEN _x.quartos = 1 THEN ' quarto' ELSE ' quartos' END ELSE '' END
     || coalesce(' no bairro ' || _b, '') || coalesce(', em ' || _c, '');
  IF _alug AND _x.preco_aluguel > 0 THEN
    _s := _s || ', para alugar por ' || public.lead_ia_reais_curto(_x.preco_aluguel) || ' por mês';
  ELSIF NOT _alug AND _x.negocio <> 'locacao' AND _x.preco > 0 THEN
    _s := _s || CASE WHEN _fem THEN ', anunciada por ' ELSE ', anunciado por ' END || public.lead_ia_reais_curto(_x.preco);
  END IF;
  RETURN _s;
END $$;

CREATE OR REPLACE FUNCTION public.lead_ia_primeira_msg(_l public.leads, _c public.lead_config, _org_nome text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _t text; _nome text; _imovel text; _x public.remax_xml_listings; _link text;
  _re text := '(h[t]tps?://|www\.|[a-z0-9-]+\.(com|net|org|br|me|ly|io|app|site|link)(\M|/))';
BEGIN
  _t := coalesce(nullif(btrim(_c.ia_primeira_msg), ''),
    'Oi, {nome}! Aqui é a {assistente}, da {imobiliaria}. Vi seu interesse {imovel}. {link}Quer saber mais detalhes ou já prefere agendar uma visita?');
  -- Lead sem nome (ex.: "Lead Grupo ZAP") ou nome com cara de link: "Oi!" em vez de "Oi, !".
  _nome := CASE WHEN btrim(_l.nome) ~* '^lead( grupo zap)?$' THEN '' ELSE split_part(btrim(_l.nome), ' ', 1) END;
  IF _nome ~* _re OR char_length(_nome) > 40 THEN _nome := ''; END IF;
  IF _nome = '' THEN _t := regexp_replace(_t, ',?\s*\{nome\}', '', 'g'); END IF;
  -- Imóvel: XML da PRÓPRIA imobiliária pelo código do anúncio (última coleta boa); sem ele, a captação.
  IF nullif(btrim(_l.anuncio_codigo), '') IS NOT NULL THEN
    SELECT x.* INTO _x FROM public.remax_xml_listings x
     WHERE x.organization_id = _l.organization_id
       AND x.code_key = public.portal_code_key(btrim(_l.anuncio_codigo))
       AND x.last_run = (public.remax_xml_last_ok(_l.organization_id)).id
     LIMIT 1;
  END IF;
  IF _x.code IS NOT NULL THEN
    _imovel := public.lead_ia_xml_frase_msg(_x, _l.portal_transacao);
    IF public.xml_url_anuncio_ok(_x.url) THEN _link := _x.url; END IF;
  END IF;
  -- Texto vindo do XML com cara de link nunca entra (o único link possível é o do anúncio, validado acima).
  IF _imovel ~* _re THEN _imovel := NULL; END IF;
  IF _imovel IS NULL AND _l.capture_id IS NOT NULL THEN
    _imovel := public.lead_ia_imovel_frase(_l.capture_id, _l.organization_id, 'em');
  END IF;
  _t := replace(_t, '{nome}', _nome);
  _t := replace(_t, '{assistente}', btrim(_c.ia_nome));
  _t := replace(_t, '{imobiliaria}', coalesce(_org_nome, 'imobiliária'));
  _t := replace(_t, '{imovel}', coalesce(_imovel, 'no imóvel que você viu'));
  _t := replace(_t, '{link}', CASE WHEN _link IS NOT NULL THEN 'Anúncio: ' || _link || ' ' ELSE '' END);
  RETURN left(btrim(regexp_replace(_t, '\s+', ' ', 'g')), 2000);
END $$;

-- 6) Código do anúncio gravado depois do INSERT: remonta a 1ª mensagem se ela ainda não saiu ----------------
CREATE OR REPLACE FUNCTION public.lead_ia_primeira_atualizar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _c public.lead_config; _org text; _m public.lead_mensagens; _novo text;
BEGIN
  BEGIN
    SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = NEW.id FOR UPDATE;
    IF _cv.id IS NULL OR _cv.primeira_enviada_em IS NOT NULL OR _cv.estado <> 'ativa' THEN RETURN NULL; END IF;
    -- Só a mensagem de abertura, sozinha e ainda não enviada (nem em envio).
    IF (SELECT count(*) FROM public.lead_mensagens WHERE conversa_id = _cv.id) <> 1 THEN RETURN NULL; END IF;
    SELECT * INTO _m FROM public.lead_mensagens
     WHERE conversa_id = _cv.id AND autor = 'ia' AND status IN ('nao_enviada', 'pendente') FOR UPDATE;
    IF _m.id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO _c FROM public.lead_config WHERE organization_id = NEW.organization_id;
    IF _c.organization_id IS NULL THEN RETURN NULL; END IF;
    SELECT nome INTO _org FROM public.organizations WHERE id = NEW.organization_id;
    _novo := public.lead_ia_primeira_msg(NEW, _c, _org);
    IF _novo IS NOT NULL AND _novo IS DISTINCT FROM _m.texto THEN
      UPDATE public.lead_mensagens SET texto = _novo WHERE id = _m.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'lead_ia_primeira_atualizar: lead % falhou: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS zz_lead_ia_primeira_atualizar ON public.leads;
CREATE TRIGGER zz_lead_ia_primeira_atualizar AFTER UPDATE OF anuncio_codigo, portal_transacao ON public.leads
  FOR EACH ROW WHEN (OLD.anuncio_codigo IS DISTINCT FROM NEW.anuncio_codigo
                     OR OLD.portal_transacao IS DISTINCT FROM NEW.portal_transacao)
  EXECUTE FUNCTION public.lead_ia_primeira_atualizar();

-- 7) Nome padrão da IA para imobiliárias novas -------------------------------------------------------------
ALTER TABLE public.lead_config ALTER COLUMN ia_nome SET DEFAULT 'Nicole';

-- Permissões (as funções já existentes mantêm as delas) -----------------------------------------------------
REVOKE ALL ON FUNCTION public.xml_url_anuncio_ok(text), public.xml_url_host(text), public.lead_ia_reais_curto(numeric),
  public.lead_ia_xml_frase_msg(public.remax_xml_listings, text), public.lead_ia_primeira_atualizar()
  FROM PUBLIC, anon, authenticated;

COMMIT;
