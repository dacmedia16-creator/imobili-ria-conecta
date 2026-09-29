-- Marco 1b: 26 tabelas de agência restantes; duas tabelas de Conta MAX são globais
-- (identidade/replay), sem leitura por usuários. Fora de supabase/migrations: só ensaio local.
-- Nunca aplicar em produção sem aprovação. Pré-requisito: migration 1a.
BEGIN;

-- Inventário explícito: principal e secundária (se houver). Todas as chaves abaixo são UUID.
CREATE TEMP TABLE mt_1b_spec (
  tab text PRIMARY KEY, parent text, fk text, secondary text, secondary_fk text
) ON COMMIT DROP;
INSERT INTO mt_1b_spec VALUES
 ('activity_logs','sales','sale_id','profiles','autor_id'),
 ('document_extractions','sales','sale_id','sale_documents','document_id'),
 ('exclusive_capture_setting_history','profiles','actor_id',NULL,NULL),
 ('exclusive_capture_settings',NULL,NULL,NULL,NULL),
 ('exclusive_captures','profiles','captor_id','profiles','created_by'),
 ('exclusive_documents','exclusive_captures','capture_id','profiles','uploaded_by'),
 ('exclusive_history','exclusive_captures','capture_id','profiles','actor_id'),
 ('juridico_agent_audit','sales','sale_id','sale_documents','document_id'),
 ('metas','teams','team_id','profiles','corretor_id'),
 ('notifications','profiles','user_id','sales','sale_id'),
 ('occurrence_commissions','occurrences','occurrence_id','profiles','user_id'),
 ('occurrence_partners','occurrences','occurrence_id',NULL,NULL),
 ('operational_impersonation_actions','operational_impersonation_sessions','impersonation_session_id','profiles','target_user_id'),
 ('operational_impersonation_sessions','profiles','target_user_id','profiles','actor_user_id'),
 ('room_reservation_cancellation_penalties','profiles','user_id',NULL,NULL),
 ('room_reservation_reminder_deliveries','room_reservations','reservation_id','profiles','recipient_id'),
 ('sale_bank_accounts','sales','sale_id',NULL,NULL),
 ('sale_comment_recipients','sale_comments','comment_id','sales','sale_id'),
 ('sale_comments','sales','sale_id','profiles','autor_id'),
 ('sale_commission_extras','sales','sale_id','profiles','user_id'),
 ('sale_juridico_reached','sales','sale_id',NULL,NULL),
 ('sale_parties','sales','sale_id','clientes','cliente_id'),
 ('sale_status_history','sales','sale_id','profiles','autor_id'),
 ('team_co_leaders','teams','team_id','profiles','user_id'),
 ('team_membership_history','teams','team_id','profiles','membro_id'),
 ('user_preview_audit','profiles','target_user_id','profiles','actor_user_id');

-- Duas tabelas globais de replay/identidade: acesso apenas service_role; sem APIs públicas.
REVOKE ALL ON public.conta_max_identity_links, public.conta_max_ticket_uses FROM PUBLIC, anon, authenticated;
ALTER TABLE public.conta_max_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_max_ticket_uses ENABLE ROW LEVEL SECURITY;

