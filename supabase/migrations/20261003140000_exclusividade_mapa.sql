-- Mapa das captações: guarda a coordenada (lat/lon) de cada captação, obtida do endereço do imóvel
-- (rua, número, bairro, cidade — nunca dado de proprietário) via OpenStreetMap/Nominatim no navegador.
-- geo_key = endereço normalizado usado na consulta; se o endereço mudar, o mapa refaz a busca.
-- Gravação só por função definer (quem pode ver a captação). Rollback: docs/sql/rollback/20261003140000_exclusividade_mapa.rollback.sql
BEGIN;
ALTER TABLE public.exclusive_captures
  ADD COLUMN geo_lat double precision,
  ADD COLUMN geo_lon double precision,
  ADD COLUMN geo_key text;

CREATE FUNCTION public.exclusive_set_geo(_id uuid, _key text, _lat double precision, _lon double precision)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Ação não permitida'; END IF;
  IF _key IS NULL OR length(_key) > 500 THEN RAISE EXCEPTION 'Endereço inválido'; END IF;
  IF (_lat IS NULL) <> (_lon IS NULL) OR _lat NOT BETWEEN -90 AND 90 OR _lon NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Coordenada inválida';
  END IF;
  UPDATE public.exclusive_captures SET geo_lat=_lat, geo_lon=_lon, geo_key=_key WHERE id=_id;
END $function$;
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_set_geo(uuid,text,double precision,double precision) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.exclusive_set_geo(uuid,text,double precision,double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_set_geo(uuid,text,double precision,double precision) TO authenticated, service_role;
COMMIT;
