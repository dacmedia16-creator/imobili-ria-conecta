-- Segurança multiempresa (achados 1 e 2 do teste de isolamento t_6245721a).
--
-- 1) Novo usuário SEM organização não entra mais na agência legada.
--    Antes: handle_new_user usava coalesce(app_metadata.organization_id, legacy_default_org_id()) e
--    criava vínculo + perfil + papel 'corretor' na Única Escolha para qualquer usuário sem agência.
--    Agora: sem organization_id no INSERT, nada é provisionado. Como o GoTrue grava o app_metadata do
--    createUser num UPDATE logo depois (mesma transação), o gatilho mt_2a_on_auth_user_app_metadata
--    continua provisionando na agência informada. Um gatilho de restrição ADIADO (fim da transação)
--    recusa a criação se o usuário terminar sem vínculo: a criação inteira é desfeita (falha fechada).
--    Caminhos legítimos (todos passam app_metadata.organization_id): tela Usuários (createAgencyUser),
--    primeiro admin de agência (createFirstAdmin). conta-max-bridge só vincula usuário existente.
--
-- 2) anon (sem login) perde todos os privilégios diretos nas tabelas de negócio do schema public.
--    O RLS já bloqueava; isto é a segunda barreira. As páginas públicas usam só as RPCs
--    list_public_positioning_regions e list_public_specialists (SECURITY DEFINER), que não mudam.
--
-- Rollback: supabase/rollback/20261004220000_novo_usuario_sem_org_e_revoke_anon.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _org uuid;
BEGIN
  -- raw_app_meta_data só é gravável pelo servidor (service_role); o usuário não escolhe a agência.
  -- Sem agência: não provisiona (nada de fallback para a agência legada).
  _org := nullif(NEW.raw_app_meta_data ->> 'organization_id', '')::uuid;
  -- Marca "criado nesta transação": o GoTrue grava o app_metadata do chamador logo depois, via UPDATE.
  PERFORM set_config('mt.pending_new_user', NEW.id::text, true);
  IF _org IS NOT NULL THEN
    PERFORM public.mt_2a_provision_user(NEW.id, NEW.email, NEW.raw_user_meta_data, _org);
  END IF;
  RETURN NEW;
END; $function$;

-- Fim da transação: usuário novo sem vínculo de agência é recusado (desfaz a criação).
CREATE FUNCTION public.mt_require_org_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = NEW.id) THEN
    RAISE EXCEPTION 'Novo usuario sem organizacao: cadastro recusado'
      USING ERRCODE = 'P0001', HINT = 'Informe app_metadata.organization_id ao criar o usuario.';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.mt_require_org_new_user() FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER mt_require_org_on_auth_user_created
  AFTER INSERT ON auth.users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.mt_require_org_new_user();

-- 2) REVOKE de anon nas tabelas de negócio (lista do catálogo de 01/10 e 02/10; ignora as ausentes).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activity_logs','clientes','corretor_positioning_regions','document_extractions',
    'exclusive_captures','exclusive_documents','exclusive_history','metas','notifications',
    'occurrence_commissions','occurrence_partners','occurrences','positioning_region_suggestions',
    'positioning_regions','profiles','room_reservation_reminder_deliveries','room_reservations',
    'sale_bank_accounts','sale_comment_recipients','sale_comments','sale_commission_extras',
    'sale_documents','sale_parties','sale_payment','sale_status_history','sales',
    'team_co_leaders','team_members','teams','user_roles']
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;

-- Trava: nenhuma tabela de public pode continuar legível por anon.
DO $$
DECLARE _left text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO _left
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m')
     AND has_table_privilege('anon', c.oid, 'SELECT');
  IF _left IS NOT NULL THEN
    RAISE EXCEPTION 'anon ainda le: %', _left;
  END IF;
END $$;

COMMIT;
