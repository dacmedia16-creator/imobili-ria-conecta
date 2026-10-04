-- Homologação apenas. A migration anterior já está aplicada; esta correção mantém o dono
-- mt_1b_definer e não altera nem renomeia reservas existentes.
BEGIN;
CREATE OR REPLACE FUNCTION public.agency_room_save(_id uuid, _nome text, _ativo boolean, _ordem integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _org uuid := public.current_org_id();
  _result uuid;
  _previous record;
  _next_name text := btrim(_nome);
BEGIN
  IF NOT public.agency_can_edit() THEN
    RAISE EXCEPTION 'Sem permissão para editar salas' USING ERRCODE='42501';
  END IF;
  IF _nome IS NULL OR length(_next_name) NOT BETWEEN 2 AND 80 OR _ordem IS NULL OR _ordem < 0 THEN
    RAISE EXCEPTION 'Dados da sala inválidos' USING ERRCODE='22023';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.agency_rooms (organization_id,nome,ativo,ordem)
    VALUES (_org,_next_name,coalesce(_ativo,true),_ordem) RETURNING id INTO _result;
  ELSE
    -- A reserva toma FOR SHARE da mesma sala: nenhum insert confirmado pode correr
    -- entre a checagem abaixo e o rename/desativação.
    SELECT nome, ativo INTO _previous FROM public.agency_rooms
    WHERE id=_id AND organization_id=_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sala não encontrada' USING ERRCODE='42501'; END IF;
    IF (_next_name IS DISTINCT FROM _previous.nome OR
        (_previous.ativo AND NOT coalesce(_ativo,_previous.ativo))) AND EXISTS (
      SELECT 1 FROM public.room_reservations r
      WHERE r.organization_id=_org AND r.room=_previous.nome AND r.status='confirmed'
        AND (r.reserved_date + r.end_time) > (now() AT TIME ZONE 'America/Sao_Paulo')
    ) THEN
      RAISE EXCEPTION 'Esta sala tem reservas futuras. Cancele ou aguarde as reservas futuras para renomear ou desativar.'
        USING ERRCODE='23514';
    END IF;
    UPDATE public.agency_rooms SET nome=_next_name,ativo=coalesce(_ativo,ativo),ordem=_ordem
    WHERE id=_id AND organization_id=_org RETURNING id INTO _result;
  END IF;
  RETURN _result;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_agency_room_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    -- Compartilha o lock com agency_room_save para impedir reservas novas na
    -- sala antiga enquanto ela está sendo renomeada ou desativada.
    PERFORM 1 FROM public.agency_rooms r
    WHERE r.organization_id=NEW.organization_id AND r.nome=NEW.room AND r.ativo
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sala não cadastrada ou inativa nesta imobiliária' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER trg_02_agency_room ON public.room_reservations;
CREATE TRIGGER trg_02_agency_room BEFORE INSERT OR UPDATE OF room, organization_id, status, reserved_date, start_time, end_time
  ON public.room_reservations FOR EACH ROW EXECUTE FUNCTION public.enforce_agency_room_reservation();
COMMIT;
