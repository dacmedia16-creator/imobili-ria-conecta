-- Feedback ao Proprietário: reconhecer o ID RE/MAX também em códigos de anúncio sem hífen
-- (Denis, 08/10/2026). Formatos reais da coleta de 06/10: 630601005-114 (já aceito),
-- 630591279x16, 630601142xx68, 630601337XX6. Só muda a regra que tira os 9 dígitos do código
-- e liga o anúncio ao perfil; visibilidade (RLS), coletor e telas não mudam.
-- Não ligam: ID com menos de 9 dígitos (ex.: 63060113x72), separador sem número depois, outro texto.
-- Rollback: supabase/rollback/20261008230000_portal_remax_id_sem_hifen.sql

-- 1) Coluna gerada (Postgres 17: troca a expressão e recalcula as linhas gravadas).
ALTER TABLE public.portal_listing_snapshots
  ALTER COLUMN remax_id SET EXPRESSION AS (substring(listing_code from '^([0-9]{9})(?:-|[xX]{1,2}[0-9])'));

-- 2) Gravação semanal: mesma regra na hora de ligar ao perfil.
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
       AND p.remax_id = substring(i.code from '^([0-9]{9})(?:-|[xX]{1,2}[0-9])')),
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

-- 3) Acerto das semanas já gravadas: liga ao perfil com o mesmo ID na mesma empresa
--    (mesma regra do trigger portal_relink_broker; anúncios sem perfil seguem "Sem corretor").
UPDATE public.portal_listing_snapshots s
   SET broker_id = p.id
  FROM public.profiles p
 WHERE p.organization_id = s.organization_id
   AND p.remax_id = s.remax_id
   AND s.broker_id IS DISTINCT FROM p.id;
