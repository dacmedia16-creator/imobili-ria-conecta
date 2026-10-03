BEGIN;
DROP FUNCTION IF EXISTS public.exclusive_set_geo(uuid,text,double precision,double precision);
ALTER TABLE public.exclusive_captures DROP COLUMN IF EXISTS geo_lat, DROP COLUMN IF EXISTS geo_lon, DROP COLUMN IF EXISTS geo_key;
COMMIT;
