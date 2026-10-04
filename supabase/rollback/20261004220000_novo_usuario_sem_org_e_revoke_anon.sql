-- Rollback de 20261004220000_novo_usuario_sem_org_e_revoke_anon.sql
-- Volta exatamente ao estado anterior: fallback para a agência legada e privilégios de anon
-- (o REVOKE ALL removeu, de cada tabela, os privilégios abaixo; profiles não tinha SELECT).
BEGIN;

DROP TRIGGER IF EXISTS mt_require_org_on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.mt_require_org_new_user();

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

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activity_logs','clientes','corretor_positioning_regions','document_extractions',
    'exclusive_captures','exclusive_documents','exclusive_history','metas','notifications',
    'occurrence_commissions','occurrence_partners','occurrences','positioning_region_suggestions',
    'positioning_regions','room_reservation_reminder_deliveries','room_reservations',
    'sale_bank_accounts','sale_comment_recipients','sale_comments','sale_commission_extras',
    'sale_documents','sale_parties','sale_payment','sale_status_history','sales',
    'team_co_leaders','team_members','teams','user_roles']
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO anon', t);
    END IF;
  END LOOP;
  IF to_regclass('public.profiles') IS NOT NULL THEN
    -- Postgres 17: o estado anterior incluía MAINTAIN.
    GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.profiles TO anon;
  END IF;
END $$;

COMMIT;