-- Guardas para funções de policy que mantêm propriedade privilegiada. Não autoriza
-- consultar UUID alheio mesmo chamando a função diretamente (RPC com parâmetro forjado).
CREATE FUNCTION public.mt_1b_gate(_target_org uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN current_setting('role', true) = 'service_role'
    OR (current_setting('role', true) = 'none' AND session_user IN ('supabase_admin', 'postgres'))
    THEN true
    ELSE auth.uid() IS NOT NULL AND public.current_org_id() IS NOT NULL
      AND (_target_org IS NULL OR _target_org = public.current_org_id()) END
$$;
REVOKE ALL ON FUNCTION public.mt_1b_gate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mt_1b_gate(uuid) TO authenticated, service_role;

-- Guardar DDL/proprietário exatos de RPCs alteradas para rollback integral e local.
CREATE TABLE public.mt_1b_function_backup (signature text PRIMARY KEY, ddl text NOT NULL, owner_name text NOT NULL, anon_exec boolean NOT NULL DEFAULT false);
REVOKE ALL ON public.mt_1b_function_backup FROM PUBLIC, anon, authenticated;

-- A organização do perfil precisa estar ativa e o perfil ativo. `user_org` continua
-- útil dentro de triggers, mas não é RPC autenticada para sondar outras agências.
INSERT INTO public.mt_1b_function_backup(signature,ddl,owner_name) SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text
FROM pg_proc p WHERE p.oid = 'public.current_org_id()'::regprocedure;
INSERT INTO public.mt_1b_function_backup(signature,ddl,owner_name) SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text
FROM pg_proc p WHERE p.oid = 'public.user_org(uuid)'::regprocedure;
CREATE OR REPLACE FUNCTION public.user_org(_user uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT m.organization_id FROM public.organization_members m
  JOIN public.organizations o ON o.id=m.organization_id
  WHERE m.user_id=_user AND m.ativo AND o.status='ativa'
    AND (_user=auth.uid() OR EXISTS (
      SELECT 1 FROM public.organization_members caller
      WHERE caller.user_id=auth.uid() AND caller.organization_id=m.organization_id AND caller.ativo
    ) OR current_setting('role',true)='service_role'
      OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres')))
$$;
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.user_org(auth.uid()) WHERE EXISTS
    (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND ativo IS TRUE)
$$;


-- Todas as tabelas filhas atribuem o escopo no servidor, a partir da FK. Se dois
-- pais são preenchidos, eles devem pertencer à mesma agência. Sem pai, o serviço
-- deve dar organization_id explícito (o default legado só vale para backfill).
CREATE FUNCTION public.mt_1b_set_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _t text; _c text; _id uuid; _org uuid; _found uuid; i integer;
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
  IF _org IS NULL THEN
    -- Tabelas raiz sem vínculo só são criadas por serviço com organização explícita.
    _org := NEW.organization_id;
  END IF;
  IF _org IS NULL THEN RAISE EXCEPTION 'organization_id obrigatorio' USING ERRCODE='23502'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS DISTINCT FROM _org AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'organization_id nao pode ser alterado' USING ERRCODE='42501';
  END IF;
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND _org <> public.current_org_id() THEN
    RAISE EXCEPTION 'Organizacao divergente do usuario' USING ERRCODE='42501';
  END IF;
  NEW.organization_id := _org;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mt_1b_set_org() FROM PUBLIC, anon, authenticated;

-- Dados reais: linhas antigas de occurrence_commissions violam a CHECK NOT VALID abaixo
-- (valida só escritas novas). O backfill faz UPDATE e a reavaliaria nessas linhas. Retira a
-- CHECK só durante o backfill e a recria IDÊNTICA (mesma definição, NOT VALID) nesta mesma
-- transação. Nenhuma linha de negócio é alterada; a regra segue valendo para escritas novas.
CREATE TEMP TABLE mt_1b_saved_check ON COMMIT DROP AS
  SELECT conname::text, conrelid::regclass::text tab, pg_get_constraintdef(oid) def
  FROM pg_constraint
  WHERE conrelid = 'public.occurrence_commissions'::regclass
    AND conname = 'occurrence_commissions_exige_vinculo_ou_confirmacao';
DO $drop_check$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM mt_1b_saved_check LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tab, c.conname);
  END LOOP;
END $drop_check$;

DO $migration$
DECLARE r record; c record; n bigint; _first uuid; _missing text := '';
BEGIN
  FOR r IN SELECT * FROM mt_1b_spec LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN organization_id uuid', r.tab);
  END LOOP;
  -- Ordem: primeiro pais 1b, depois os dois filhos de pais 1b.
  FOR r IN SELECT * FROM mt_1b_spec ORDER BY
      CASE tab WHEN 'operational_impersonation_actions' THEN 2
               WHEN 'sale_comment_recipients' THEN 2 ELSE 1 END, tab LOOP
    -- Legado: as tabelas não possuíam organização. Herda da referência principal,
    -- depois secundária; registros sem vínculo entram apenas na agência histórica.
    IF r.parent IS NOT NULL THEN
      EXECUTE format('UPDATE public.%I x SET organization_id=p.organization_id FROM public.%I p WHERE x.%I=p.id AND x.organization_id IS NULL',r.tab,r.parent,r.fk);
    END IF;
    IF r.secondary IS NOT NULL THEN
      EXECUTE format('UPDATE public.%I x SET organization_id=p.organization_id FROM public.%I p WHERE x.%I=p.id AND x.organization_id IS NULL',r.tab,r.secondary,r.secondary_fk);
    END IF;
    EXECUTE format('UPDATE public.%I SET organization_id=public.legacy_default_org_id() WHERE organization_id IS NULL',r.tab);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL',r.tab) INTO n;
    IF n>0 THEN _missing:=_missing||r.tab||'='||n||' '; END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL',r.tab);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES public.organizations(id)',r.tab,r.tab||'_org_fk');
    EXECUTE format('CREATE INDEX %I ON public.%I (organization_id)', 'idx_'||r.tab||'_org',r.tab);
    -- As tabelas referenciadas por outras tabelas ganham chave (id, org).
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=('public.'||r.tab)::regclass AND a.attname='id' AND a.atttypid='uuid'::regtype) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (id, organization_id)',r.tab,r.tab||'_id_org_key');
    END IF;
    EXECUTE format('CREATE POLICY org_isolation ON public.%I AS RESTRICTIVE FOR ALL TO public USING (organization_id=(SELECT public.current_org_id())) WITH CHECK (organization_id=(SELECT public.current_org_id()))',r.tab);
    EXECUTE format('CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.mt_1b_set_org(%L,%L,%L,%L)',r.tab,r.parent,r.fk,r.secondary,r.secondary_fk);
  END LOOP;
  IF _missing<>'' THEN RAISE EXCEPTION 'Backfill incompleto: %',_missing; END IF;

  -- Pais do marco 1a referenciados por tabelas adicionais deste marco.
  ALTER TABLE public.sale_documents ADD CONSTRAINT sale_documents_id_org_key UNIQUE (id,organization_id);
  ALTER TABLE public.occurrences ADD CONSTRAINT occurrences_id_org_key UNIQUE (id,organization_id);
  ALTER TABLE public.room_reservations ADD CONSTRAINT room_reservations_id_org_key UNIQUE (id,organization_id);
  ALTER TABLE public.clientes ADD CONSTRAINT clientes_id_org_key UNIQUE (id,organization_id);

  -- FKs compostas para TODAS as referências entre dados de agência, não só as
  -- relações principal/secundária usadas no trigger. Inclusive auth.users -> profiles.
  FOR c IN SELECT con.conname, con.conrelid::regclass::text tab,
      a.attname col, case when con.confrelid='auth.users'::regclass THEN 'profiles'
        ELSE con.confrelid::regclass::text END parent,
      (SELECT attname FROM pg_attribute WHERE attrelid=con.confrelid AND attnum=con.confkey[1]) parent_col,
      con.confdeltype deltype
    FROM pg_constraint con JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=con.conkey[1]
    WHERE con.contype='f' AND con.conkey[2] IS NULL
      AND con.conrelid IN (SELECT ('public.'||tab)::regclass FROM mt_1b_spec)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=c.parent::regclass AND attname='organization_id') THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I, organization_id) REFERENCES %s(%I, organization_id) %s',
        c.tab, 'mt_1b_'||replace(c.conname,'_fkey','')||'_org_fk', c.col, c.parent, c.parent_col,
        CASE c.deltype WHEN 'c' THEN 'ON DELETE CASCADE' WHEN 'n' THEN format('ON DELETE SET NULL (%I)',c.col) ELSE '' END);
    END IF;
  END LOOP;
