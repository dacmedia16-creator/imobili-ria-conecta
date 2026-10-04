-- Regressão: reservas futuras não podem sumir da grade por rename/desativação.
-- Executar em homologação depois da migration, sempre dentro de transação revertida.
\set ON_ERROR_STOP 1
SELECT p.id AS actor FROM public.profiles p
JOIN public.user_roles ur ON ur.user_id=p.id AND ur.organization_id=p.organization_id
WHERE p.organization_id=public.legacy_default_org_id()
  AND p.ativo AND ur.role IN ('admin','super_admin')
ORDER BY p.id LIMIT 1 \gset
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'actor', true);
DO $test$
DECLARE
  _org uuid := public.current_org_id();
  _room public.agency_rooms%ROWTYPE;
  _date date := current_date + 90;
  _reservation uuid;
BEGIN
  IF NOT public.agency_can_edit() THEN RAISE EXCEPTION 'Admin de teste sem permissão'; END IF;
  SELECT * INTO STRICT _room FROM public.agency_rooms
    WHERE organization_id=_org AND nome='Barão Sala 1';
  INSERT INTO public.room_reservations
    (room, reserved_date, start_time, end_time, responsible_id, responsible_name, purpose)
    VALUES (_room.nome, _date, '10:00', '11:00', auth.uid(), 'QA homologação', 'Reunião com cliente')
    RETURNING id INTO _reservation;
  -- A sala continua ativa/visível mesmo depois das tentativas de alteração.
  BEGIN
    PERFORM public.agency_room_save(_room.id, 'Nova sala QA', true, _room.ordem);
    RAISE EXCEPTION 'Falha: rename com reserva futura foi aceito';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Esta sala tem reservas futuras.%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.agency_room_save(_room.id, _room.nome, false, _room.ordem);
    RAISE EXCEPTION 'Falha: desativação com reserva futura foi aceita';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Esta sala tem reservas futuras.%' THEN RAISE; END IF;
  END;
  PERFORM public.agency_room_save(_room.id, _room.nome, true, _room.ordem+1);
  IF NOT EXISTS (SELECT 1 FROM public.agency_rooms
    WHERE id=_room.id AND nome=_room.nome AND ativo AND ordem=_room.ordem+1)
  THEN RAISE EXCEPTION 'Sala/ordem alteradas incorretamente'; END IF;
  BEGIN
    INSERT INTO public.room_reservations
      (room, reserved_date, start_time, end_time, responsible_id, responsible_name, purpose)
      VALUES (_room.nome, _date, '10:30', '11:30', auth.uid(), 'QA homologação', 'Reunião com cliente');
    RAISE EXCEPTION 'Falha: segunda reserva no mesmo horário foi aceita';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.room_reservations
      (room, reserved_date, start_time, end_time, responsible_id, responsible_name, purpose)
      VALUES ('Nova sala QA', _date, '10:30', '11:30', auth.uid(), 'QA homologação', 'Reunião com cliente');
    RAISE EXCEPTION 'Falha: reserva em sala inexistente foi aceita';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Sala não cadastrada ou inativa%' THEN RAISE; END IF;
  END;
  UPDATE public.room_reservations SET status='canceled' WHERE id=_reservation;
  PERFORM public.agency_room_save(_room.id, 'Nova sala QA', false, _room.ordem);
  IF NOT EXISTS (SELECT 1 FROM public.agency_rooms
    WHERE id=_room.id AND nome='Nova sala QA' AND NOT ativo)
  THEN RAISE EXCEPTION 'Rename/desativação após cancelamento não funcionaram'; END IF;
  BEGIN
    INSERT INTO public.room_reservations
      (room, reserved_date, start_time, end_time, responsible_id, responsible_name, purpose)
      VALUES ('Nova sala QA', _date, '10:30', '11:30', auth.uid(), 'QA homologação', 'Reunião com cliente');
    RAISE EXCEPTION 'Falha: reserva em sala inativa foi aceita';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Sala não cadastrada ou inativa%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: rename, desativação, conflito, cancelamento, sala inativa';
END $test$;
ROLLBACK;
