-- Feedback e mapa de captações pelo XML VRSync RE/MAX -> OLX (t_698be0d2, regras aprovadas por Denis 16/10).
--
-- 1) Base: anúncios de VENDA do XML da imobiliária (aluguel nunca entra no banco).
-- 2) Coleta 1x/dia pelo Worker (task remax-xml-collect). A URL do XML é segredo do Worker
--    (REMAX_XML_FEEDS) e nunca fica no banco, no git ou no log.
-- 3) XML falhou, veio vazio ou anormal (menos da metade da última coleta boa): a coleta é registrada como
--    'rejeitado'/'failed' e a última versão boa continua valendo. Nunca zera.
-- 4) Nome, e-mail e telefone do corretor vindos do XML ficam só nesta tabela (sem acesso direto de usuário,
--    sem log). Cruzamento com o ADM: ID RE/MAX > e-mail > telefone (só telefone de UM corretor no XML).
--    Empate ou mesmo perfil para dois IDs = conflito: não liga sozinho, vai para a lista de revisão do admin.
-- 5) Mapa: mapa_anuncios_xml() devolve venda da última coleta boa, inclusive os sem coordenada (a tela
--    lista à parte). A coleta do site RE/MAX continua igual e serve de reserva quando não há XML bom.
-- Sem DML em dados existentes. Rollback: supabase/rollback/20261016200000_remax_xml_feed.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.remax_xml_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('ok', 'rejeitado', 'failed')),
  total integer,
  venda integer,
  com_coord integer,
  message text,
  started_at timestamptz,
  finished_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS remax_xml_runs_org_idx ON public.remax_xml_runs (organization_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS public.remax_xml_listings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  code_key text GENERATED ALWAYS AS (public.portal_code_key(code)) STORED,
  agent_id text NOT NULL,
  tipo text,
  rua text,
  numero text,
  bairro text,
  cidade text,
  cep text,
  lat double precision,
  lon double precision,
  area numeric,
  quartos smallint,
  banheiros smallint,
  vagas smallint,
  preco numeric,
  url text,
  escritorio text,
  corretor_nome text,
  corretor_email text,
  corretor_telefone text,
  first_seen date NOT NULL,
  last_seen date NOT NULL,
  last_run uuid NOT NULL,
  PRIMARY KEY (organization_id, code_key)
);
CREATE INDEX IF NOT EXISTS remax_xml_listings_run_idx ON public.remax_xml_listings (organization_id, last_run);
CREATE INDEX IF NOT EXISTS remax_xml_listings_agent_idx ON public.remax_xml_listings (organization_id, agent_id);

-- Sem acesso direto de usuários: leitura só pelas RPCs abaixo.
ALTER TABLE public.remax_xml_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remax_xml_listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.remax_xml_runs, public.remax_xml_listings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.remax_xml_runs, public.remax_xml_listings TO service_role;

