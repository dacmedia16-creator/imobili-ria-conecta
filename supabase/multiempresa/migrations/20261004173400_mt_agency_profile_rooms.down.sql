-- Rollback controlado: NÃO remove reservas nem converte salas de outras imobiliárias.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.room_reservations r
    WHERE r.room NOT IN ('Barão Sala 1','Barão Sala 2','Barão Sala 3','Barão Sala 4',
      'Barão CT','Campolim Sala 1','Campolim Sala 2')) THEN
    RAISE EXCEPTION 'Rollback bloqueado: reservas usam novas salas; conciliar antes';
  END IF;
END $$;
DROP TRIGGER trg_02_agency_room ON public.room_reservations;
DROP FUNCTION public.enforce_agency_room_reservation();
ALTER TABLE public.room_reservations ADD CONSTRAINT room_reservations_room_check CHECK (room IN (
  'Barão Sala 1','Barão Sala 2','Barão Sala 3','Barão Sala 4','Barão CT',
  'Campolim Sala 1','Campolim Sala 2'
));
DROP FUNCTION public.agency_profile_save(jsonb);
DROP FUNCTION public.agency_room_save(uuid,text,boolean,integer);
DROP FUNCTION public.agency_can_edit();
DROP TRIGGER trg_zz_pc_audit ON public.agency_rooms;
DROP TABLE public.agency_rooms;
DROP POLICY mt_1b_definer_agency ON public.organizations;
REVOKE ALL ON public.organizations FROM mt_1b_definer;
ALTER TABLE public.organizations DROP COLUMN razao_social, DROP COLUMN creci, DROP COLUMN cidade, DROP COLUMN uf;
COMMIT;
