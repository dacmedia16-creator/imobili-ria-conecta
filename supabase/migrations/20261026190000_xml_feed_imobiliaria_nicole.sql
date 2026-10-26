-- "Link do XML (portais)" por imobiliária + Nicole lendo o imóvel pelo XML (card t_76243950; "sim" de Denis 26/10/2026,
-- tópico 6238). Base: levantamento t_6d4c6f88 (item 5) e as migrations 20261016200000 (XML RE/MAX) e
-- 20261026170000 (roteiro da Nicole, ainda não publicada: aplicar ESTA depois dela).
--
-- ADITIVA. Rollback: docs/sql/rollback/20261026190000_xml_feed_imobiliaria_nicole.rollback.sql
--
-- O que muda:
--  1) Tabela organization_xml_feeds: o link do XML de cada imobiliária. Fica numa tabela própria, e não em
--     organizations, porque organizations é legível por todos os membros; aqui só o servidor (service_role)
--     lê. Só o administrador da plataforma grava (platform_xml_feed_salvar). Só https. Nasce VAZIA.
--     O segredo REMAX_XML_FEEDS (Única Escolha) continua igual e não passa por aqui.
--  2) remax_xml_listings ganha colunas do modo "genérico" (VRSync de qualquer imobiliária): título,
--     condomínio, IPTU (+ período), suítes, quantidade de fotos, área útil e área do terreno.
--     agent_id passa a aceitar vazio (o modo genérico não guarda corretor nem NENHUM contato).
--  3) remax_xml_ingest ganha _modo ('remax' padrão | 'generico'). A regra de queda brusca (XML vazio ou com
--     menos da metade da última coleta boa = rejeitado, versão anterior mantida) vale para os dois modos.
--  4) lead_ia_ficha_xml(_org, _codigo): ficha do imóvel pela ÚLTIMA coleta boa da PRÓPRIA imobiliária.
--     Imóvel que saiu do XML = NULL (a Nicole volta para a captação ou para "o corretor confirma").
--     Nunca devolve disponibilidade, permuta, financiamento nem andar.
--  5) Nicole: o XML tem prioridade (leads.anuncio_codigo ou código informado na conversa); sem XML, a captação.
BEGIN;

