-- Marco 1e (somente clone local): fronteira admin/gestor e cadastro de imobiliárias.
-- 1. profiles.ativo: além de admin/super_admin da agência (RLS), aceita o servidor (service_role),
--    que já validou a regra única (gestor só desativa corretor da própria equipe). O alvo precisa
--    ser da mesma agência de quem age (RLS org_isolation).
-- 2. organization_members: nenhum papel de API (authenticated/service_role) troca usuário de
--    agência nem cria vínculo em outra agência para usuário existente.
-- 3. organizations: edição e suspensão só pelo super-admin da plataforma, via RPC.
-- Migrações/manutenção (supabase_admin sem role de API) mantêm o comportamento anterior.
BEGIN;
CREATE TABLE public.mt_1e_function_backup (signature text PRIMARY KEY, ddl text NOT NULL);
REVOKE ALL ON public.mt_1e_function_backup FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.mt_1e_function_backup(signature, ddl)
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  FROM pg_proc p
 WHERE p.oid = 'public.enforce_profiles_ativo_lock()'::regprocedure;

CREATE OR REPLACE FUNCTION public.enforce_profiles_ativo_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    -- Autodesativação de admin continua como no legado no banco; servidor e tela a recusam.
    IF current_setting('role', true) = 'service_role' THEN
      RETURN NEW; -- servidor: regra papel x agencia validada antes (user-management.server.ts)
    END IF;
    IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]) THEN
      RAISE EXCEPTION 'Somente admin ou super_admin pode ativar/desativar um usuario.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Vínculo usuário↔agência é imutável para papéis de API.
CREATE FUNCTION public.mt_1e_member_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('role', true) IN ('authenticated', 'anon', 'service_role') THEN
    IF TG_OP = 'UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id
                             OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
      RAISE EXCEPTION 'Usuario nao pode ser movido entre agencias' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.profiles p
        WHERE p.id = NEW.user_id AND p.organization_id <> NEW.organization_id) THEN
      RAISE EXCEPTION 'Usuario nao pode ser movido entre agencias' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_mt_1e_member_lock BEFORE INSERT OR UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.mt_1e_member_lock();

-- Imobiliárias: edição e suspensão exclusivas do super-admin da plataforma.
CREATE FUNCTION public.platform_update_organization(_id uuid, _nome text, _slug text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_platform_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma edita imobiliarias.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organizations
     SET nome = coalesce(nullif(btrim(_nome), ''), nome),
         slug = coalesce(nullif(lower(btrim(_slug)), ''), slug)
   WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002'; END IF;
END $$;

CREATE FUNCTION public.platform_set_organization_status(_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_platform_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma suspende imobiliarias.' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('ativa', 'suspensa') THEN
    RAISE EXCEPTION 'Status invalido' USING ERRCODE = '22023';
  END IF;
  IF _status = 'suspensa' AND EXISTS (SELECT 1 FROM public.organizations WHERE id = _id AND legacy_default) THEN
    RAISE EXCEPTION 'A agencia legada nao pode ser suspensa por aqui' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organizations SET status = _status WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.platform_update_organization(uuid, text, text),
  public.platform_set_organization_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_update_organization(uuid, text, text),
  public.platform_set_organization_status(uuid, text) TO authenticated, service_role;
COMMIT;
