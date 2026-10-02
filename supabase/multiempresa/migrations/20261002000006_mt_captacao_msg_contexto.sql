-- Mensagem clara quando o super-admin da plataforma tenta criar captação dentro de outra
-- imobiliária (o perfil dele não pertence a ela). Só muda o texto do erro; o bloqueio continua.
BEGIN;
DO $m$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.exclusive_create(text)'::regprocedure);
  IF position('IF NOT FOUND THEN RAISE EXCEPTION ''Perfil inativo''; END IF;' IN d) = 0 THEN
    RAISE EXCEPTION 'exclusive_create inesperada';
  END IF;
  d := replace(d, 'IF NOT FOUND THEN RAISE EXCEPTION ''Perfil inativo''; END IF;',
    'IF NOT FOUND AND public.platform_current_org() IS NOT NULL THEN RAISE EXCEPTION ''A captação deve ser criada por um corretor desta imobiliária''; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION ''Perfil inativo''; END IF;');
  EXECUTE d;
END $m$;
COMMIT;
