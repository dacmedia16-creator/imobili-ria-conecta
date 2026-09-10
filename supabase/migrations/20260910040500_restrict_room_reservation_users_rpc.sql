-- A listagem de usuários da reserva não deve ficar disponível para acesso anônimo.
REVOKE EXECUTE ON FUNCTION public.list_room_reservation_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_room_reservation_users() TO authenticated;
