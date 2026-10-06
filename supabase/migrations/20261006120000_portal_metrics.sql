-- Feedback ao Proprietário: números semanais dos portais por anúncio (somente leitura dos portais).
-- Gravação só pelo coletor do servidor (Management API); usuários apenas leem.
-- Corretor vê os próprios anúncios; gestor/team leader os do time; admin tudo da imobiliária.

CREATE TABLE IF NOT EXISTS public.portal_collection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  portal text NOT NULL CHECK (portal IN ('zap','imovelweb','cliqueimudei','chavesnamao')),
  collected_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','partial','failed')),
  listings_total integer,
  listings_ok integer NOT NULL DEFAULT 0,
  listings_error integer NOT NULL DEFAULT 0,
  message text,
  started_at timestamptz,
  finished_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, portal, collected_on)
);

CREATE TABLE IF NOT EXISTS public.portal_listing_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  portal text NOT NULL CHECK (portal IN ('zap','imovelweb','cliqueimudei','chavesnamao')),
  collected_on date NOT NULL,
  listing_code text NOT NULL,
  external_id text,
  remax_id text GENERATED ALWAYS AS (substring(listing_code from '^([0-9]{9})-')) STORED,
  broker_id uuid REFERENCES public.profiles(id),
  -- 'cumulative' = acumulado do anúncio; 'last30' = últimos 30 dias; 'unknown' = período não confirmado
  window_kind text NOT NULL CHECK (window_kind IN ('cumulative','last30','unknown')),
  window_from date,
  window_to date,
  impressions integer CHECK (impressions >= 0),
  views integer CHECK (views >= 0),
  contacts integer CHECK (contacts >= 0),
  contacts_detail jsonb,
  -- erro de coleta fica sem número (nunca inferir)
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, portal, collected_on, listing_code),
  CHECK (error IS NULL OR (views IS NULL AND contacts IS NULL AND impressions IS NULL))
);
CREATE INDEX IF NOT EXISTS portal_snap_broker_idx ON public.portal_listing_snapshots (broker_id, collected_on);
CREATE INDEX IF NOT EXISTS portal_snap_code_idx ON public.portal_listing_snapshots (organization_id, listing_code, portal, collected_on);

ALTER TABLE public.portal_collection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_listing_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_collection_runs, public.portal_listing_snapshots FROM anon, authenticated;
GRANT SELECT ON public.portal_collection_runs, public.portal_listing_snapshots TO authenticated;

CREATE POLICY org_isolation ON public.portal_collection_runs AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY org_isolation ON public.portal_listing_snapshots AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));

-- Situação das coletas: só administração (alerta de falha vai ao admin, não ao corretor).
CREATE POLICY portal_runs_admin_read ON public.portal_collection_runs FOR SELECT TO authenticated
  USING (public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[]));

CREATE POLICY portal_snap_read ON public.portal_listing_snapshots FOR SELECT TO authenticated
  USING (
    broker_id = (SELECT auth.uid())
    OR public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
    OR (broker_id IS NOT NULL
        AND public.has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader']::public.app_role[])
        AND public.is_lead_of((SELECT auth.uid()), broker_id))
  );

-- Gravação idempotente de uma coleta (chamada só pelo servidor; sem acesso a usuários).
CREATE OR REPLACE FUNCTION public.portal_ingest(_org uuid, _portal text, _on date, _window text,
  _items jsonb, _total integer, _started timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _ok int; _err int; _linked int;
BEGIN
  DELETE FROM public.portal_listing_snapshots
   WHERE organization_id = _org AND portal = _portal AND collected_on = _on;
  INSERT INTO public.portal_listing_snapshots (organization_id, portal, collected_on, listing_code, external_id,
    broker_id, window_kind, window_from, window_to, impressions, views, contacts, contacts_detail, error)
  SELECT DISTINCT ON (i.code) _org, _portal, _on, i.code, i.external_id,
    (SELECT p.id FROM public.profiles p WHERE p.organization_id = _org
       AND p.remax_id = substring(i.code from '^([0-9]{9})-')),
    _window, i."from", i."to",
    CASE WHEN i.error IS NULL THEN i.impressions END,
    CASE WHEN i.error IS NULL THEN i.views END,
    CASE WHEN i.error IS NULL THEN i.contacts END,
    i.contacts_detail, i.error
  FROM jsonb_to_recordset(_items) AS i(code text, external_id text, impressions int, views int, contacts int,
    contacts_detail jsonb, error text, "from" date, "to" date)
  WHERE coalesce(i.code, '') <> '';
  SELECT count(*) FILTER (WHERE error IS NULL), count(*) FILTER (WHERE error IS NOT NULL),
         count(*) FILTER (WHERE broker_id IS NOT NULL)
    INTO _ok, _err, _linked
    FROM public.portal_listing_snapshots WHERE organization_id = _org AND portal = _portal AND collected_on = _on;
  INSERT INTO public.portal_collection_runs (organization_id, portal, collected_on, status, listings_total,
    listings_ok, listings_error, message, started_at)
  VALUES (_org, _portal, _on, CASE WHEN _err = 0 THEN 'ok' ELSE 'partial' END, _total, _ok, _err, NULL, _started)
  ON CONFLICT (organization_id, portal, collected_on) DO UPDATE SET status = EXCLUDED.status,
    listings_total = EXCLUDED.listings_total, listings_ok = EXCLUDED.listings_ok,
    listings_error = EXCLUDED.listings_error, message = NULL, started_at = EXCLUDED.started_at, finished_at = now();
  RETURN jsonb_build_object('ok', _ok, 'error', _err, 'linked', _linked);
END $$;

-- Registro de falha total de um portal (relatório sai parcial, admin é avisado).
CREATE OR REPLACE FUNCTION public.portal_mark_failed(_org uuid, _portal text, _on date, _message text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.portal_collection_runs (organization_id, portal, collected_on, status, message)
  VALUES (_org, _portal, _on, 'failed', left(_message, 500))
  ON CONFLICT (organization_id, portal, collected_on) DO UPDATE
    SET status = 'failed', message = EXCLUDED.message, finished_at = now()
    WHERE public.portal_collection_runs.status = 'failed';
$$;

REVOKE ALL ON FUNCTION public.portal_ingest(uuid, text, date, text, jsonb, integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portal_mark_failed(uuid, text, date, text) FROM PUBLIC, anon, authenticated;
