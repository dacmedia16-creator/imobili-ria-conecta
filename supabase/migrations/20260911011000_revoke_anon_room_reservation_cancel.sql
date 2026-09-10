-- Remove uma concessão explícita antiga para anon que pode permanecer mesmo após REVOKE FROM PUBLIC.
-- A função de cancelamento deve ser chamada somente por usuários autenticados.
REVOKE ALL ON FUNCTION public.can_cancel_room_reservation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_cancel_room_reservation(uuid, uuid) TO authenticated;
