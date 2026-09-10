-- Amplia as finalidades aceitas pela agenda de salas sem alterar reservas existentes.
ALTER TABLE public.room_reservations
  DROP CONSTRAINT IF EXISTS room_reservations_purpose_check;

ALTER TABLE public.room_reservations
  ADD CONSTRAINT room_reservations_purpose_check CHECK (purpose IN (
    'Reunião com cliente',
    'Reunião de equipe',
    'Treinamento',
    'Atendimento jurídico',
    'Parceria',
    'FIC',
    'Fotos',
    'Diretoria',
    'Outra finalidade'
  ));
