-- Rollback da Fase 2h: restaura exatamente as duas funções de reserva anteriores (estado 2e/2g).
-- Não mexe em dados. Rodar ANTES do down da 2g.
BEGIN;
DO $$ DECLARE f record; BEGIN
  IF (SELECT count(*) FROM public.mt_2h_backup) <> 2 THEN
    RAISE EXCEPTION 'Snapshot 2h incompleto';
  END IF;
  FOR f IN SELECT * FROM public.mt_2h_backup LOOP
    EXECUTE f.ddl;
    IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = f.name::regprocedure) <> f.owner_name
       OR (SELECT proacl::text FROM pg_proc WHERE oid = f.name::regprocedure) IS DISTINCT FROM f.acl THEN
      RAISE EXCEPTION 'Dono/ACL divergente apos rollback 2h: %', f.name;
    END IF;
  END LOOP;
END $$;
COMMENT ON FUNCTION public.can_cancel_room_reservation(uuid, uuid)
  IS 'Autoriza cancelamento pelo responsável, líder da equipe, gestor, staff ou administrador; gestores, staff e administradores podem cancelar qualquer reserva.';
DROP TABLE public.mt_2h_backup;
COMMIT;