-- 1) Link do XML por imobiliária ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_xml_feeds (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  url text NOT NULL CONSTRAINT organization_xml_feeds_url_check
    CHECK (char_length(url) <= 500 AND url ~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.organization_xml_feeds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_xml_feeds FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.organization_xml_feeds TO service_role;

-- Só o administrador da plataforma. _url vazio/NULL = apaga o link (a imobiliária deixa de ter coleta).
CREATE OR REPLACE FUNCTION public.platform_xml_feed_salvar(_org uuid, _url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _u text := nullif(btrim(coalesce(_url, '')), '');
BEGIN
  IF NOT coalesce(public.is_platform_super_admin(auth.uid()), false) THEN
    RAISE EXCEPTION 'Somente o super-admin da plataforma' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF _u IS NULL THEN
    DELETE FROM public.organization_xml_feeds WHERE organization_id = _org;
    RETURN;
  END IF;
  -- Só https com NOME (IP numérico é recusado; o servidor ainda confere o DNS antes de cada download).
  IF char_length(_u) > 500 OR _u !~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$'
     OR _u ~ '^https://[0-9.]+(:443)?(/|$)' THEN
    RAISE EXCEPTION 'Link invalido: use um endereco https' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.organization_xml_feeds (organization_id, url, updated_by) VALUES (_org, _u, auth.uid())
  ON CONFLICT (organization_id) DO UPDATE SET url = EXCLUDED.url, updated_at = now(), updated_by = EXCLUDED.updated_by;
END $$;
REVOKE ALL ON FUNCTION public.platform_xml_feed_salvar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_xml_feed_salvar(uuid, text) TO authenticated, service_role;

-- 2) Colunas do modo genérico ------------------------------------------------------------------------------
ALTER TABLE public.remax_xml_listings
  ADD COLUMN IF NOT EXISTS titulo text,
  ADD COLUMN IF NOT EXISTS condominio numeric,
  ADD COLUMN IF NOT EXISTS iptu numeric,
  ADD COLUMN IF NOT EXISTS iptu_periodo text CONSTRAINT remax_xml_listings_iptu_periodo_check CHECK (iptu_periodo IN ('mensal', 'anual')),
  ADD COLUMN IF NOT EXISTS suites smallint,
  ADD COLUMN IF NOT EXISTS fotos_qtd smallint,
  ADD COLUMN IF NOT EXISTS area_util numeric,
  ADD COLUMN IF NOT EXISTS area_terreno numeric;
ALTER TABLE public.remax_xml_listings ALTER COLUMN agent_id DROP NOT NULL;

-- 3) Ingestão com modo (mesmos argumentos nomeados de antes + _modo com padrão: o Worker publicado continua igual)
DROP FUNCTION IF EXISTS public.remax_xml_ingest(uuid, jsonb, integer, timestamptz);
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
REVOKE ALL ON FUNCTION public.remax_xml_ingest(uuid, jsonb, integer, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remax_xml_ingest(uuid, jsonb, integer, timestamptz, text) TO service_role;

-- 4) Frase e ficha do imóvel pelo XML ----------------------------------------------------------------------
-- Frase a partir de tipo (já na palavra da conversa) e bairro. Mesma regra de lead_ia_imovel_frase, agora
-- compartilhada pela captação e pelo XML.
CREATE OR REPLACE FUNCTION public.lead_ia_frase(_tipo text, _bairro text, _forma text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN t IS NULL AND b IS NULL THEN NULL ELSE
    CASE _forma
      WHEN 'em' THEN CASE WHEN fem THEN 'na ' ELSE 'no ' END
      WHEN 'indef' THEN CASE WHEN fem THEN 'uma ' ELSE 'um ' END
      ELSE CASE WHEN fem THEN 'a ' ELSE 'o ' END END
    || coalesce(t, 'imóvel')
    || coalesce(CASE WHEN _forma = 'indef' THEN ' no bairro ' ELSE ' do bairro ' END || b, '') END
  FROM (SELECT _tipo AS t, left(nullif(btrim(_bairro), ''), 60) AS b, coalesce(_tipo IN ('casa', 'cobertura'), false) AS fem) x
$$;

CREATE OR REPLACE FUNCTION public.lead_ia_imovel_frase(_capture uuid, _org uuid, _forma text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.lead_ia_frase(public.lead_ia_tipo(c.form_data->'imovel'->>'tipo_imovel'),
                              c.form_data->'imovel'->>'bairro', _forma)
    FROM public.exclusive_captures c WHERE c.id = _capture AND c.organization_id = _org
$$;

-- Número -> texto curto pt-BR ("1.234,5"; inteiro sem casas). Só dígitos, ponto e vírgula.
CREATE OR REPLACE FUNCTION public.lead_ia_num(_v numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN _v IS NULL OR _v <= 0 THEN NULL ELSE
    translate(regexp_replace(regexp_replace(to_char(round(_v, 2), 'FM999,999,999,990.00'), '0+$', ''), '\.$', ''),
              ',.', '.,') END
$$;
CREATE OR REPLACE FUNCTION public.lead_ia_reais(_v numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN _v IS NULL OR _v <= 0 THEN NULL ELSE
    'R$ ' || translate(to_char(round(_v, 2), 'FM999,999,999,990.00'), ',.', '.,') END
$$;

-- Ficha pelo XML: só a ÚLTIMA coleta boa da PRÓPRIA imobiliária. Fora do XML atual = NULL.
-- Mesmas chaves do FichaIa (src/lib/leads-ia.ts). Sem preço, sem contato, sem disponibilidade,
-- sem permuta/financiamento/andar (o XML não tem campo próprio e o texto livre não é usado).
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

-- 5) Contexto da Nicole: XML primeiro, captação depois (mesma assinatura) ------------------------------------
CREATE OR REPLACE FUNCTION public.lead_ia_registrar_cliente(_conversa uuid, _texto text, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _c public.lead_config; _t text := left(btrim(coalesce(_texto, '')), 1000);
  _n integer; _outra uuid; _cap uuid; _org text; _fx jsonb;
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
  -- Prioridade (t_76243950): XML pelo código do anúncio do portal (ou o informado pelo cliente na conversa);
  -- se o imóvel não está no XML atual, a captação.
  _fx := public.lead_ia_ficha_xml(_cv.organization_id,
           coalesce(nullif(btrim(_l.anuncio_codigo), ''), nullif(btrim(_cv.dados->>'imovel_xml_codigo'), '')));
  IF _fx = '{}'::jsonb THEN _fx := NULL; END IF;
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
    'imovel_fonte', CASE WHEN _fx IS NOT NULL THEN 'xml' WHEN _cap IS NOT NULL THEN 'captacao' END,
    'imovel_frase', CASE WHEN _fx IS NOT NULL THEN public.lead_ia_frase(_fx->>'tipo', _fx->>'bairro', 'def')
                         WHEN _cap IS NOT NULL THEN public.lead_ia_imovel_frase(_cap, _l.organization_id, 'def') END,
    'ficha', CASE WHEN _fx IS NOT NULL THEN _fx
                  WHEN _cap IS NOT NULL THEN public.lead_ia_ficha(_cap, _l.organization_id) END);
END $$;

-- Código que o cliente informou: XML da própria imobiliária primeiro, depois a captação (mesma assinatura).
-- Devolve {capture_id, xml_codigo, frase, ficha} ou NULL. Não altera o lead nem a distribuição.
CREATE OR REPLACE FUNCTION public.lead_ia_imovel_por_codigo(_conversa uuid, _codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid; _cap uuid; _fx jsonb; _c text := upper(btrim(coalesce(_codigo, '')));
BEGIN
  SELECT organization_id INTO _org FROM public.lead_conversas WHERE id = _conversa;
  IF _org IS NULL OR char_length(_c) NOT BETWEEN 4 AND 60 THEN RETURN NULL; END IF;
  _fx := public.lead_ia_ficha_xml(_org, _c);
  IF _fx IS NOT NULL AND _fx <> '{}'::jsonb THEN
    RETURN jsonb_build_object('capture_id', NULL, 'xml_codigo', _c,
                              'frase', public.lead_ia_frase(_fx->>'tipo', _fx->>'bairro', 'def'), 'ficha', _fx);
  END IF;
  _cap := public.lead_portal_captacao(_org, _c);
  IF _cap IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('capture_id', _cap, 'frase', public.lead_ia_imovel_frase(_cap, _org, 'def'),
                            'ficha', public.lead_ia_ficha(_cap, _org));
END $$;

-- 6) Permissões (as funções já existentes mantêm as delas) -------------------------------------------------
REVOKE ALL ON FUNCTION public.lead_ia_frase(text, text, text), public.lead_ia_num(numeric), public.lead_ia_reais(numeric),
  public.lead_ia_ficha_xml(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_ia_ficha_xml(uuid, text) TO service_role;

COMMIT;
