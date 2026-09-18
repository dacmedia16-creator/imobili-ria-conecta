-- Gestores, staff e administradores podem cancelar qualquer reserva da agenda.
-- Líderes mantêm o escopo da própria equipe. A função continua sendo a autoridade única usada pela RPC e pela política de UPDATE.
CREATE OR REPLACE FUNCTION public.can_cancel_room_reservation(
  _responsible_id uuid,
  _actor uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _actor IS NOT NULL AND (
    _actor = _responsible_id
    OR public.has_any_role(
      _actor,
      ARRAY['admin', 'super_admin', 'staff', 'gestor']::public.app_role[]
    )
    OR (
      public.has_any_role(_actor, ARRAY['team_leader']::public.app_role[])
      AND public.is_lead_of(_actor, _responsible_id)
    )
  )
$function$;

REVOKE ALL ON FUNCTION public.can_cancel_room_reservation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_cancel_room_reservation(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.can_cancel_room_reservation(uuid, uuid)
  IS 'Autoriza cancelamento pelo responsável, líder da equipe, gestor, staff ou administrador; gestores, staff e administradores podem cancelar qualquer reserva.';
