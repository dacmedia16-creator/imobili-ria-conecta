-- Rollback da 20261002000005: devolve a captação para exclusive_capture_settings (com o estado
-- atual) e remove o cadastro de módulos. Reservas existentes não são tocadas.
BEGIN;
SET LOCAL search_path TO '';

UPDATE public.exclusive_capture_settings s SET enabled = m.enabled
FROM public.organization_modules m
WHERE m.organization_id = s.organization_id AND m.module = 'captacao_exclusiva'
  AND s.id AND s.enabled IS DISTINCT FROM m.enabled;

DROP POLICY IF EXISTS zz_mt_modulo_reserva_insert ON public.room_reservations;

CREATE OR REPLACE FUNCTION public.exclusive_capture_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT coalesce((SELECT enabled FROM public.exclusive_capture_settings
    WHERE id AND organization_id=public.current_org_id()),false)
$function$;

CREATE OR REPLACE FUNCTION public.exclusive_capture_set_enabled(_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  _actor uuid := auth.uid();
  _current boolean;
BEGIN
  IF _enabled IS NULL OR _actor IS NULL
    OR NOT public.exclusive_actor_active(_actor)
    OR NOT public.has_role(_actor, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Sem permissão para alterar captações exclusivas' USING ERRCODE = '42501';
  END IF;

  SELECT enabled INTO _current FROM public.exclusive_capture_settings WHERE id = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração de captações exclusivas indisponível';
  END IF;
  IF _current IS DISTINCT FROM _enabled THEN
    UPDATE public.exclusive_capture_settings SET enabled = _enabled WHERE id = true;
    INSERT INTO public.exclusive_capture_setting_history (actor_id, action)
    VALUES (_actor, CASE WHEN _enabled THEN 'ligar' ELSE 'desligar' END);
  END IF;
  RETURN _enabled;
END;
$function$;

DROP FUNCTION IF EXISTS public.room_reservation_enabled();
DROP FUNCTION IF EXISTS public.platform_set_organization_module(uuid, text, boolean);
DROP TABLE IF EXISTS public.organization_module_history;
DROP TABLE IF EXISTS public.organization_modules;
COMMIT;
