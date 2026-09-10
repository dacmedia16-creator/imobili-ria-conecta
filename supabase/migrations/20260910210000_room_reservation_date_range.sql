-- Permite reservas recorrentes por intervalo de datas, mantendo cada dia
-- como uma linha para preservar o bloqueio de conflitos existente.
ALTER TABLE public.room_reservations
  ADD COLUMN IF NOT EXISTS reservation_group_id uuid;

UPDATE public.room_reservations
SET reservation_group_id = gen_random_uuid()
WHERE reservation_group_id IS NULL;

ALTER TABLE public.room_reservations
  ALTER COLUMN reservation_group_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN reservation_group_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS room_reservations_group_idx
  ON public.room_reservations (reservation_group_id, reserved_date);

CREATE OR REPLACE FUNCTION public.cancel_room_reservation(_reservation_id uuid)
RETURNS TABLE (
  was_late_cancellation boolean,
  late_cancellation_count integer,
  remaining_cancellations integer,
  blocked_until timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  reservation public.room_reservations%ROWTYPE;
  actor uuid := (select auth.uid());
  penalty public.room_reservation_cancellation_penalties%ROWTYPE;
  late boolean;
  count_after integer;
  block_after timestamptz;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'room_reservation_authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO reservation
  FROM public.room_reservations
  WHERE id = _reservation_id
  FOR UPDATE;

  IF reservation.id IS NULL THEN
    RAISE EXCEPTION 'room_reservation_not_found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_cancel_room_reservation(reservation.responsible_id, actor) THEN
    RAISE EXCEPTION 'room_reservation_cancellation_not_allowed' USING ERRCODE = '42501';
  END IF;

  IF reservation.status <> 'confirmed' THEN
    RAISE EXCEPTION 'room_reservation_already_canceled' USING ERRCODE = '22023';
  END IF;

  late := actor = reservation.responsible_id
    AND now() > reservation.created_at + interval '1 hour';

  PERFORM set_config('app.room_reservation_cancellation', 'on', true);
  UPDATE public.room_reservations
  SET status = 'canceled',
      canceled_at = now(),
      canceled_by = actor,
      late_cancellation = late,
      updated_at = now()
  WHERE reservation_group_id = reservation.reservation_group_id
    AND status = 'confirmed';

  IF late THEN
    SELECT * INTO penalty
    FROM public.room_reservation_cancellation_penalties
    WHERE user_id = actor
    FOR UPDATE;

    IF penalty.user_id IS NULL THEN
      INSERT INTO public.room_reservation_cancellation_penalties (
        user_id, late_cancellation_count, blocked_until, updated_at
      ) VALUES (actor, 1, NULL, now())
      RETURNING * INTO penalty;
    ELSE
      count_after := CASE
        WHEN penalty.blocked_until IS NOT NULL AND penalty.blocked_until <= now() THEN 1
        ELSE penalty.late_cancellation_count + 1
      END;
      block_after := CASE
        WHEN penalty.blocked_until IS NOT NULL AND penalty.blocked_until > now() THEN penalty.blocked_until
        WHEN count_after >= 3 THEN now() + interval '7 days'
        ELSE NULL
      END;
      UPDATE public.room_reservation_cancellation_penalties
      SET late_cancellation_count = count_after,
          blocked_until = block_after,
          updated_at = now()
      WHERE user_id = actor
      RETURNING * INTO penalty;
    END IF;
  END IF;

  SELECT s.late_cancellation_count, s.remaining_cancellations, s.blocked_until
  INTO late_cancellation_count, remaining_cancellations, blocked_until
  FROM public.get_room_reservation_cancellation_status(actor) s;

  was_late_cancellation := late;
  RETURN NEXT;
END;
$function$;

COMMENT ON COLUMN public.room_reservations.reservation_group_id IS 'Identifica os dias que pertencem ao mesmo período de reserva.';
