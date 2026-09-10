-- Corrige a permissão do gatilho que verifica bloqueio antes de criar uma reserva.
-- A tabela de penalidades continua sem acesso direto para authenticated;
-- somente o gatilho SECURITY DEFINER pode consultá-la/atualizá-la.
CREATE OR REPLACE FUNCTION public.enforce_room_reservation_booking_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public.enforce_room_reservation_booking_block() FROM PUBLIC;
