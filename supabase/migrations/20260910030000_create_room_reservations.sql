-- Reservas de salas do escritório.
-- O conflito é garantido no banco, não apenas na interface.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.room_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room text NOT NULL CHECK (room IN ('Sala 1', 'Sala 2', 'Sala 3', 'Sala 4', 'CT')),
  reserved_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  responsible_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  responsible_name text NOT NULL CHECK (length(trim(responsible_name)) > 0),
  participants text[] NOT NULL DEFAULT '{}',
  purpose text NOT NULL CHECK (purpose IN (
    'Reunião com cliente',
    'Reunião de equipe',
    'Treinamento',
    'Atendimento jurídico',
    'Parceria',
    'Outra finalidade'
  )),
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'canceled')),
  cancellation_deadline_minutes integer NOT NULL DEFAULT 60 CHECK (cancellation_deadline_minutes >= 0),
  reminder_minutes_before integer NOT NULL DEFAULT 30 CHECK (reminder_minutes_before >= 0),
  reminder_sent_at timestamptz,
  canceled_at timestamptz,
  canceled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_reservations_valid_time CHECK (end_time > start_time)
);

ALTER TABLE public.room_reservations
  ADD CONSTRAINT room_reservations_no_overlap
  EXCLUDE USING gist (
    room WITH =,
    tsrange(
      reserved_date + start_time,
      reserved_date + end_time,
      '[)'
    ) WITH &&
  ) WHERE (status = 'confirmed');

CREATE INDEX room_reservations_date_idx
  ON public.room_reservations (reserved_date, room, start_time);
CREATE INDEX room_reservations_responsible_idx
  ON public.room_reservations (responsible_id, reserved_date DESC);

CREATE TRIGGER trg_room_reservations_updated
  BEFORE UPDATE ON public.room_reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_room_reservation_cancellation_deadline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'confirmed'
     AND NEW.status = 'canceled'
     AND now() > (
       (NEW.reserved_date + NEW.start_time)
       - make_interval(mins => NEW.cancellation_deadline_minutes)
     ) THEN
    RAISE EXCEPTION 'room_reservation_cancellation_deadline_passed'
      USING ERRCODE = '22023';
  END IF;

  IF OLD.status = 'confirmed' AND NEW.status = 'canceled' THEN
    NEW.canceled_at := coalesce(NEW.canceled_at, now());
    NEW.canceled_by := coalesce(NEW.canceled_by, (select auth.uid()));
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_room_reservations_cancellation_deadline
  BEFORE UPDATE ON public.room_reservations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_room_reservation_cancellation_deadline();

ALTER TABLE public.room_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY room_reservations_select_authenticated
  ON public.room_reservations FOR SELECT TO authenticated
  USING (true);

CREATE POLICY room_reservations_insert_own
  ON public.room_reservations FOR INSERT TO authenticated
  WITH CHECK (responsible_id = (select auth.uid()));

CREATE POLICY room_reservations_update_own_or_manager
  ON public.room_reservations FOR UPDATE TO authenticated
  USING (
    responsible_id = (select auth.uid())
    OR public.has_any_role((select auth.uid()), ARRAY['gestor', 'team_leader', 'admin', 'super_admin']::public.app_role[])
  )
  WITH CHECK (
    responsible_id = (select auth.uid())
    OR public.has_any_role((select auth.uid()), ARRAY['gestor', 'team_leader', 'admin', 'super_admin']::public.app_role[])
  );

COMMENT ON TABLE public.room_reservations IS 'Reservas de salas com bloqueio transacional de horários duplicados.';
COMMENT ON COLUMN public.room_reservations.cancellation_deadline_minutes IS 'Limite em minutos antes do início para cancelamento.';
COMMENT ON COLUMN public.room_reservations.reminder_sent_at IS 'Preenchido futuramente pelo job de avisos; não dispara mensagens nesta migration.';