END $migration$;

-- Recria a CHECK retirada acima com a definição exata e sem validar linhas antigas.
DO $restore_check$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM mt_1b_saved_check LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', c.tab, c.conname,
      CASE WHEN c.def LIKE '% NOT VALID' THEN c.def ELSE c.def || ' NOT VALID' END);
  END LOOP;
END $restore_check$;

-- O trigger legado de papéis gera log sem sale_id/autor_id no cadastro servidor.
-- O escopo vem da própria linha de papel, nunca de um default global em novos dados.
INSERT INTO public.mt_1b_function_backup(signature,ddl,owner_name)
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text
FROM pg_proc p WHERE p.oid='public.log_role_change()'::regprocedure;
CREATE OR REPLACE FUNCTION public.log_role_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload, organization_id)
  VALUES (auth.uid(), NULL,
    CASE WHEN TG_OP = 'INSERT' THEN 'role_granted' ELSE 'role_revoked' END,
    jsonb_build_object('target_user', COALESCE(NEW.user_id, OLD.user_id),
      'role', COALESCE(NEW.role, OLD.role)::text),
    COALESCE(NEW.organization_id, OLD.organization_id));
  RETURN COALESCE(NEW, OLD);
END $$;

-- Constraints globais da configuração booleana e das metas tornam-se por agência.
ALTER TABLE public.exclusive_capture_settings DROP CONSTRAINT exclusive_capture_settings_pkey;
ALTER TABLE public.exclusive_capture_settings ADD CONSTRAINT exclusive_capture_settings_pkey PRIMARY KEY (organization_id,id);
DROP INDEX public.metas_corretor_mes_key;
DROP INDEX public.metas_equipe_mes_key;
CREATE UNIQUE INDEX metas_corretor_mes_key ON public.metas(organization_id,corretor_id,mes) WHERE tipo='corretor';
CREATE UNIQUE INDEX metas_equipe_mes_key ON public.metas(organization_id,team_id,mes) WHERE tipo='equipe';

