-- Rollback de 20261008230000_portal_remax_id_sem_hifen.sql (volta a exigir hífen no código).
-- Os anúncios sem hífen voltam a "Sem corretor"; números e coletas não mudam.
-- Depois de rodar, remover a linha 20261008230000 de supabase_migrations.schema_migrations.
BEGIN;

ALTER TABLE public.portal_listing_snapshots
  ALTER COLUMN remax_id SET EXPRESSION AS (substring(listing_code from '^([0-9]{9})-'));

UPDATE public.portal_listing_snapshots
   SET broker_id = NULL
 WHERE broker_id IS NOT NULL AND remax_id IS NULL;

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
REVOKE ALL ON FUNCTION public.portal_ingest(uuid, text, date, text, jsonb, integer, timestamptz) FROM PUBLIC, anon, authenticated;

COMMIT;
