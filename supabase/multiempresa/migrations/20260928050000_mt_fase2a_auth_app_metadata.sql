-- Fase 2a (homologação real): agência do novo usuário vinda do app_metadata do Auth.
--
-- Achado no serviço real: `auth.admin.createUser({ app_metadata })` do GoTrue faz INSERT em auth.users
-- SEM o app_metadata do chamador e grava esse app_metadata num UPDATE posterior, na MESMA transação.
-- O gatilho AFTER INSERT (handle_new_user) não via `organization_id` e colocava o usuário na agência
-- legada (Única Escolha). O clone local não reproduzia porque os testes inserem em auth.users já com
-- o app_metadata completo.
--
-- Correção: handle_new_user marca o usuário como "recém-criado nesta transação" (GUC local). Um gatilho
-- AFTER UPDATE OF raw_app_meta_data re-provisiona o vínculo/perfil/papel na agência informada, SOMENTE
-- para usuário recém-criado na mesma transação. Depois disso, mudar app_metadata não move ninguém
-- (fronteira 1e preservada). Agência inválida ou suspensa: falha fechada (a criação inteira é desfeita).
-- Pré-requisito: 1a–1e. Rollback: .down.sql (antes do down da 1e).
BEGIN;
CREATE TABLE public.mt_2a_function_backup (signature text PRIMARY KEY, ddl text NOT NULL);
REVOKE ALL ON public.mt_2a_function_backup FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.mt_2a_function_backup(signature, ddl)
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  FROM pg_proc p WHERE p.oid = 'public.handle_new_user()'::regprocedure;

-- Cria vínculo, perfil e papel inicial do usuário na agência (uso interno dos gatilhos de auth.users).
CREATE FUNCTION public.mt_2a_provision_user(_id uuid, _email text, _meta jsonb, _org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _org IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org AND status = 'ativa') THEN
    RAISE EXCEPTION 'Organizacao invalida para novo usuario';
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id) VALUES (_org, _id);
  INSERT INTO public.profiles (id, nome, email, organization_id)
  VALUES (_id, COALESCE(_meta->>'nome', split_part(_email, '@', 1)), _email, _org);
  INSERT INTO public.user_roles (user_id, role) VALUES (_id, 'corretor');
END $$;
REVOKE ALL ON FUNCTION public.mt_2a_provision_user(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _org uuid;
BEGIN
  -- raw_app_meta_data só é gravável pelo servidor (service_role); o usuário não escolhe a agência.
  _org := coalesce(nullif(NEW.raw_app_meta_data ->> 'organization_id', '')::uuid, public.legacy_default_org_id());
  PERFORM public.mt_2a_provision_user(NEW.id, NEW.email, NEW.raw_user_meta_data, _org);
  -- Marca "criado nesta transação": o GoTrue grava o app_metadata do chamador logo depois, via UPDATE.
  PERFORM set_config('mt.pending_new_user', NEW.id::text, true);
  RETURN NEW;
END; $function$;

CREATE FUNCTION public.mt_2a_apply_app_metadata_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _org uuid; _cur uuid;
BEGIN
  IF coalesce(current_setting('mt.pending_new_user', true), '') <> NEW.id::text THEN
    RETURN NEW; -- usuário existente: app_metadata nunca move de agência
  END IF;
  _org := nullif(NEW.raw_app_meta_data ->> 'organization_id', '')::uuid;
  SELECT organization_id INTO _cur FROM public.organization_members WHERE user_id = NEW.id;
  IF _org IS NULL OR _org IS NOT DISTINCT FROM _cur THEN
    RETURN NEW;
  END IF;
  -- Recém-criado nesta transação, ainda sem nenhum dado próprio: refaz o provisionamento.
  DELETE FROM public.user_roles WHERE user_id = NEW.id;
  DELETE FROM public.profiles WHERE id = NEW.id;
  DELETE FROM public.organization_members WHERE user_id = NEW.id;
  PERFORM public.mt_2a_provision_user(NEW.id, NEW.email, NEW.raw_user_meta_data, _org);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mt_2a_apply_app_metadata_org() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER mt_2a_on_auth_user_app_metadata
  AFTER UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.mt_2a_apply_app_metadata_org();
COMMIT;
