BEGIN;
DO $m$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.exclusive_create(text)'::regprocedure);
  d := replace(d, 'IF NOT FOUND AND public.platform_current_org() IS NOT NULL THEN RAISE EXCEPTION ''A captação deve ser criada por um corretor desta imobiliária''; END IF;
  ', '');
  EXECUTE d;
END $m$;
COMMIT;
