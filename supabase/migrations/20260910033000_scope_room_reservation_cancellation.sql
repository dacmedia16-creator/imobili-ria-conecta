-- Restringe o cancelamento de reservas ao escopo correto de cada papel.
-- Administradores cancelam qualquer reserva; gestores/líderes somente a própria equipe
-- (incluindo a subequipe prevista por is_lead_of); demais usuários somente as próprias.
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
    OR public.has_any_role(_actor, ARRAY['admin', 'super_admin']::public.app_role[])
    OR (
      public.has_any_role(_actor, ARRAY['gestor', 'team_leader']::public.app_role[])
      AND public.is_lead_of(_actor, _responsible_id)
    )
  )
$function$;

REVOKE ALL ON FUNCTION public.can_cancel_room_reservation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_cancel_room_reservation(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS room_reservations_update_own_or_manager ON public.room_reservations;
CREATE POLICY room_reservations_update_cancel_scope
  ON public.room_reservations FOR UPDATE TO authenticated
  USING (public.can_cancel_room_reservation(responsible_id, (select auth.uid())))
  WITH CHECK (public.can_cancel_room_reservation(responsible_id, (select auth.uid())));

COMMENT ON FUNCTION public.can_cancel_room_reservation(uuid, uuid)
  IS 'Autoriza cancelamento pelo responsável, liderança da equipe ou administrador.';