-- Telefone só com dígitos, sem DDI 55. Menos de 10 dígitos = inválido.
CREATE OR REPLACE FUNCTION public.remax_tel_norm(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN length(d) >= 10 THEN d END
    FROM (SELECT CASE WHEN length(x) > 11 AND x LIKE '55%' THEN substr(x, 3) ELSE x END AS d
            FROM (SELECT regexp_replace(coalesce(_t, ''), '\D', '', 'g') AS x) a) b
$$;

CREATE OR REPLACE FUNCTION public.remax_xml_last_ok(_org uuid) RETURNS public.remax_xml_runs
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.* FROM public.remax_xml_runs r
   WHERE r.organization_id = _org AND r.status = 'ok' ORDER BY r.finished_at DESC LIMIT 1
$$;

-- Corretor do XML (agent_id = 9 primeiros dígitos do código) -> perfil do ADM, na mesma imobiliária.
-- via: 'id' | 'email' | 'telefone' | 'conflito' | 'sem_cadastro'. profile_id só quando não há conflito.
CREATE OR REPLACE FUNCTION public.remax_xml_broker_match(_org uuid)
RETURNS TABLE(agent_id text, profile_id uuid, via text, candidatos integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH run AS (SELECT (public.remax_xml_last_ok(_org)).id AS id),
  ag AS (
    SELECT l.agent_id,
           array_agg(DISTINCT lower(btrim(l.corretor_email))) FILTER (WHERE nullif(btrim(l.corretor_email), '') IS NOT NULL) AS emails,
           array_agg(DISTINCT public.remax_tel_norm(l.corretor_telefone)) FILTER (WHERE public.remax_tel_norm(l.corretor_telefone) IS NOT NULL) AS tels
      FROM public.remax_xml_listings l, run
     WHERE l.organization_id = _org AND l.last_run = run.id
     GROUP BY l.agent_id
  ),
  -- telefone usado por mais de um corretor no XML (ex.: telefone do escritório) não serve para ligar
  tel_unico AS (
    SELECT t FROM ag, unnest(ag.tels) t GROUP BY t HAVING count(DISTINCT ag.agent_id) = 1
  ),
  prof AS (
    SELECT p.id, p.remax_id, lower(btrim(p.email)) AS email, public.remax_tel_norm(p.telefone) AS tel
      FROM public.profiles p WHERE p.organization_id = _org AND p.ativo
  ),
  cand AS (
    SELECT ag.agent_id,
      (SELECT array_agg(p.id) FROM prof p WHERE p.remax_id = ag.agent_id) AS by_id,
      (SELECT array_agg(p.id) FROM prof p WHERE p.email = ANY(ag.emails)) AS by_email,
      (SELECT array_agg(p.id) FROM prof p WHERE p.tel = ANY(ag.tels) AND p.tel IN (SELECT t FROM tel_unico)) AS by_tel
      FROM ag
  ),
  pick AS (
    SELECT c.agent_id,
      CASE WHEN c.by_id IS NOT NULL THEN 'id' WHEN c.by_email IS NOT NULL THEN 'email'
           WHEN c.by_tel IS NOT NULL THEN 'telefone' END AS via,
      coalesce(c.by_id, c.by_email, c.by_tel) AS ids
      FROM cand c
  ),
  one AS (
    SELECT p.agent_id, p.via, cardinality(p.ids) AS n, CASE WHEN cardinality(p.ids) = 1 THEN p.ids[1] END AS pid
      FROM pick p
  )
  SELECT o.agent_id,
    CASE WHEN o.n = 1 AND (o.via = 'id' OR NOT EXISTS (
      SELECT 1 FROM one x WHERE x.pid = o.pid AND x.agent_id <> o.agent_id)) THEN o.pid END,
    CASE WHEN o.via IS NULL THEN 'sem_cadastro'
         WHEN o.n > 1 THEN 'conflito'
         WHEN o.via <> 'id' AND EXISTS (SELECT 1 FROM one x WHERE x.pid = o.pid AND x.agent_id <> o.agent_id)
           THEN 'conflito'
         ELSE o.via END,
    coalesce(o.n, 0)
    FROM one o
$$;

-- Leitura comum (módulo Feedback ligado + perfil ativo com papel).
CREATE OR REPLACE FUNCTION public.remax_xml_can_read() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND public.current_org_id() IS NOT NULL
     AND coalesce(public.has_any_role(auth.uid(),
       ARRAY['corretor','team_leader','gestor','admin','super_admin']::public.app_role[]), false)
$$;

-- Situação da coleta do XML (sem URL, sem dados pessoais).
CREATE OR REPLACE FUNCTION public.remax_xml_status()
RETURNS TABLE(ultima_boa timestamptz, venda integer, com_coord integer, ultima_tentativa timestamptz,
  ultimo_status text, aviso text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _ok public.remax_xml_runs%ROWTYPE; _last public.remax_xml_runs%ROWTYPE;
BEGIN
  IF NOT public.remax_xml_can_read() THEN RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501'; END IF;
  _ok := public.remax_xml_last_ok(_org);
  SELECT * INTO _last FROM public.remax_xml_runs r WHERE r.organization_id = _org ORDER BY r.finished_at DESC LIMIT 1;
  IF _last.id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT _ok.finished_at, _ok.venda, _ok.com_coord, _last.finished_at, _last.status,
    CASE WHEN _last.status <> 'ok' THEN
      CASE WHEN _ok.id IS NULL THEN 'O XML da RE/MAX ainda não carregou.'
           ELSE 'A última leitura do XML da RE/MAX falhou ou veio incompleta; mostrando a última versão boa.' END
    END;
END $$;

-- Base do Feedback: códigos de VENDA da última coleta boa, com o corretor do ADM.
-- Corretor vê os seus; gestor/team leader os da equipe; admin todos (inclusive sem corretor ligado).
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

-- Revisão do admin: como cada corretor do XML ficou ligado (sem e-mail/telefone na resposta).
CREATE OR REPLACE FUNCTION public.remax_xml_broker_links()
RETURNS TABLE(agent_id text, corretor_xml text, via text, candidatos integer, broker_id uuid, anuncios integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _run public.remax_xml_runs%ROWTYPE;
BEGIN
  IF NOT coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]), false) THEN
    RAISE EXCEPTION 'Somente admin' USING ERRCODE = '42501';
  END IF;
  _run := public.remax_xml_last_ok(_org);
  IF _run.id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.agent_id, max(nullif(btrim(l.corretor_nome), '')), m.via, m.candidatos, m.profile_id, count(*)::int
    FROM public.remax_xml_broker_match(_org) m
    JOIN public.remax_xml_listings l ON l.organization_id = _org AND l.last_run = _run.id AND l.agent_id = m.agent_id
   GROUP BY m.agent_id, m.via, m.candidatos, m.profile_id
   ORDER BY (m.via = 'conflito') DESC, (m.via = 'sem_cadastro') DESC, m.agent_id;
END $$;

-- Mapa de captações pelo XML: mesmas colunas e permissões de mapa_anuncios_site; lat/lon podem vir nulos.
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

-- Grava uma coleta COMPLETA do XML (só servidor). _listings = só os de venda, já convertidos.
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
  -- dado pessoal não fica guardado sem uso: anúncio fora do XML há mais de 60 dias é apagado
  DELETE FROM public.remax_xml_listings WHERE organization_id = _org AND last_seen < _hoje - 60;
  INSERT INTO public.remax_xml_runs (id, organization_id, status, total, venda, com_coord, started_at)
  VALUES (_run, _org, 'ok', _total, _n, _coord, _started);
  RETURN jsonb_build_object('status', 'ok', 'venda', _n, 'com_coord', _coord);
END $$;

CREATE OR REPLACE FUNCTION public.remax_xml_mark_failed(_org uuid, _message text, _started timestamptz)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.remax_xml_runs (organization_id, status, message, started_at)
  SELECT _org, 'failed', left(coalesce(_message, 'falha'), 300), _started
   WHERE EXISTS (SELECT 1 FROM public.organizations WHERE id = _org)
$$;

-- Permissões
DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['public.remax_xml_status()', 'public.feedback_xml_base()',
    'public.remax_xml_broker_links()', 'public.mapa_anuncios_xml()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', _f);
  END LOOP;
  FOREACH _f IN ARRAY ARRAY['public.remax_xml_ingest(uuid, jsonb, integer, timestamptz)',
    'public.remax_xml_mark_failed(uuid, text, timestamptz)', 'public.remax_xml_last_ok(uuid)',
    'public.remax_xml_broker_match(uuid)', 'public.remax_xml_can_read()']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _f);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.remax_tel_norm(text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.remax_tel_norm(text) TO authenticated, service_role';
END $$;

COMMIT;
