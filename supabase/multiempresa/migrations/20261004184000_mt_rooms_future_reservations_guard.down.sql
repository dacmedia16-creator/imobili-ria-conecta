-- Reverte apenas a trava de reservas futuras. Aplicar antes do down de 20261004173400.
BEGIN;
CREATE OR REPLACE FUNCTION public.agency_room_save(_id uuid, _nome text, _ativo boolean, _ordem integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id(); _result uuid;
BEGIN
  IF NOT public.agency_can_edit() THEN
    RAISE EXCEPTION 'Sem permissão para editar salas' USING ERRCODE='42501';
  END IF;
  IF _nome IS NULL OR length(btrim(_nome)) NOT BETWEEN 2 AND 80 OR _ordem IS NULL OR _ordem < 0 THEN
    RAISE EXCEPTION 'Dados da sala inválidos' USING ERRCODE='22023';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.agency_rooms (organization_id,nome,ativo,ordem)
    VALUES (_org,btrim(_nome),coalesce(_ativo,true),_ordem) RETURNING id INTO _result;
  ELSE
    UPDATE public.agency_rooms SET nome=btrim(_nome),ativo=coalesce(_ativo,ativo),ordem=_ordem
    WHERE id=_id AND organization_id=_org RETURNING id INTO _result;
    IF _result IS NULL THEN RAISE EXCEPTION 'Sala não encontrada' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN _result;
END $$;
CREATE OR REPLACE FUNCTION public.enforce_agency_room_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'confirmed' AND NOT EXISTS (
    SELECT 1 FROM public.agency_rooms r WHERE r.organization_id=NEW.organization_id
      AND r.nome=NEW.room AND r.ativo
  ) THEN RAISE EXCEPTION 'Sala não cadastrada ou inativa nesta imobiliária' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER trg_02_agency_room ON public.room_reservations;
CREATE TRIGGER trg_02_agency_room BEFORE INSERT OR UPDATE OF room, organization_id, status
  ON public.room_reservations FOR EACH ROW EXECUTE FUNCTION public.enforce_agency_room_reservation();
COMMIT;
