-- Sugestão automática do anúncio do site RE/MAX na captação (pedido de Denis 09/10, tópico 6238).
--
-- 1) Coleta diária dos anúncios PÚBLICOS do site remax.com.br (sem IA, sem custo): escritórios configurados por
--    imobiliária (remax_site_offices); guarda só o necessário para a ligação (remax_site_listings) e, dos
--    corretores, só ID, nome e escritório (remax_site_agents). NUNCA telefone nem e-mail.
--    Falha ou resultado suspeito (site mudou) NÃO apaga nada: os dados da última coleta boa continuam valendo.
-- 2) Sugestão na captação (exclusive_site_suggestions): 1 a 3 anúncios ativos do MESMO ID RE/MAX do captador,
--    ainda sem captação, pontuados por distância, rua/número, bairro, tipo, área, quartos e preço.
--    Só SUGERE: a ligação continua sendo pelo exclusive_listing_link do PR #56, com clique do corretor
--    (código único por captação e confirmação do gestor para outro ID continuam iguais).
-- 3) Painel do gestor (exclusive_site_provaveis): "provável anúncio encontrado" nas aprovadas sem anúncio.
-- 4) Feedback "Sem corretor" (remax_site_agent_names): nome do site para IDs sem usuário no ADM; só admin
--    (é quem já vê esses anúncios hoje). Não cria usuário e não muda nenhuma contagem.
-- Isolamento: tudo por organization_id; um escritório só pode estar em UMA imobiliária.
-- Aditiva: não altera tabela, função nem policy existentes. Rollback: supabase/rollback/20261009040000_*.sql
BEGIN;

-- Configuração: escritórios RE/MAX de cada imobiliária -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.remax_site_offices (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  office_id integer NOT NULL CHECK (office_id > 0),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, office_id),
  UNIQUE (office_id)
);

-- Anúncios do site (estado da última coleta boa; last_run marca quem está ativo nela) -------------------
CREATE TABLE IF NOT EXISTS public.remax_site_listings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  code text NOT NULL CHECK (code ~ '^[0-9]{9}-[0-9]{1,6}$'),
  code_key text GENERATED ALWAYS AS (public.portal_code_key(code)) STORED,
  agent_id text NOT NULL CHECK (agent_id ~ '^[0-9]{9}$'),
  office_id integer NOT NULL,
  status_uid integer,
  exclusivo boolean,
  transacao text CHECK (transacao IN ('venda', 'locacao')),
  tipo text CHECK (tipo IS NULL OR length(tipo) <= 60),
  rua text CHECK (rua IS NULL OR length(rua) <= 200),
  numero text CHECK (numero IS NULL OR length(numero) <= 20),
  bairro text CHECK (bairro IS NULL OR length(bairro) <= 120),
  cidade text CHECK (cidade IS NULL OR length(cidade) <= 120),
  cep text CHECK (cep IS NULL OR length(cep) <= 12),
  lat double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lon double precision CHECK (lon IS NULL OR lon BETWEEN -180 AND 180),
  area numeric(12,2) CHECK (area IS NULL OR area > 0),
  quartos smallint CHECK (quartos IS NULL OR quartos BETWEEN 0 AND 99),
  banheiros smallint CHECK (banheiros IS NULL OR banheiros BETWEEN 0 AND 99),
  vagas smallint CHECK (vagas IS NULL OR vagas BETWEEN 0 AND 99),
  preco numeric(14,2) CHECK (preco IS NULL OR preco >= 0),
  publicado_em timestamptz,
  url text CHECK (url IS NULL OR url ~ '^https://www\.remax\.com\.br/'),
  first_seen date NOT NULL,
  last_seen date NOT NULL,
  last_run uuid NOT NULL,
  PRIMARY KEY (organization_id, code_key)
);
CREATE INDEX IF NOT EXISTS remax_site_listings_agent_idx ON public.remax_site_listings (organization_id, agent_id, last_run);

