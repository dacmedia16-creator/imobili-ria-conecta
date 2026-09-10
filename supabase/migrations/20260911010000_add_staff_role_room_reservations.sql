-- Papel operacional para a agenda de salas.
-- Staff pode usar a Reserva de sala e cancelar reservas de qualquer usuário,
-- sem receber permissões administrativas nas demais áreas do sistema.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'staff';

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
    OR public.has_any_role(_actor, ARRAY['admin', 'super_admin', 'staff']::public.app_role[])
    OR (
      public.has_any_role(_actor, ARRAY['gestor', 'team_leader']::public.app_role[])
      AND public.is_lead_of(_actor, _responsible_id)
    )
  )
$function$;

REVOKE ALL ON FUNCTION public.can_cancel_room_reservation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_cancel_room_reservation(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.can_cancel_room_reservation(uuid, uuid)
  IS 'Autoriza cancelamento pelo responsável, Staff, liderança da equipe ou administrador.';