-- Dono não-BYPASSRLS para RPCs que varrem/totais em SQL/PLpgSQL: políticas OR originais
-- e gate RESTRICTIVE por organização continuam valendo. Em funções privilegiadas
-- preserva-se a permissão interna histórica, nunca a leitura/escrita cruzada.
CREATE ROLE mt_1b_definer NOLOGIN NOINHERIT NOBYPASSRLS;
-- No Supabase hospedado a migration roda como `postgres` (sem superusuário): ALTER ... OWNER TO
-- exige poder assumir o novo dono, e CREATE OR REPLACE/rollback posteriores exigem ser
-- "dono" (herdar o papel). O papel dedicado tem menos privilégios que `postgres`: herdar não amplia nada.
DO $grant$ BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT mt_1b_definer TO %I WITH INHERIT TRUE, SET TRUE', current_user);
    -- Temporário: revogado ao fim da migration (só é exigido no momento do ALTER OWNER).
    GRANT CREATE ON SCHEMA public TO mt_1b_definer;
  END IF;
END $grant$;
GRANT authenticated TO mt_1b_definer WITH INHERIT TRUE, SET FALSE;
GRANT USAGE ON SCHEMA public, auth, storage TO mt_1b_definer;
GRANT ALL ON ALL TABLES IN SCHEMA public TO mt_1b_definer;
-- Nem o catálogo de rollback nem as tabelas globais de identidade/replay são
-- dados de agência: nenhuma RPC com este dono deve poder consultá-los.
REVOKE ALL ON public.mt_1b_function_backup, public.conta_max_identity_links,
  public.conta_max_ticket_uses FROM mt_1b_definer;
