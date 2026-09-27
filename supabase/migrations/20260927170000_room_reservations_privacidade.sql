-- Reservas de sala: privacidade dos detalhes.
-- Admin, super_admin, staff e gestor veem todas as reservas completas.
-- Líder vê as da própria equipe (mesmo escopo que já tinha para cancelar).
-- Demais usuários veem completas só as próprias ou em que foram marcados como participantes.
-- Para a grade de disponibilidade, todos veem apenas sala, data, horário e quem reservou (RPC abaixo).

CREATE OR REPLACE FUNCTION public.can_view_room_reservation(
  _responsible_id uuid,
  _participant_user_ids uuid[],
  _actor uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _actor IS NOT NULL AND (
    _actor = _responsible_id
    OR _actor = ANY(COALESCE(_participant_user_ids, ARRAY[]::uuid[]))
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

REVOKE ALL ON FUNCTION public.can_view_room_reservation(uuid, uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_room_reservation(uuid, uuid[], uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS room_reservations_select_authenticated ON public.room_reservations;
DROP POLICY IF EXISTS room_reservations_select_scope ON public.room_reservations;
CREATE POLICY room_reservations_select_scope
  ON public.room_reservations
  FOR SELECT
  TO authenticated
  USING (public.can_view_room_reservation(responsible_id, participant_user_ids, (SELECT auth.uid())));

-- Grade de ocupação: somente campos necessários para saber se a sala está livre e quem reservou.
CREATE OR REPLACE FUNCTION public.list_room_occupancy()
RETURNS TABLE (
  id uuid,
  reservation_group_id uuid,
  room text,
  reserved_date date,
  start_time time,
  end_time time,
  responsible_id uuid,
  responsible_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r.id, r.reservation_group_id, r.room, r.reserved_date, r.start_time, r.end_time,
         r.responsible_id, COALESCE(NULLIF(btrim(p.nome), ''), r.responsible_name)
  FROM public.room_reservations r
  LEFT JOIN public.profiles p ON p.id = r.responsible_id
  WHERE r.status = 'confirmed'
    AND public.is_active_user(auth.uid())
  ORDER BY r.reserved_date, r.start_time;
$function$;

REVOKE ALL ON FUNCTION public.list_room_occupancy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_room_occupancy() TO authenticated, service_role;
