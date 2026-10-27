-- Regra de Denis 27/10/2026 (t_9f18ff47): staff nunca fica bloqueado nas salas de reunião.
-- A checagem usa o papel ATUAL (has_any_role), não uma limpeza única: quem vira staff
-- depois de ser bloqueado volta a reservar na hora, sem apagar o registro de penalidade.
-- Os demais papéis continuam com a regra de 3 cancelamentos tardios → 7 dias de bloqueio.
-- Rollback: supabase/rollback/20261027190000_salas_staff_nunca_bloqueado.sql
BEGIN;

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

  -- Staff não tem bloqueio por cancelamento (papel atual; o registro não é alterado).
  IF public.has_any_role(actor, ARRAY['staff']::public.app_role[]) THEN
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
      WHEN actor.is_staff THEN 0
      WHEN p.blocked_until IS NOT NULL AND p.blocked_until <= now() THEN 0
      ELSE coalesce(p.late_cancellation_count, 0)
    END,
    CASE
      WHEN actor.is_staff THEN 3
      WHEN p.blocked_until IS NOT NULL AND p.blocked_until > now() THEN 0
      WHEN p.blocked_until IS NOT NULL AND p.blocked_until <= now() THEN 3
      ELSE greatest(0, 3 - coalesce(p.late_cancellation_count, 0))
    END,
    CASE
      WHEN actor.is_staff THEN NULL
      WHEN p.blocked_until > now() THEN p.blocked_until
      ELSE NULL
    END
  FROM (
    SELECT _user AS user_id,
           public.has_any_role(_user, ARRAY['staff']::public.app_role[]) AS is_staff
  ) actor
  LEFT JOIN public.room_reservation_cancellation_penalties p ON p.user_id = actor.user_id
  WHERE actor.user_id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.get_room_reservation_cancellation_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_reservation_cancellation_status(uuid) TO authenticated;

COMMIT;
