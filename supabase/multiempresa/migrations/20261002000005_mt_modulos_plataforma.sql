-- Módulos por imobiliária controlados SOMENTE pelo super-admin da plataforma (platform_admins).
-- Módulos: captacao_exclusiva (antes em exclusive_capture_settings) e reserva_salas (novo).
-- O super_admin de agência deixa de ligar/desligar a captação.
-- Estado atual preservado: captação copia exclusive_capture_settings; reserva_salas nasce ligada
-- nas imobiliárias existentes. Novas imobiliárias começam com tudo desligado.
-- Reversão: 20261002000005_mt_modulos_plataforma.down.sql.
BEGIN;
SET LOCAL search_path TO '';

CREATE TABLE public.organization_modules (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (module IN ('captacao_exclusiva', 'reserva_salas')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (organization_id, module)
);

CREATE TABLE public.organization_module_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module text NOT NULL,
  enabled boolean NOT NULL,
  actor_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_module_history_org_idx
  ON public.organization_module_history (organization_id, changed_at DESC);

ALTER TABLE public.organization_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_module_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_modules, public.organization_module_history
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_modules, public.organization_module_history TO service_role;
GRANT SELECT ON public.organization_modules TO authenticated;
-- Leitura: a própria imobiliária ou o super-admin da plataforma. Escrita: só pelas RPCs abaixo.
CREATE POLICY organization_modules_read ON public.organization_modules
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.current_org_id())
         OR (SELECT public.is_platform_super_admin(auth.uid())));

INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, 'captacao_exclusiva', coalesce(s.enabled, false)
FROM public.organizations o
LEFT JOIN public.exclusive_capture_settings s ON s.organization_id = o.id AND s.id;
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, 'reserva_salas', true FROM public.organizations o;

-- Única porta de escrita: confere platform_admins no banco (não depende da tela).
CREATE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas') OR _enabled IS NULL THEN
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
REVOKE ALL ON FUNCTION public.platform_set_organization_module(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_organization_module(uuid, text, boolean)
  TO authenticated, service_role, mt_1b_definer;

CREATE FUNCTION public.room_reservation_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'reserva_salas'), false)
$$;
REVOKE ALL ON FUNCTION public.room_reservation_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.room_reservation_enabled() TO authenticated, service_role, mt_1b_definer;

-- Captação passa a ler o mesmo cadastro de módulos (assinaturas e grants preservados).
CREATE OR REPLACE FUNCTION public.exclusive_capture_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'captacao_exclusiva'), false)
$$;

CREATE OR REPLACE FUNCTION public.exclusive_capture_set_enabled(_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para alterar captações exclusivas' USING ERRCODE = '42501';
  END IF;
  RETURN public.platform_set_organization_module(public.current_org_id(), 'captacao_exclusiva', _enabled);
END $$;

-- Módulo desligado: ninguém cria reserva (as existentes ficam guardadas).
CREATE POLICY zz_mt_modulo_reserva_insert ON public.room_reservations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.room_reservation_enabled()));

COMMIT;
