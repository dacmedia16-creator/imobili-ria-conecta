-- Rollback 1b local (pré-requisito: migration 1a ativa, sem dados de agência nova).
-- Falha fechado: nunca perde linhas da agência B. Executar antes do down da 1a.
BEGIN;
DO $$
DECLARE t text; n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE NOT legacy_default) THEN
    RAISE EXCEPTION 'Rollback 1b bloqueado: agencia nova; remover apenas com autorizacao e backup.';
  END IF;
  FOREACH t IN ARRAY ARRAY['activity_logs','document_extractions','exclusive_capture_setting_history',
    'exclusive_capture_settings','exclusive_captures','exclusive_documents','exclusive_history',
    'juridico_agent_audit','metas','notifications','occurrence_commissions','occurrence_partners',
    'operational_impersonation_actions','operational_impersonation_sessions',
    'room_reservation_cancellation_penalties','room_reservation_reminder_deliveries',
    'sale_bank_accounts','sale_comment_recipients','sale_comments','sale_commission_extras',
    'sale_juridico_reached','sale_parties','sale_status_history','team_co_leaders',
    'team_membership_history','user_preview_audit'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id <> public.legacy_default_org_id()',t) INTO n;
    IF n>0 THEN RAISE EXCEPTION 'Rollback 1b bloqueado: %.% registros de outra agencia',t,n; END IF;
  END LOOP;
END $$;

-- Restaura definições exatas antes de remover colunas e dono dedicado.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT * FROM public.mt_1b_function_backup LOOP
    EXECUTE f.ddl;
    IF f.owner_name <> 'mt_1b_definer' THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO %I', f.signature, f.owner_name);
    END IF;

  END LOOP;
END $$;


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['activity_logs','document_extractions','exclusive_capture_setting_history',
    'exclusive_capture_settings','exclusive_captures','exclusive_documents','exclusive_history',
    'juridico_agent_audit','metas','notifications','occurrence_commissions','occurrence_partners',
    'operational_impersonation_actions','operational_impersonation_sessions',
    'room_reservation_cancellation_penalties','room_reservation_reminder_deliveries',
    'sale_bank_accounts','sale_comment_recipients','sale_comments','sale_commission_extras',
    'sale_juridico_reached','sale_parties','sale_status_history','team_co_leaders',
    'team_membership_history','user_preview_audit'] LOOP
    EXECUTE format('DROP POLICY mt_1b_definer_access ON public.%I', t);
    EXECUTE format('DROP POLICY org_isolation ON public.%I', t);
    EXECUTE format('DROP TRIGGER trg_00_org ON public.%I', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['profiles','user_roles','teams','team_members','clientes','sales',
    'sale_payment','sale_documents','occurrences','room_reservations','positioning_regions',
    'positioning_region_suggestions','corretor_positioning_regions'] LOOP
    EXECUTE format('DROP POLICY mt_1b_definer_access ON public.%I',t);
  END LOOP;
END $$;

ALTER TABLE public.exclusive_capture_settings DROP CONSTRAINT exclusive_capture_settings_pkey;
ALTER TABLE public.exclusive_capture_settings ADD CONSTRAINT exclusive_capture_settings_pkey PRIMARY KEY (id);
DROP INDEX public.metas_corretor_mes_key;
DROP INDEX public.metas_equipe_mes_key;
CREATE UNIQUE INDEX metas_corretor_mes_key ON public.metas USING btree (corretor_id,mes) WHERE tipo='corretor';
CREATE UNIQUE INDEX metas_equipe_mes_key ON public.metas USING btree (team_id,mes) WHERE tipo='equipe';

-- CASCADE remove apenas os vínculos que incluem a coluna nova.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['activity_logs','document_extractions','exclusive_capture_setting_history',
    'exclusive_capture_settings','exclusive_captures','exclusive_documents','exclusive_history',
    'juridico_agent_audit','metas','notifications','occurrence_commissions','occurrence_partners',
    'operational_impersonation_actions','operational_impersonation_sessions',
    'room_reservation_cancellation_penalties','room_reservation_reminder_deliveries',
    'sale_bank_accounts','sale_comment_recipients','sale_comments','sale_commission_extras',
    'sale_juridico_reached','sale_parties','sale_status_history','team_co_leaders',
    'team_membership_history','user_preview_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN organization_id CASCADE',t);
  END LOOP;
END $$;
ALTER TABLE public.sale_documents DROP CONSTRAINT sale_documents_id_org_key;
ALTER TABLE public.occurrences DROP CONSTRAINT occurrences_id_org_key;
ALTER TABLE public.room_reservations DROP CONSTRAINT room_reservations_id_org_key;
ALTER TABLE public.clientes DROP CONSTRAINT clientes_id_org_key;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM mt_1b_definer;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth, storage FROM mt_1b_definer;
REVOKE SELECT ON storage.objects FROM mt_1b_definer;
REVOKE ALL ON SCHEMA public, auth, storage FROM mt_1b_definer;
REVOKE authenticated FROM mt_1b_definer;
DROP TABLE public.mt_1b_function_backup;
DROP FUNCTION public.mt_1b_set_org();
DROP FUNCTION public.mt_1b_gate(uuid);
DROP ROLE mt_1b_definer;
COMMIT;