CREATE TABLE IF NOT EXISTS public.remax_site_agents (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  agent_id text NOT NULL CHECK (agent_id ~ '^[0-9]{9}$'),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 160),
  office_id integer NOT NULL,
  last_seen date NOT NULL,
  PRIMARY KEY (organization_id, agent_id)
);

CREATE TABLE IF NOT EXISTS public.remax_site_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  status text NOT NULL CHECK (status IN ('ok', 'failed', 'suspeito')),
  listings integer,
  ativos integer,
  agents integer,
  message text CHECK (message IS NULL OR length(message) <= 500),
  started_at timestamptz,
  finished_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS remax_site_runs_org_idx ON public.remax_site_runs (organization_id, finished_at DESC);

-- Sem acesso direto de usuários: leitura só pelas RPCs abaixo (que já filtram imobiliária e perfil).
ALTER TABLE public.remax_site_offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remax_site_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remax_site_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remax_site_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.remax_site_offices, public.remax_site_listings, public.remax_site_agents, public.remax_site_runs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.remax_site_offices, public.remax_site_listings, public.remax_site_agents, public.remax_site_runs
  TO service_role;

-- Configuração inicial da Única Escolha (dados, não código: outras imobiliárias usam remax_site_offices_set).
INSERT INTO public.remax_site_offices (organization_id, office_id)
SELECT o.id, x.office FROM public.organizations o
  CROSS JOIN (VALUES (63059), (63060), (63183), (63164)) AS x(office)
 WHERE o.slug = 'unica-escolha'
ON CONFLICT DO NOTHING;

-- Ajudantes de comparação (puros) -------------------------------------------------------------------------
-- Rua sem acento, sem tipo de logradouro e sem preposições: "R. Dr. João de Barros" = "RUA JOAO BARROS".
CREATE OR REPLACE FUNCTION public.remax_norm_rua(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
    translate(lower(coalesce(_t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9 ]', ' ', 'g'),
    '\m(rua|r|avenida|av|alameda|al|travessa|tv|estrada|est|rodovia|rod|praca|pca|largo|dr|doutor|prof|professor|eng|engenheiro|cel|coronel|de|da|do|das|dos|e)\M', ' ', 'g'),
    '\s+', ' ', 'g')), '')
$$;

