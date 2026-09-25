-- Controle administrativo independente da flag do módulo: deve permitir desligar mesmo quando off.
-- Aplicar apenas após autorização de release; a migração não altera enabled.
CREATE TABLE public.exclusive_capture_setting_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (action IN ('ligar', 'desligar'))
);
REVOKE ALL ON public.exclusive_capture_setting_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.exclusive_capture_setting_history TO service_role;

CREATE FUNCTION public.exclusive_capture_set_enabled(_enabled boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;
REVOKE ALL ON FUNCTION public.exclusive_capture_set_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_capture_set_enabled(boolean) TO authenticated;
