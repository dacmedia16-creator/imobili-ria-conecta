-- Marco 1d (somente clone local): defesa no banco para escritas com service_role (ignora RLS).
-- 1. Tabela raiz (teams, room_reservations, clientes, sales, regiões...) e profiles: com service_role
--    o organization_id precisa vir explícito; não cai mais no default legado.
-- 2. Tabelas filhas (herdam do pai): com service_role, organization_id informado diferente do pai
--    é recusado (não é mais sobrescrito em silêncio).
-- 3. Com service_role, UPDATE não pode trocar a agência de uma linha.
-- Migrações/manutenção (supabase_admin/postgres sem role de API) mantêm o comportamento anterior.
BEGIN;
CREATE TABLE public.mt_1d_function_backup (signature text PRIMARY KEY, ddl text NOT NULL);
REVOKE ALL ON public.mt_1d_function_backup FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.mt_1d_function_backup(signature, ddl)
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('mt_set_own_org', 'mt_profiles_org', 'mt_1b_set_org', 'mt_inherit_org');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_1d_function_backup) <> 4 THEN
    RAISE EXCEPTION 'Snapshot 1d incompleto';
  END IF;
END $$;

CREATE FUNCTION public.mt_1d_is_service() RETURNS boolean
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT current_setting('role', true) = 'service_role'
$$;
REVOKE ALL ON FUNCTION public.mt_1d_is_service() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mt_set_own_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _actor uuid := auth.uid(); _org uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       AND (_actor IS NOT NULL OR public.mt_1d_is_service()) THEN
      RAISE EXCEPTION 'organization_id nao pode ser alterado' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF _actor IS NOT NULL THEN
    _org := public.user_org(_actor);
    IF _org IS NULL THEN
      RAISE EXCEPTION 'Usuario sem organizacao ativa' USING ERRCODE = '42501';
    END IF;
    NEW.organization_id := _org;
  ELSIF public.mt_1d_is_service() THEN
    IF NEW.organization_id IS NULL THEN
      RAISE EXCEPTION 'organization_id obrigatorio para service_role' USING ERRCODE = '23502';
    END IF;
  ELSE
    NEW.organization_id := coalesce(NEW.organization_id, public.legacy_default_org_id());
    IF NEW.organization_id IS NULL THEN
      RAISE EXCEPTION 'organization_id obrigatorio' USING ERRCODE = '23502';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.mt_profiles_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _member uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       AND (auth.uid() IS NOT NULL OR public.mt_1d_is_service()) THEN
      RAISE EXCEPTION 'organization_id nao pode ser alterado' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  _member := public.user_org(NEW.id);
  IF public.mt_1d_is_service() AND NEW.organization_id IS NOT NULL AND _member IS NOT NULL
     AND NEW.organization_id <> _member THEN
    RAISE EXCEPTION 'Organizacao divergente do vinculo do usuario' USING ERRCODE = '42501';
  END IF;
  NEW.organization_id := coalesce(_member, NEW.organization_id,
    CASE WHEN auth.uid() IS NULL AND NOT public.mt_1d_is_service()
         THEN public.legacy_default_org_id() END);
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id obrigatorio' USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.mt_inherit_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _parent_table text := TG_ARGV[0]; _fk text := TG_ARGV[1]; _key uuid; _org uuid;
BEGIN
  _key := (to_jsonb(NEW) ->> _fk)::uuid;
  EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', _parent_table) INTO _org USING _key;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'Registro pai sem organizacao (%.%)', _parent_table, _fk USING ERRCODE = '23503';
  END IF;
  IF public.mt_1d_is_service() AND NEW.organization_id IS NOT NULL
     AND NEW.organization_id IS DISTINCT FROM _org
     AND (TG_OP = 'INSERT' OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
    RAISE EXCEPTION 'organization_id divergente do registro pai' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND _org IS DISTINCT FROM OLD.organization_id
     AND (auth.uid() IS NOT NULL OR public.mt_1d_is_service()) THEN
    RAISE EXCEPTION 'organization_id nao pode ser alterado' USING ERRCODE = '42501';
  END IF;
  NEW.organization_id := _org;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.mt_1b_set_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _t text; _c text; _id uuid; _org uuid; _found uuid; i integer;
  _svc boolean := public.mt_1d_is_service();
BEGIN
  FOR i IN 0..1 LOOP
    _t := TG_ARGV[i*2]; _c := TG_ARGV[i*2+1];
    IF _t IS NOT NULL AND _c IS NOT NULL AND _t <> '' AND _c <> '' THEN
      _id := NULLIF(to_jsonb(NEW)->>_c, '')::uuid;
      IF _id IS NOT NULL THEN
        EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', _t) INTO _found USING _id;
        IF _found IS NULL THEN RAISE EXCEPTION 'Registro pai sem organizacao (%.%)', _t, _c USING ERRCODE='23503'; END IF;
        IF _org IS NOT NULL AND _org <> _found THEN
          RAISE EXCEPTION 'Vinculo entre agencias diferentes' USING ERRCODE='23503';
        END IF;
        _org := _found;
      END IF;
    END IF;
  END LOOP;
  IF _svc AND _org IS NOT NULL AND NEW.organization_id IS NOT NULL AND NEW.organization_id <> _org
     AND (TG_OP = 'INSERT' OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
    RAISE EXCEPTION 'organization_id divergente do registro pai' USING ERRCODE='42501';
  END IF;
  IF _org IS NULL THEN
    -- Tabelas raiz sem vínculo só são criadas por serviço com organização explícita.
    _org := NEW.organization_id;
  END IF;
  IF _org IS NULL THEN RAISE EXCEPTION 'organization_id obrigatorio' USING ERRCODE='23502'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS DISTINCT FROM _org
     AND (auth.uid() IS NOT NULL OR _svc) THEN
    RAISE EXCEPTION 'organization_id nao pode ser alterado' USING ERRCODE='42501';
  END IF;
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND _org <> public.current_org_id() THEN
    RAISE EXCEPTION 'Organizacao divergente do usuario' USING ERRCODE='42501';
  END IF;
  NEW.organization_id := _org;
  RETURN NEW;
END $$;

-- CREATE OR REPLACE preserva as ACLs originais dos gatilhos; não alteradas aqui.
COMMIT;
