-- Permite cancelar a qualquer momento e aplica penalidade por cancelamentos tardios.
-- Um cancelamento tardio ocorre depois de 1 hora da criação da reserva.
ALTER TABLE public.room_reservations
  ADD COLUMN IF NOT EXISTS late_cancellation boolean NOT NULL DEFAULT false;

ALTER TABLE public.room_reservations
  ALTER COLUMN cancellation_deadline_minutes SET DEFAULT 0;

UPDATE public.room_reservations
SET cancellation_deadline_minutes = 0
WHERE cancellation_deadline_minutes <> 0;

CREATE TABLE IF NOT EXISTS public.room_reservation_cancellation_penalties (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  late_cancellation_count integer NOT NULL DEFAULT 0 CHECK (late_cancellation_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.room_reservation_cancellation_penalties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.room_reservation_cancellation_penalties FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_room_reservation_cancellation_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'canceled' AND NEW.status <> 'canceled' THEN
    RAISE EXCEPTION 'room_reservation_cannot_be_reactivated'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'confirmed' AND NEW.status = 'canceled' THEN
    IF current_setting('app.room_reservation_cancellation', true) <> 'on' THEN
      RAISE EXCEPTION 'room_reservation_cancellation_must_use_function'
        USING ERRCODE = '22023';
    END IF;

    NEW.canceled_at := coalesce(NEW.canceled_at, now());
    NEW.canceled_by := coalesce(NEW.canceled_by, (select auth.uid()));
  END IF;

  IF OLD.late_cancellation IS DISTINCT FROM NEW.late_cancellation
     AND current_setting('app.room_reservation_cancellation', true) <> 'on' THEN
    RAISE EXCEPTION 'room_reservation_late_cancellation_is_read_only'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_room_reservation_booking_block()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  penalty public.room_reservation_cancellation_penalties%ROWTYPE;
  actor uuid := (select auth.uid());
BEGIN
  IF actor IS NULL OR NEW.responsible_id <> actor THEN
    RETURN NEW;
  END IF;

  SELECT * INTO penalty
  FROM public.room_reservation_cancellation_penalties
  WHERE user_id = actor
  FOR UPDATE;

  IF penalty.blocked_until IS NOT NULL AND penalty.blocked_until > now() THEN
    RAISE EXCEPTION 'room_reservation_user_blocked'
      USING ERRCODE = '42501', DETAIL = penalty.blocked_until::text;
  END IF;

  IF penalty.user_id IS NOT NULL AND penalty.blocked_until IS NOT NULL
     AND penalty.blocked_until <= now() THEN
    UPDATE public.room_reservation_cancellation_penalties
    SET late_cancellation_count = 0,
        blocked_until = NULL,
        updated_at = now()
    WHERE user_id = actor;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_room_reservations_booking_block ON public.room_reservations;
CREATE TRIGGER trg_room_reservations_booking_block
  BEFORE INSERT ON public.room_reservations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_room_reservation_booking_block();

CREATE OR REPLACE FUNCTION public.get_room_reservation_cancellation_status(
  _user uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  late_cancellation_count integer,
  remaining_cancellations integer,
  blocked_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN p.blocked_until IS NOT NULL AND p.blocked_until <= now() THEN 0
      ELSE coalesce(p.late_cancellation_count, 0)
    END,
    CASE
      WHEN p.blocked_until IS NOT NULL AND p.blocked_until > now() THEN 0
      WHEN p.blocked_until IS NOT NULL AND p.blocked_until <= now() THEN 3
      ELSE greatest(0, 3 - coalesce(p.late_cancellation_count, 0))
    END,
    CASE WHEN p.blocked_until > now() THEN p.blocked_until ELSE NULL END
  FROM (SELECT _user AS user_id) actor
  LEFT JOIN public.room_reservation_cancellation_penalties p ON p.user_id = actor.user_id
  WHERE actor.user_id = auth.uid();
$function$;

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
  WHERE id = reservation.id;

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

REVOKE ALL ON FUNCTION public.get_room_reservation_cancellation_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_reservation_cancellation_status(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_room_reservation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_room_reservation(uuid) TO authenticated;

COMMENT ON COLUMN public.room_reservations.cancellation_deadline_minutes IS 'Campo legado; cancelamentos são permitidos a qualquer momento.';
COMMENT ON COLUMN public.room_reservations.late_cancellation IS 'Verdadeiro quando o responsável cancelou mais de uma hora após a criação.';
COMMENT ON TABLE public.room_reservation_cancellation_penalties IS 'Contagem de cancelamentos tardios e bloqueio temporário para novas reservas.';
