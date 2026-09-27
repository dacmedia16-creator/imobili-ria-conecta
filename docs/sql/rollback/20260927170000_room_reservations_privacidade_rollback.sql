-- Rollback: volta a leitura aberta a todos os autenticados (situação anterior, insegura).
DROP POLICY IF EXISTS room_reservations_select_scope ON public.room_reservations;
CREATE POLICY room_reservations_select_authenticated
  ON public.room_reservations FOR SELECT TO authenticated USING (true);
DROP FUNCTION IF EXISTS public.list_room_occupancy();
DROP FUNCTION IF EXISTS public.can_view_room_reservation(uuid, uuid[], uuid);
