-- Somente homologação; fora de supabase/migrations para impedir db push de produção.
-- Rollback: 20261004173400_mt_agency_profile_rooms.down.sql
BEGIN;
ALTER TABLE public.organizations
  ADD COLUMN razao_social text CHECK (razao_social IS NULL OR length(btrim(razao_social)) BETWEEN 2 AND 160),
  ADD COLUMN creci text CHECK (creci IS NULL OR length(btrim(creci)) BETWEEN 3 AND 50),
  ADD COLUMN cidade text CHECK (cidade IS NULL OR length(btrim(cidade)) BETWEEN 2 AND 80),
  ADD COLUMN uf text CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$');
UPDATE public.organizations SET
  razao_social = 'IMOBILIÁRIA RE/MAX ÚNICA NEGÓCIOS IMOB. LTDA',
  creci = 'CRECI: 29.886-J', cidade = 'Sorocaba', uf = 'SP'
WHERE id = public.legacy_default_org_id();
GRANT ALL ON public.organizations TO mt_1b_definer;
CREATE POLICY mt_1b_definer_agency ON public.organizations FOR ALL TO mt_1b_definer
  USING (true) WITH CHECK (true);

CREATE TABLE public.agency_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 2 AND 80),
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0 CHECK (ordem >= 0),
  UNIQUE (organization_id, nome)
);
CREATE INDEX agency_rooms_org_order ON public.agency_rooms (organization_id, ordem, nome);
ALTER TABLE public.agency_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_rooms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agency_rooms TO authenticated;
GRANT ALL ON public.agency_rooms TO service_role, mt_1b_definer;
CREATE POLICY mt_1b_definer_access ON public.agency_rooms FOR ALL TO mt_1b_definer
  USING (true) WITH CHECK (true);
CREATE POLICY agency_rooms_read ON public.agency_rooms FOR SELECT TO authenticated USING (
  organization_id = (SELECT public.current_org_id()) AND (SELECT public.mt_1b_gate())
);
CREATE TRIGGER trg_zz_pc_audit AFTER INSERT OR DELETE OR UPDATE ON public.agency_rooms
  FOR EACH ROW EXECUTE FUNCTION public.mt_pc_audit_write();
INSERT INTO public.agency_rooms (organization_id, nome, ordem)
SELECT public.legacy_default_org_id(), v.nome, v.ordem FROM (VALUES
  ('Barão Sala 1',1),('Barão Sala 2',2),('Barão Sala 3',3),('Barão Sala 4',4),
  ('Barão CT',5),('Campolim Sala 1',6),('Campolim Sala 2',7)
) v(nome,ordem) WHERE public.legacy_default_org_id() IS NOT NULL;

CREATE FUNCTION public.agency_can_edit() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(auth.uid() IS NOT NULL AND public.current_org_id() IS NOT NULL
    AND public.mt_1b_gate(public.current_org_id())
    AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]),false)
$$;
REVOKE ALL ON FUNCTION public.agency_can_edit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_can_edit() TO authenticated;

CREATE FUNCTION public.agency_room_save(_id uuid, _nome text, _ativo boolean, _ordem integer) RETURNS uuid
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
REVOKE ALL ON FUNCTION public.agency_room_save(uuid,text,boolean,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_room_save(uuid,text,boolean,integer) TO authenticated;

-- Campos allowlist; nome/slug/status/cnpj só continuam editáveis pelas rotas já existentes.
CREATE FUNCTION public.agency_profile_save(_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF NOT public.agency_can_edit() THEN
    RAISE EXCEPTION 'Sem permissão para editar dados da imobiliária' USING ERRCODE='42501';
  END IF;
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' OR
    EXISTS (SELECT 1 FROM jsonb_object_keys(_data) k WHERE k NOT IN
      ('razao_social','creci','cidade','uf','cor_primaria','cor_secundaria','logo_path')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE='22023';
  END IF;
  IF _data ? 'logo_path' AND nullif(_data->>'logo_path','') IS NOT NULL
    AND left(_data->>'logo_path', length(_org::text) + 1) <> _org::text || '/' THEN
    RAISE EXCEPTION 'Logo deve pertencer à imobiliária' USING ERRCODE='42501';
  END IF;
  UPDATE public.organizations SET
    razao_social = CASE WHEN _data ? 'razao_social' THEN nullif(btrim(_data->>'razao_social'),'') ELSE razao_social END,
    creci = CASE WHEN _data ? 'creci' THEN nullif(btrim(_data->>'creci'),'') ELSE creci END,
    cidade = CASE WHEN _data ? 'cidade' THEN nullif(btrim(_data->>'cidade'),'') ELSE cidade END,
    uf = CASE WHEN _data ? 'uf' THEN nullif(upper(btrim(_data->>'uf')),'') ELSE uf END,
    cor_primaria = CASE WHEN _data ? 'cor_primaria' THEN nullif(lower(btrim(_data->>'cor_primaria')),'') ELSE cor_primaria END,
    cor_secundaria = CASE WHEN _data ? 'cor_secundaria' THEN nullif(lower(btrim(_data->>'cor_secundaria')),'') ELSE cor_secundaria END,
    logo_path = CASE WHEN _data ? 'logo_path' THEN nullif(_data->>'logo_path','') ELSE logo_path END
  WHERE id=_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliária não encontrada' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.agency_profile_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agency_profile_save(jsonb) TO authenticated;
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.agency_can_edit() OWNER TO mt_1b_definer;
ALTER FUNCTION public.agency_room_save(uuid,text,boolean,integer) OWNER TO mt_1b_definer;
ALTER FUNCTION public.agency_profile_save(jsonb) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;

-- Checagem no banco; o trigger de org (trg_00_org) atribui a organização antes desta trava.
ALTER TABLE public.room_reservations DROP CONSTRAINT room_reservations_room_check;
CREATE FUNCTION public.enforce_agency_room_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'confirmed' AND NOT EXISTS (
    SELECT 1 FROM public.agency_rooms r WHERE r.organization_id=NEW.organization_id
      AND r.nome=NEW.room AND r.ativo
  ) THEN RAISE EXCEPTION 'Sala não cadastrada ou inativa nesta imobiliária' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_agency_room_reservation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_02_agency_room BEFORE INSERT OR UPDATE OF room, organization_id, status
  ON public.room_reservations FOR EACH ROW EXECUTE FUNCTION public.enforce_agency_room_reservation();
COMMIT;