-- "Rua X, 123 - apto 4" -> número "123" (o primeiro número depois da vírgula ou de "nº").
CREATE OR REPLACE FUNCTION public.remax_endereco_numero(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(ltrim(substring(coalesce(_t, '') from '(?:,|\mn[º°o.]?)\s*([0-9]{1,6})'), '0'), '')
$$;

-- Logradouro sem o número: "Rua X, 123 - apto" -> "Rua X".
CREATE OR REPLACE FUNCTION public.remax_endereco_rua(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT btrim(split_part(regexp_replace(coalesce(_t, ''), '\s+(n[º°o.]?\s*)?[0-9]+.*$', ''), ',', 1))
$$;

-- Grupo do tipo (texto da captação ou slug do site): apartamento, casa, terreno, comercial.
CREATE OR REPLACE FUNCTION public.remax_tipo_grupo(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN t ~ '(apartamento|apto|cobertura|studio|estudio|kitnet|quitinete|flat|apart)' THEN 'apartamento'
    WHEN t ~ '(sala|loja|comercial|galpao|barracao|predio|ponto|escritorio|consultorio|bar)' THEN 'comercial'
    WHEN t ~ '(casa|sobrado|chacara|sitio|edicula|duplex|residencia)' THEN 'casa'
    WHEN t ~ '(terreno|lote|gleba|area)' THEN 'terreno'
  END
  FROM (SELECT translate(lower(coalesce(_t, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') t) x
$$;

-- "R$ 480.000,00" / "480000" / "480.000" -> 480000. Vazio ou sem número -> null.
CREATE OR REPLACE FUNCTION public.remax_valor(_t text) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN v ~ ',' THEN nullif(replace(replace(v, '.', ''), ',', '.'), '')::numeric
              WHEN v ~ '^[0-9]+$' THEN v::numeric
              WHEN v ~ '^[0-9]{1,3}(\.[0-9]{3})+$' THEN replace(v, '.', '')::numeric
              WHEN v ~ '^[0-9]+\.[0-9]{1,2}$' THEN v::numeric END
  FROM (SELECT nullif(regexp_replace(coalesce(_t, ''), '[^0-9,.]', '', 'g'), '') v) x
$$;

CREATE OR REPLACE FUNCTION public.remax_dist_m(_lat1 double precision, _lon1 double precision,
  _lat2 double precision, _lon2 double precision) RETURNS double precision
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN _lat1 IS NULL OR _lon1 IS NULL OR _lat2 IS NULL OR _lon2 IS NULL THEN NULL ELSE
    2 * 6371000 * asin(sqrt(power(sin(radians(_lat2 - _lat1) / 2), 2)
      + cos(radians(_lat1)) * cos(radians(_lat2)) * power(sin(radians(_lon2 - _lon1) / 2), 2))) END
$$;

-- Pontuação 0-100 de um anúncio para uma captação, com os motivos (mostrados ao corretor).
-- Distância (até 40) · mesma rua 20 + mesmo número 20 · bairro 8 · tipo 7 · área 10/5 · quartos 5 · preço 5/2.
CREATE OR REPLACE FUNCTION public.remax_match(_c public.exclusive_captures, _l public.remax_site_listings)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE _pts int := 0; _why text[] := '{}'; _d double precision; _im jsonb := coalesce(_c.form_data->'imovel', '{}');
  _fi jsonb := CASE WHEN jsonb_typeof(_c.form_data->'ficha') = 'object' THEN _c.form_data->'ficha' ELSE '{}' END;
  _rua text; _rua_l text; _num text; _area numeric; _q int; _v numeric; _r numeric; _mesma_rua boolean := false;
BEGIN
  _d := public.remax_dist_m(_c.geo_lat, _c.geo_lon, _l.lat, _l.lon);
  IF _d IS NOT NULL THEN
    IF _d <= 60 THEN _pts := _pts + 40; ELSIF _d <= 150 THEN _pts := _pts + 30;
    ELSIF _d <= 400 THEN _pts := _pts + 18; ELSIF _d <= 1000 THEN _pts := _pts + 8; END IF;
    IF _d <= 1000 THEN _why := _why || format('%s m do endereço da captação', round(_d)::int); END IF;
  END IF;
  _rua := public.remax_norm_rua(public.remax_endereco_rua(_im->>'endereco'));
  _rua_l := public.remax_norm_rua(_l.rua);
  IF _rua IS NOT NULL AND _rua_l IS NOT NULL AND (_rua = _rua_l
     OR (length(_rua_l) >= 6 AND length(_rua) >= 6 AND (strpos(_rua, _rua_l) > 0 OR strpos(_rua_l, _rua) > 0))) THEN
    _mesma_rua := true; _pts := _pts + 20; _why := _why || 'mesma rua'::text;
    _num := public.remax_endereco_numero(_im->>'endereco');
    IF _num IS NOT NULL AND _num = nullif(ltrim(substring(coalesce(_l.numero, '') from '[0-9]+'), '0'), '') THEN
      _pts := _pts + 20; _why := _why || 'mesmo número'::text;
    END IF;
  END IF;
  IF nullif(btrim(_im->>'bairro'), '') IS NOT NULL
     AND public.remax_norm_rua(_im->>'bairro') = public.remax_norm_rua(_l.bairro) THEN
    _pts := _pts + 8; _why := _why || 'mesmo bairro'::text;
  END IF;
  IF public.remax_tipo_grupo(coalesce(_fi->>'tipo', _im->>'tipo_imovel')) = public.remax_tipo_grupo(_l.tipo) THEN
    _pts := _pts + 7; _why := _why || 'mesmo tipo'::text;
  END IF;
  _area := CASE WHEN (_fi->>'area_util_m2') ~ '^[0-9]+([.][0-9]+)?$' THEN (_fi->>'area_util_m2')::numeric END;
  IF _area > 0 AND _l.area > 0 THEN
    _r := abs(_l.area - _area) / _area;
    IF _r <= 0.10 THEN _pts := _pts + 10; _why := _why || 'área parecida'::text;
    ELSIF _r <= 0.25 THEN _pts := _pts + 5; END IF;
  END IF;
  _q := CASE WHEN (_fi->>'quartos') ~ '^[0-9]{1,2}$' THEN (_fi->>'quartos')::int END;
  IF _q IS NOT NULL AND _q = _l.quartos THEN _pts := _pts + 5; _why := _why || 'mesmos quartos'::text; END IF;
  _v := public.remax_valor(_im->>'valor_imovel');
  IF _v > 0 AND _l.preco > 0 THEN
    _r := abs(_l.preco - _v) / _v;
    IF _r <= 0.10 THEN _pts := _pts + 5; _why := _why || 'preço parecido'::text;
    ELSIF _r <= 0.25 THEN _pts := _pts + 2; END IF;
  END IF;
  RETURN jsonb_build_object('score', least(_pts, 100), 'motivos', to_jsonb(_why),
    'distancia_m', CASE WHEN _d IS NULL THEN NULL ELSE round(_d)::int END, 'mesma_rua', _mesma_rua);
END $$;
REVOKE ALL ON FUNCTION public.remax_match(public.exclusive_captures, public.remax_site_listings) FROM PUBLIC, anon, authenticated;

-- Última coleta boa da imobiliária.
CREATE OR REPLACE FUNCTION public.remax_site_last_ok(_org uuid) RETURNS public.remax_site_runs
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM public.remax_site_runs WHERE organization_id = _org AND status = 'ok'
   ORDER BY finished_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.remax_site_last_ok(uuid) FROM PUBLIC, anon, authenticated;

-- Candidatos ranqueados (interno): anúncios ativos do ID do captador, sem captação ligada.
-- Confiança: alta = 70+ pontos E 15+ pontos à frente do segundo; média = 35+; abaixo de 35 não aparece.
CREATE OR REPLACE FUNCTION public.remax_site_rank(_capture uuid, _limit integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _prefix text; _run public.remax_site_runs%ROWTYPE; _items jsonb;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT remax_id INTO _prefix FROM public.profiles WHERE id = _c.captor_id AND organization_id = _c.organization_id;
  _run := public.remax_site_last_ok(_c.organization_id);
  IF _prefix IS NULL OR _run.id IS NULL THEN
    RETURN jsonb_build_object('prefix', _prefix, 'coleta', _run.finished_at, 'items', '[]'::jsonb);
  END IF;
  WITH cand AS (
    SELECT l.*, public.remax_match(_c, l) AS m
      FROM public.remax_site_listings l
     WHERE l.organization_id = _c.organization_id AND l.agent_id = _prefix AND l.last_run = _run.id
       AND NOT EXISTS (SELECT 1 FROM public.exclusive_listing_links k
                        WHERE k.organization_id = l.organization_id AND k.code_key = l.code_key
                          AND k.status IN ('ativo', 'aguardando_gestor') AND k.capture_id <> _capture)),
  ranked AS (
    SELECT cand.*, (m->>'score')::int AS score,
           row_number() OVER (ORDER BY (m->>'score')::int DESC, (m->>'distancia_m')::int NULLS LAST, code) AS pos,
           lead((m->>'score')::int) OVER (ORDER BY (m->>'score')::int DESC, (m->>'distancia_m')::int NULLS LAST, code) AS prox
      FROM cand WHERE (m->>'score')::int >= 35)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'score', score,
      'confianca', CASE WHEN pos = 1 AND score >= 70 AND (prox IS NULL OR score - prox >= 15) THEN 'alta'
                        ELSE 'media' END,
      'motivos', m->'motivos', 'distancia_m', m->'distancia_m',
      'rua', rua, 'numero', numero, 'bairro', bairro, 'cidade', cidade, 'tipo', tipo, 'transacao', transacao,
      'area', area, 'quartos', quartos, 'banheiros', banheiros, 'vagas', vagas, 'preco', preco,
      'exclusivo', exclusivo, 'publicado_em', publicado_em, 'url', url) ORDER BY pos), '[]'::jsonb)
    INTO _items FROM ranked WHERE pos <= greatest(1, least(coalesce(_limit, 3), 3));
  RETURN jsonb_build_object('prefix', _prefix, 'coleta', _run.finished_at, 'items', _items);
END $$;
REVOKE ALL ON FUNCTION public.remax_site_rank(uuid, integer) FROM PUBLIC, anon, authenticated;

-- 2) Sugestões na captação (quem vê a captação). Não grava nada.
CREATE OR REPLACE FUNCTION public.exclusive_site_suggestions(_capture uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  RETURN public.remax_site_rank(_capture, 3);
END $$;

-- 3) Painel do gestor: provável anúncio das aprovadas sem anúncio ligado (só o melhor, média ou alta).
CREATE OR REPLACE FUNCTION public.exclusive_site_provaveis()
RETURNS TABLE(capture_id uuid, code text, score integer, confianca text, url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['gestor','team_leader','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Somente gestor, team leader ou admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, r->'items'->0->>'code', (r->'items'->0->>'score')::int, r->'items'->0->>'confianca',
         r->'items'->0->>'url'
    FROM public.exclusive_captures c
   CROSS JOIN LATERAL (SELECT public.remax_site_rank(c.id, 1) AS r) x
   WHERE c.organization_id = public.current_org_id() AND c.status = 'aprovada'
     AND c.archived_at IS NULL AND c.discarded_at IS NULL
     AND public.exclusive_is_manager(c.id, auth.uid()) AND public.exclusive_can_view(c.id, auth.uid())
     AND NOT EXISTS (SELECT 1 FROM public.exclusive_listing_links l
                      WHERE l.capture_id = c.id AND l.status IN ('ativo', 'aguardando_gestor'))
     AND jsonb_array_length(coalesce(r->'items', '[]')) > 0;
END $$;

-- 4) Feedback "Sem corretor": nome do site para IDs RE/MAX sem usuário no ADM. Só admin (quem vê hoje).
CREATE OR REPLACE FUNCTION public.remax_site_agent_names()
RETURNS TABLE(agent_id text, nome text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT a.agent_id, a.nome FROM public.remax_site_agents a
   WHERE a.organization_id = public.current_org_id()
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.organization_id = a.organization_id
                      AND p.remax_id = a.agent_id);
END $$;

-- Configuração pelo admin da própria imobiliária (um escritório não pode estar em duas imobiliárias).
CREATE OR REPLACE FUNCTION public.remax_site_offices_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _run public.remax_site_runs%ROWTYPE;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Somente admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _run FROM public.remax_site_runs WHERE organization_id = _org ORDER BY finished_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'offices', (SELECT coalesce(jsonb_agg(office_id ORDER BY office_id), '[]') FROM public.remax_site_offices
                 WHERE organization_id = _org AND ativo),
    'ultima', CASE WHEN _run.id IS NULL THEN NULL ELSE jsonb_build_object('status', _run.status,
      'em', _run.finished_at, 'ativos', _run.ativos, 'mensagem', _run.message) END,
    'ultima_ok', (public.remax_site_last_ok(_org)).finished_at);
END $$;

CREATE OR REPLACE FUNCTION public.remax_site_offices_set(_offices integer[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]) OR _org IS NULL THEN
    RAISE EXCEPTION 'Somente admin' USING ERRCODE = '42501';
  END IF;
  IF coalesce(array_length(_offices, 1), 0) > 20 OR EXISTS (SELECT 1 FROM unnest(_offices) o WHERE o IS NULL OR o <= 0) THEN
    RAISE EXCEPTION 'Lista de escritórios inválida';
  END IF;
  IF EXISTS (SELECT 1 FROM public.remax_site_offices WHERE office_id = ANY(_offices) AND organization_id <> _org) THEN
    RAISE EXCEPTION 'Escritório já configurado em outra imobiliária' USING ERRCODE = '42501';
  END IF;
  UPDATE public.remax_site_offices SET ativo = (office_id = ANY(_offices)) WHERE organization_id = _org;
  INSERT INTO public.remax_site_offices (organization_id, office_id)
  SELECT _org, o FROM unnest(_offices) o ON CONFLICT (organization_id, office_id) DO UPDATE SET ativo = true;
END $$;

-- Coleta (só o servidor, service_role) -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remax_site_collect_targets()
RETURNS TABLE(organization_id uuid, offices integer[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.organization_id, array_agg(o.office_id ORDER BY o.office_id)
    FROM public.remax_site_offices o JOIN public.organizations g ON g.id = o.organization_id
   WHERE o.ativo GROUP BY o.organization_id
$$;

-- Grava uma coleta COMPLETA de uma imobiliária. Se vier com menos da metade dos ativos da última coleta boa
-- (site mudou, filtro quebrou), não aplica: registra 'suspeito' e mantém os dados anteriores.
CREATE OR REPLACE FUNCTION public.remax_site_ingest(_org uuid, _listings jsonb, _agents jsonb, _started timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _run uuid := gen_random_uuid(); _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _prev public.remax_site_runs%ROWTYPE; _n int; _ativos int; _ag int; _offices integer[];
BEGIN
  SELECT array_agg(office_id) INTO _offices FROM public.remax_site_offices WHERE organization_id = _org AND ativo;
  IF _offices IS NULL THEN RAISE EXCEPTION 'Imobiliária sem escritório configurado'; END IF;
  IF jsonb_typeof(_listings) <> 'array' OR jsonb_typeof(_agents) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido';
  END IF;
  DROP TABLE IF EXISTS pg_temp._l;
  CREATE TEMP TABLE _l ON COMMIT DROP AS
  SELECT DISTINCT ON (public.portal_code_key(i.code)) i.*
    FROM jsonb_to_recordset(_listings) AS i(code text, agent_id text, office_id int, status_uid int, exclusivo boolean,
      transacao text, tipo text, rua text, numero text, bairro text, cidade text, cep text, lat double precision,
      lon double precision, area numeric, quartos int, banheiros int, vagas int, preco numeric,
      publicado_em timestamptz, url text)
   WHERE i.code ~ '^[0-9]{9}-[0-9]{1,6}$' AND i.agent_id ~ '^[0-9]{9}$' AND i.office_id = ANY(_offices);
  SELECT count(*), count(*) FILTER (WHERE status_uid = 160) INTO _n, _ativos FROM _l;
  _prev := public.remax_site_last_ok(_org);
  IF _ativos = 0 OR (_prev.id IS NOT NULL AND _prev.ativos >= 20 AND _ativos < _prev.ativos / 2) THEN
    INSERT INTO public.remax_site_runs (organization_id, status, listings, ativos, message, started_at)
    VALUES (_org, 'suspeito', _n, _ativos, format('Coleta com %s ativos (antes: %s). Dados anteriores mantidos.',
      _ativos, coalesce(_prev.ativos, 0)), _started);
    RETURN jsonb_build_object('status', 'suspeito', 'ativos', _ativos, 'antes', _prev.ativos);
  END IF;
  INSERT INTO public.remax_site_listings AS t (organization_id, code, agent_id, office_id, status_uid, exclusivo,
    transacao, tipo, rua, numero, bairro, cidade, cep, lat, lon, area, quartos, banheiros, vagas, preco,
    publicado_em, url, first_seen, last_seen, last_run)
  SELECT _org, code, agent_id, office_id, status_uid, exclusivo,
    CASE WHEN transacao IN ('venda', 'locacao') THEN transacao END, left(tipo, 60), left(rua, 200), left(numero, 20),
    left(bairro, 120), left(cidade, 120), left(cep, 12),
    CASE WHEN lat BETWEEN -90 AND 90 THEN lat END, CASE WHEN lon BETWEEN -180 AND 180 THEN lon END,
    CASE WHEN area > 0 AND area < 1e9 THEN area END, CASE WHEN quartos BETWEEN 0 AND 99 THEN quartos END,
    CASE WHEN banheiros BETWEEN 0 AND 99 THEN banheiros END, CASE WHEN vagas BETWEEN 0 AND 99 THEN vagas END,
    CASE WHEN preco >= 0 AND preco < 1e12 THEN preco END, publicado_em,
    CASE WHEN url ~ '^https://www\.remax\.com\.br/' THEN url END, _hoje, _hoje,
    -- só os ativos (status 160) ficam marcados com esta coleta; os demais deixam de ser sugeridos
    CASE WHEN status_uid = 160 THEN _run ELSE '00000000-0000-0000-0000-000000000000'::uuid END
    FROM _l
  ON CONFLICT (organization_id, code_key) DO UPDATE SET code = EXCLUDED.code, agent_id = EXCLUDED.agent_id,
    office_id = EXCLUDED.office_id, status_uid = EXCLUDED.status_uid, exclusivo = EXCLUDED.exclusivo,
    transacao = EXCLUDED.transacao, tipo = EXCLUDED.tipo, rua = EXCLUDED.rua, numero = EXCLUDED.numero,
    bairro = EXCLUDED.bairro, cidade = EXCLUDED.cidade, cep = EXCLUDED.cep, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
    area = EXCLUDED.area, quartos = EXCLUDED.quartos, banheiros = EXCLUDED.banheiros, vagas = EXCLUDED.vagas,
    preco = EXCLUDED.preco, publicado_em = EXCLUDED.publicado_em, url = EXCLUDED.url,
    last_seen = EXCLUDED.last_seen, last_run = EXCLUDED.last_run;
  INSERT INTO public.remax_site_agents AS t (organization_id, agent_id, nome, office_id, last_seen)
  SELECT DISTINCT ON (a.agent_id) _org, a.agent_id, left(btrim(a.nome), 160), a.office_id, _hoje
    FROM jsonb_to_recordset(_agents) AS a(agent_id text, nome text, office_id int)
   WHERE a.agent_id ~ '^[0-9]{9}$' AND nullif(btrim(a.nome), '') IS NOT NULL AND a.office_id = ANY(_offices)
  ON CONFLICT (organization_id, agent_id) DO UPDATE SET nome = EXCLUDED.nome, office_id = EXCLUDED.office_id,
    last_seen = EXCLUDED.last_seen;
  GET DIAGNOSTICS _ag = ROW_COUNT;
  INSERT INTO public.remax_site_runs (id, organization_id, status, listings, ativos, agents, started_at)
  VALUES (_run, _org, 'ok', _n, _ativos, _ag, _started);
  RETURN jsonb_build_object('status', 'ok', 'listings', _n, 'ativos', _ativos, 'agents', _ag);
END $$;

CREATE OR REPLACE FUNCTION public.remax_site_mark_failed(_org uuid, _message text, _started timestamptz)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.remax_site_runs (organization_id, status, message, started_at)
  VALUES (_org, 'failed', left(coalesce(_message, 'falha'), 500), _started)
$$;

-- Permissões das RPCs
DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['public.exclusive_site_suggestions(uuid)', 'public.exclusive_site_provaveis()',
    'public.remax_site_agent_names()', 'public.remax_site_offices_get()', 'public.remax_site_offices_set(integer[])']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', _f);
  END LOOP;
  FOREACH _f IN ARRAY ARRAY['public.remax_site_collect_targets()',
    'public.remax_site_ingest(uuid, jsonb, jsonb, timestamptz)', 'public.remax_site_mark_failed(uuid, text, timestamptz)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _f);
  END LOOP;
  FOREACH _f IN ARRAY ARRAY['public.remax_norm_rua(text)', 'public.remax_endereco_numero(text)',
    'public.remax_endereco_rua(text)', 'public.remax_tipo_grupo(text)', 'public.remax_valor(text)',
    'public.remax_dist_m(double precision, double precision, double precision, double precision)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', _f);
  END LOOP;
END $$;

COMMIT;
