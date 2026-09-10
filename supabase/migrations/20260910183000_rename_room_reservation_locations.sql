-- Renomeia as salas antigas para a unidade Barão e adiciona as salas da unidade Campolim.
ALTER TABLE public.room_reservations
  DROP CONSTRAINT IF EXISTS room_reservations_room_check;

UPDATE public.room_reservations
SET room = CASE room
  WHEN 'Sala 1' THEN 'Barão Sala 1'
  WHEN 'Sala 2' THEN 'Barão Sala 2'
  WHEN 'Sala 3' THEN 'Barão Sala 3'
  WHEN 'Sala 4' THEN 'Barão Sala 4'
  WHEN 'CT' THEN 'Barão CT'
  ELSE room
END
WHERE room IN ('Sala 1', 'Sala 2', 'Sala 3', 'Sala 4', 'CT');

ALTER TABLE public.room_reservations
  ADD CONSTRAINT room_reservations_room_check CHECK (room IN (
    'Barão Sala 1',
    'Barão Sala 2',
    'Barão Sala 3',
    'Barão Sala 4',
    'Barão CT',
    'Campolim Sala 1',
    'Campolim Sala 2'
  ));
