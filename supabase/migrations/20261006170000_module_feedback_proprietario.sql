-- Módulo "Feedback ao proprietário" por imobiliária (liga/desliga só pelo super-admin da plataforma).
-- Desligado: menu some, rota bloqueia, o banco não entrega os números e a coleta não grava.
-- Os dados já coletados ficam guardados e voltam ao religar.
-- Estado inicial: ligado só na Única Escolha.

ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario')
     OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT enabled INTO _current FROM public.organization_modules
    WHERE organization_id = _org AND module = _module FOR UPDATE;
  IF _current IS NOT DISTINCT FROM _enabled THEN RETURN _enabled; END IF;
  INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (_org, _module, _enabled, now(), _actor)
  ON CONFLICT (organization_id, module)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = _actor;
  INSERT INTO public.organization_module_history (organization_id, module, enabled, actor_id)
  VALUES (_org, _module, _enabled, _actor);
  RETURN _enabled;
END $$;

CREATE OR REPLACE FUNCTION public.owner_feedback_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'feedback_proprietario'), false)
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_enabled() TO authenticated, service_role;

-- Módulo desligado: ninguém lê os números (dados ficam guardados).
DROP POLICY IF EXISTS zz_mt_modulo_feedback_read ON public.portal_listing_snapshots;
CREATE POLICY zz_mt_modulo_feedback_read ON public.portal_listing_snapshots
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.owner_feedback_enabled()));

-- Coletor: diz se deve gravar para a imobiliária (só servidor).
CREATE OR REPLACE FUNCTION public.portal_module_enabled(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = _org AND module = 'feedback_proprietario'), false)
$$;
REVOKE ALL ON FUNCTION public.portal_module_enabled(uuid) FROM PUBLIC, anon, authenticated;

INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, 'feedback_proprietario', o.id = '00000000-0000-4000-8000-000000000001'::uuid
FROM public.organizations o
ON CONFLICT (organization_id, module) DO NOTHING;