GRANT SELECT ON storage.objects TO mt_1b_definer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mt_1b_definer;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth, storage TO mt_1b_definer;
DO $pol$
DECLARE r record;
BEGIN
  FOR r IN SELECT tab FROM mt_1b_spec UNION ALL
      SELECT unnest(ARRAY['profiles','user_roles','teams','team_members','clientes','sales','sale_payment',
      'sale_documents','occurrences','room_reservations','positioning_regions','positioning_region_suggestions',
      'corretor_positioning_regions'])
  LOOP
    EXECUTE format('CREATE POLICY mt_1b_definer_access ON public.%I FOR ALL TO mt_1b_definer USING (true) WITH CHECK (true)',r.tab);
  END LOOP;
END $pol$;

-- Funções booleanas usadas por policies permanecem privilegiadas (sem recursão
-- na RLS), mas valida-se explicitamente o alvo, além do usuário da requisição.
-- A saída FALSE impede sondar IDs de outras imobiliárias por RPC direta.
CREATE TEMP TABLE mt_1b_helpers (name text PRIMARY KEY, condition text) ON COMMIT DROP;
INSERT INTO mt_1b_helpers VALUES
 ('has_role', 'public.user_org(_user_id) = public.current_org_id()'),
 ('has_any_role', 'public.user_org(_user_id) = public.current_org_id()'),
 ('is_active_user', 'public.user_org(_user) = public.current_org_id() AND EXISTS (SELECT 1 FROM public.profiles WHERE id=_user AND ativo IS TRUE)'),
 ('is_lead_of', 'public.user_org(_lider) = public.current_org_id() AND public.user_org(_membro) = public.current_org_id()'),
 ('can_view_sale', 'public.user_org(_user) = public.current_org_id() AND EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id())'),
 ('can_edit_sale_stage', 'public.user_org(_user) = public.current_org_id() AND EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id())'),
 ('can_edit_sale_comissao', 'public.user_org(_user) = public.current_org_id() AND EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id())'),
 ('can_edit_sale_as_co_leader', 'EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id())'),
 ('can_manage_sale_as_co_leader', 'EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id())'),
 ('can_read_principal_sale_as_co_leader', 'EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id())'),
 ('can_read_sale_juridico_certidao', 'EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id())'),
 ('can_upload_juridico_certidao', 'EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id())'),
 ('is_sale_locked', 'EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id())'),
 ('can_cancel_room_reservation', 'public.user_org(_actor) = public.current_org_id() AND public.user_org(_responsible_id) = public.current_org_id()'),
 ('can_view_room_reservation', 'public.user_org(_actor) = public.current_org_id() AND public.user_org(_responsible_id) = public.current_org_id()'),
 ('leads_team_or_parent', 'public.user_org(_user) = public.current_org_id() AND EXISTS (SELECT 1 FROM public.teams WHERE id=_team_id AND organization_id=public.current_org_id())'),
 ('sees_team', 'public.user_org(_user) = public.current_org_id() AND EXISTS (SELECT 1 FROM public.teams WHERE id=_team_id AND organization_id=public.current_org_id())'),
 ('sees_own_team_leader', 'public.user_org(_user) = public.current_org_id() AND public.user_org(_profile_id) = public.current_org_id()'),
 ('exclusive_actor_active', 'public.user_org(_actor) = public.current_org_id()'),
 ('exclusive_can_view', 'public.user_org(_actor) = public.current_org_id() AND EXISTS (SELECT 1 FROM public.exclusive_captures WHERE id=_id AND organization_id=public.current_org_id())'),
 ('exclusive_is_editor', 'public.user_org(_actor) = public.current_org_id() AND EXISTS (SELECT 1 FROM public.exclusive_captures WHERE id=_id AND organization_id=public.current_org_id())'),
 ('exclusive_is_manager', 'public.user_org(_actor) = public.current_org_id() AND EXISTS (SELECT 1 FROM public.exclusive_captures WHERE id=_id AND organization_id=public.current_org_id())');

