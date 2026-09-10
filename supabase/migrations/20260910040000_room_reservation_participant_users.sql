-- Permite selecionar usuários cadastrados como participantes da reserva.
ALTER TABLE public.room_reservations
  ADD COLUMN IF NOT EXISTS participant_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE INDEX IF NOT EXISTS room_reservations_participant_users_idx
  ON public.room_reservations USING gin (participant_user_ids);

-- Lista nomes de usuários ativos sem expor telefones; o telefone permanece somente no job
-- protegido que envia os lembretes pelo WhatsApp.
CREATE OR REPLACE FUNCTION public.list_room_reservation_users()
RETURNS TABLE (id uuid, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id, p.nome
  FROM public.profiles p
  WHERE p.ativo = true
  ORDER BY p.nome NULLS LAST, p.id;
$function$;

REVOKE ALL ON FUNCTION public.list_room_reservation_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_room_reservation_users() TO authenticated;

-- Controle por destinatário: evita reenviar para quem já recebeu caso outro destinatário
-- falhe temporariamente.
CREATE TABLE IF NOT EXISTS public.room_reservation_reminder_deliveries (
  reservation_id uuid NOT NULL REFERENCES public.room_reservations(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  sent_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, recipient_id)
);

ALTER TABLE public.room_reservation_reminder_deliveries ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS room_reservation_reminder_deliveries_pending_idx
  ON public.room_reservation_reminder_deliveries (reservation_id, sent_at);

COMMENT ON COLUMN public.room_reservations.participant_user_ids
  IS 'Usuários cadastrados selecionados para receber o lembrete por WhatsApp.';
COMMENT ON TABLE public.room_reservation_reminder_deliveries
  IS 'Controle interno de entrega do lembrete por destinatário; acesso somente pelo service role.';