DO $guard$
DECLARE p record; body text; def text; guarded text;
BEGIN
  FOR p IN SELECT x.oid, x.proname, h.condition, pg_get_functiondef(x.oid) ddl
    FROM mt_1b_helpers h JOIN pg_proc x ON x.proname=h.name
    WHERE x.pronamespace='public'::regnamespace AND x.prosecdef
      AND x.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')
  LOOP
    INSERT INTO public.mt_1b_function_backup(signature,ddl,owner_name)
      SELECT p.oid::regprocedure::text, p.ddl, proowner::regrole::text FROM pg_proc WHERE oid=p.oid
      ON CONFLICT DO NOTHING;
    body := split_part(split_part(p.ddl, 'AS $function$', 2), '$function$', 1);
    IF body='' THEN RAISE EXCEPTION 'DDL inesperado: %',p.proname; END IF;
    body := regexp_replace(btrim(body), ';[[:space:]]*$', '');
    guarded := E'\n  SELECT COALESCE((' || body || E'\n  ),false) AND public.mt_1b_gate() AND ((' || p.condition || E')\n    OR current_setting(''role'',true)=''service_role''\n    OR (current_setting(''role'',true)=''none'' AND session_user IN (''supabase_admin'',''postgres'')));\n';
    def := replace(p.ddl, split_part(split_part(p.ddl,'AS $function$',2),'$function$',1), guarded);
    EXECUTE def;
  END LOOP;
  IF (SELECT count(*) FROM public.mt_1b_function_backup) < 22 THEN
    RAISE EXCEPTION 'Funcoes de policy incompletas; abortando migration';
  END IF;
END $guard$;

-- Configuração exclusiva: a Única Escolha mantém seu valor; agência sem configuração
-- explícita fica desabilitada em vez de herdar o sinal global da agência legada.
INSERT INTO public.mt_1b_function_backup(signature,ddl,owner_name)
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text
FROM pg_proc p WHERE p.oid='public.exclusive_capture_enabled()'::regprocedure;
CREATE OR REPLACE FUNCTION public.exclusive_capture_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.exclusive_capture_settings
    WHERE id AND organization_id=public.current_org_id()),false)
$$;

-- Outras SECURITY DEFINER consultam tabelas como papel dedicado SEM BYPASSRLS.
-- Excluir triggers, policy helpers e funções de plataforma/identidade global.
-- Os grants e funções seguem restauráveis em mt_1b_function_backup.
DO $owner$
DECLARE p record;
BEGIN
  FOR p IN SELECT x.oid, pg_get_functiondef(x.oid) ddl, x.proowner::regrole::text owner_name
    FROM pg_proc x WHERE x.pronamespace='public'::regnamespace AND x.prosecdef
      AND x.prorettype NOT IN ('trigger'::regtype,'event_trigger'::regtype)
      AND x.proname NOT IN ('current_org_id','user_org','legacy_default_org_id',
        'is_platform_super_admin','platform_create_organization','link_conta_max_identity_by_email',
        'mt_1b_gate','exclusive_capture_enabled')
      AND NOT EXISTS (SELECT 1 FROM mt_1b_helpers WHERE name=x.proname)
  LOOP
    INSERT INTO public.mt_1b_function_backup (signature,ddl,owner_name,anon_exec)
      VALUES (p.oid::regprocedure::text,p.ddl,p.owner_name,
        has_function_privilege('anon',p.oid,'EXECUTE')) ON CONFLICT DO NOTHING;
    EXECUTE format('ALTER FUNCTION %s OWNER TO mt_1b_definer',p.oid::regprocedure);

  END LOOP;
END $owner$;
-- A função de identidade permanece inacessível ao usuário final.
REVOKE EXECUTE ON FUNCTION public.link_conta_max_identity_by_email(text,text) FROM PUBLIC, anon, authenticated;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;


COMMIT;
