-- Contexto administrativo temporário por sessão GoTrue; jamais recebe org de header/claim.
-- Antes do go-live: dacmedia mantém o vínculo original com a Única. Sem login como outro usuário.
-- Reversão: 20261002000002_mt_platform_context.down.sql (remove sessões/auditoria de contexto).
BEGIN;
SET LOCAL search_path TO '';

CREATE TABLE public.mt_pc_backup (
  kind text NOT NULL, name text NOT NULL, ddl text NOT NULL,
  owner_name text, PRIMARY KEY (kind, name)
);
REVOKE ALL ON public.mt_pc_backup FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.mt_pc_backup(kind, name, ddl, owner_name)
SELECT 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text
FROM pg_proc p WHERE p.oid IN (
  'public.mt_ctx_org(boolean)'::regprocedure,
  'public.user_org(uuid)'::regprocedure,
  'public.has_role(uuid,public.app_role)'::regprocedure,
  'public.has_any_role(uuid,public.app_role[])'::regprocedure,
  'public.is_active_user(uuid)'::regprocedure,
  'public.relatorio_ocorrencias_concluidas()'::regprocedure,
  'public.imprimir_ocorrencias_concluidas(uuid[])'::regprocedure,
  'public.record_user_preview_event(uuid,text)'::regprocedure,
  'public.mt_1b_set_org()'::regprocedure,
  'public.platform_cancel_sale(uuid,text)'::regprocedure
);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_pc_backup WHERE kind='function') <> 10 THEN
    RAISE EXCEPTION 'Funcoes-base incompletas para contexto';
  END IF;
END $$;

-- Não reutilizar operational_impersonation_sessions: aquela tabela exige perfil de ator e alvo
-- NA MESMA agência e registra personificação, não alternância de organização.
CREATE TABLE public.platform_org_context_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  auth_session_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT pc_expires CHECK (expires_at > started_at AND expires_at <= started_at + interval '8 hours')
);
-- Preservar histórico após revogação do auth.sessions: a validade é consultada na tabela
-- do Auth, mas não há FK ON DELETE CASCADE que apague ações antigas.
CREATE UNIQUE INDEX platform_org_context_active_session_idx
  ON public.platform_org_context_sessions(auth_session_id) WHERE ended_at IS NULL;
CREATE INDEX platform_org_context_actor_idx ON public.platform_org_context_sessions(actor_user_id, expires_at)
  WHERE ended_at IS NULL;
CREATE TABLE public.platform_org_context_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  context_session_id uuid NOT NULL REFERENCES public.platform_org_context_sessions(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  table_name text NOT NULL, operation text NOT NULL, record_id text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX platform_org_context_actions_session_idx ON public.platform_org_context_actions(context_session_id, occurred_at);
REVOKE ALL ON public.platform_org_context_sessions, public.platform_org_context_actions
  FROM PUBLIC, anon, authenticated, service_role;

-- A chave JWT session_id é assinada pelo Auth e deve corresponder a uma sessão GoTrue ativa
-- do MESMO auth.uid(). Os dados de autorização vêm exclusivamente das tabelas do servidor.
CREATE FUNCTION public.mt_pc_auth_session() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _sid text := auth.jwt() ->> 'session_id'; _id uuid;
BEGIN
  IF auth.uid() IS NULL OR _sid IS NULL OR _sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  _id := _sid::uuid;
  IF EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = _id AND s.user_id = auth.uid()
             AND (s.not_after IS NULL OR s.not_after > now())) THEN RETURN _id; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.mt_pc_auth_session() FROM PUBLIC, anon, authenticated, service_role;
-- Chamado de funções SECURITY DEFINER com owner postgres; não é uma RPC pública.

CREATE FUNCTION public.mt_pc_context_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _id uuid;
BEGIN
  IF current_setting('role',true) <> 'authenticated' OR auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT c.id INTO _id FROM public.platform_org_context_sessions c
    JOIN public.platform_admins p ON p.user_id = c.actor_user_id
    JOIN public.organizations o ON o.id = c.organization_id AND o.status = 'ativa'
    JOIN public.profiles a ON a.id = c.actor_user_id AND a.ativo IS TRUE
   WHERE c.actor_user_id = auth.uid() AND c.auth_session_id = public.mt_pc_auth_session()
     AND c.ended_at IS NULL AND c.expires_at > now();
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.mt_pc_context_id() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.mt_pc_context_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT c.organization_id FROM public.platform_org_context_sessions c
  WHERE c.id = public.mt_pc_context_id()
$$;
REVOKE ALL ON FUNCTION public.mt_pc_context_org() FROM PUBLIC, anon, authenticated, service_role;

-- RPCs: só authenticated com platform_admins no banco; outros papéis não ganham EXECUTE.
-- Retorno JSON: {organization_id, organization_name, expires_at}; status/saída retornam null.
CREATE FUNCTION public.platform_current_org() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _result jsonb;
BEGIN
  SELECT jsonb_build_object('organization_id',c.organization_id,
    'organization_name',o.nome,'expires_at',c.expires_at)
    INTO _result FROM public.platform_org_context_sessions c
    JOIN public.organizations o ON o.id=c.organization_id
   WHERE c.id=public.mt_pc_context_id();
  RETURN _result;
END $$;
CREATE FUNCTION public.platform_enter_org(org_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _sid uuid; _id uuid; _out jsonb;
BEGIN
  IF current_setting('role',true) <> 'authenticated' OR _actor IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id=_actor)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=_actor AND ativo IS TRUE) THEN
    RAISE EXCEPTION 'Apenas administrador da plataforma ativo pode entrar' USING ERRCODE='42501';
  END IF;
  _sid := public.mt_pc_auth_session();
  IF _sid IS NULL THEN RAISE EXCEPTION 'Sessao de autenticacao ausente ou encerrada: entre novamente' USING ERRCODE='42501'; END IF;
  IF org_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=org_id AND status='ativa') THEN
    RAISE EXCEPTION 'Imobiliaria indisponivel' USING ERRCODE='42501';
  END IF;
  -- Fecha a sessão anterior sem reescrever a linha apontada por ações históricas.
  UPDATE public.platform_org_context_sessions SET ended_at=now()
    WHERE auth_session_id=_sid AND ended_at IS NULL;
  INSERT INTO public.platform_org_context_sessions (actor_user_id, auth_session_id, organization_id, expires_at)
  VALUES (_actor, _sid, org_id, now() + interval '8 hours')
  RETURNING id INTO _id;
  INSERT INTO public.platform_org_context_actions(context_session_id, actor_user_id,
    organization_id, table_name, operation, record_id)
  VALUES (_id,_actor,org_id,'platform_org_context_sessions','ENTER',_id::text);
  PERFORM set_config('mt.ctx','',false);
  PERFORM set_config('mt.ctx_m','',false);
  SELECT public.platform_current_org() INTO _out;
  IF _out IS NULL THEN RAISE EXCEPTION 'Contexto nao ativado' USING ERRCODE='42501'; END IF;
  RETURN _out;
END $$;
CREATE FUNCTION public.platform_exit_org() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _sid uuid; _id uuid; _org uuid;
BEGIN
  IF current_setting('role',true) <> 'authenticated' OR _actor IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id=_actor) THEN
    RAISE EXCEPTION 'Apenas administrador da plataforma pode sair' USING ERRCODE='42501';
  END IF;
  _sid := public.mt_pc_auth_session();
  IF _sid IS NULL THEN RAISE EXCEPTION 'Sessao de autenticacao ausente ou encerrada' USING ERRCODE='42501'; END IF;
  UPDATE public.platform_org_context_sessions SET ended_at=now()
    WHERE actor_user_id=_actor AND auth_session_id=_sid AND ended_at IS NULL
    RETURNING id,organization_id INTO _id,_org;
  IF _id IS NOT NULL THEN
    INSERT INTO public.platform_org_context_actions(context_session_id,actor_user_id,
      organization_id,table_name,operation,record_id)
    VALUES (_id,_actor,_org,'platform_org_context_sessions','EXIT',_id::text);
  END IF;
  PERFORM set_config('mt.ctx','',false);
  PERFORM set_config('mt.ctx_m','',false);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.platform_enter_org(uuid), public.platform_exit_org(),
  public.platform_current_org() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.platform_enter_org(uuid), public.platform_exit_org(),
  public.platform_current_org() TO authenticated;

-- Base da 2g: mantém memoização por comando para NÃO piorar o dashboard.
-- Inclui session_id na chave do cache, pois uma mesma conexão pode trocar o JWT do mesmo uid.
CREATE OR REPLACE FUNCTION public.mt_ctx_org(_current boolean) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _uid uuid := auth.uid(); _sid text := coalesce(auth.jwt() ->> 'session_id','-');
  _key text := statement_timestamp()::text || '|' || coalesce(_uid::text, '-') || '|' || _sid;
  _val text := current_setting('mt.ctx', true);
  _u uuid; _c uuid; _override uuid;
BEGIN
  IF _val IS NOT NULL AND split_part(_val, '#', 1) = _key THEN
    RETURN nullif(split_part(_val, '#', CASE WHEN _current THEN 3 ELSE 2 END), '')::uuid;
  END IF;
  IF _uid IS NOT NULL THEN
    _override := public.mt_pc_context_org();
    IF _override IS NOT NULL THEN
      _u := _override; _c := _override;
    ELSE
      SELECT m.organization_id INTO _u FROM public.organization_members m
        JOIN public.organizations o ON o.id = m.organization_id
       WHERE m.user_id = _uid AND m.ativo AND o.status = 'ativa';
      IF _u IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND ativo IS TRUE) THEN
        _c := _u;
      END IF;
    END IF;
  END IF;
  PERFORM set_config('mt.ctx', _key || '#' || coalesce(_u::text, '') || '#' || coalesce(_c::text, ''), false);
  PERFORM set_config('mt.ctx_pc', CASE WHEN _override IS NOT NULL THEN '1' ELSE '0' END, false);
  PERFORM set_config('mt.ctx_m', _key || '#', false);
  RETURN CASE WHEN _current THEN _c ELSE _u END;
END $$;

-- Lê o bit de contexto calculado pelo mt_ctx_org UMA vez por comando; não varre
-- sessões, membros e perfis em cada linha das consultas de dashboard.
CREATE FUNCTION public.mt_pc_in_context() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  PERFORM public.mt_ctx_org(true);
  RETURN current_setting('mt.ctx_pc',true)='1';
END $$;
REVOKE ALL ON FUNCTION public.mt_pc_in_context() FROM PUBLIC, anon, authenticated, service_role;

-- user_org(self) tem de seguir a mesma agência que current_org_id() para guards de
-- can_view_sale, vendas e gatilhos mt_set_own_org. Outros usuários nunca ganham nova filiação.
CREATE OR REPLACE FUNCTION public.user_org(_user uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _org uuid;
BEGIN
  IF _user IS NULL THEN RETURN NULL; END IF;
  IF _user = auth.uid() THEN RETURN public.mt_ctx_org(false); END IF;
  SELECT m.organization_id INTO _org FROM public.organization_members m
    JOIN public.organizations o ON o.id=m.organization_id
   WHERE m.user_id=_user AND m.ativo AND o.status='ativa';
  IF _org IS NULL THEN RETURN NULL; END IF;
  IF _org = public.mt_ctx_org(false)
     OR current_setting('role',true)='service_role'
     OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres')) THEN
    RETURN _org;
  END IF;
  RETURN NULL;
END $$;

-- Papéis virtuais APENAS para o próprio ator da sessão DB válida. Nunca cria user_roles
-- ou organization_members na agência destino. O teste gate/mt_in_ctx_org continua obrigatório.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _user_id=auth.uid() AND public.mt_pc_in_context() THEN
    RETURN _role IS NOT NULL AND public.mt_1b_gate()
      AND coalesce(public.mt_in_ctx_org(_user_id),false);
  END IF;
  RETURN (SELECT COALESCE((SELECT public.is_active_user(_user_id)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)),false)
    AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_user_id))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END $$;
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[]) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _user_id=auth.uid() AND public.mt_pc_in_context() THEN
    RETURN coalesce(cardinality(_roles)>0,false) AND public.mt_1b_gate()
      AND coalesce(public.mt_in_ctx_org(_user_id),false);
  END IF;
  RETURN (SELECT COALESCE((SELECT public.is_active_user(_user_id)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=ANY(_roles))),false)
    AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_user_id))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END $$;
CREATE OR REPLACE FUNCTION public.is_active_user(_user uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _user=auth.uid() AND public.mt_pc_in_context() THEN
    RETURN public.mt_1b_gate() AND coalesce(public.mt_in_ctx_org(_user),false);
  END IF;
  RETURN (SELECT COALESCE((SELECT _user IS NOT NULL AND
    COALESCE((SELECT ativo FROM public.profiles WHERE id=_user),true)),false)
    AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_user)
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id=_user AND ativo IS TRUE))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END $$;

-- Guards SECURITY DEFINER legados dos relatórios consultavam user_roles diretamente.
-- Troca só o predicado de papéis por helper com contexto; demais regras permanecem intactas.
DO $patch$
DECLARE _ddl text; _old text; _new text; _name text;
BEGIN
  FOREACH _name IN ARRAY ARRAY['public.relatorio_ocorrencias_concluidas()',
                                'public.imprimir_ocorrencias_concluidas(uuid[])'] LOOP
    SELECT ddl INTO _ddl FROM public.mt_pc_backup WHERE name=_name;
    IF _name='public.relatorio_ocorrencias_concluidas()' THEN
      _old := E'NOT EXISTS (\n      SELECT 1 FROM public.user_roles ur\n      WHERE ur.user_id = caller_id\n        AND ur.role = ANY (ARRAY[\n          ''corretor'', ''gestor'', ''team_leader'', ''financeiro'',\n          ''admin'', ''super_admin'', ''juridico'', ''lancamento''\n        ]::public.app_role[])\n    )';
      _new := 'NOT public.has_any_role(caller_id, ARRAY[''corretor'',''gestor'',''team_leader'',''financeiro'',''admin'',''super_admin'',''juridico'',''lancamento'']::public.app_role[])';
    ELSE
      _old := E'NOT EXISTS (\n      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = caller_id\n        AND ur.role = ANY (ARRAY[''gestor'', ''team_leader'']::public.app_role[])\n    )';
      _new := 'NOT public.has_any_role(caller_id, ARRAY[''gestor'',''team_leader'']::public.app_role[])';
    END IF;
    IF position(_old IN _ddl)=0 THEN RAISE EXCEPTION 'Guard nao encontrado em %', _name; END IF;
    EXECUTE replace(_ddl,_old,_new);
  END LOOP;
END $patch$;

-- Só no contexto validado, o super admin pode iniciar venda para um corretor da agência
-- destino. A policy RESTRICTIVE org_isolation + FK (corretor_id,org) continuam obrigatórias.
CREATE POLICY sales_platform_context_insert ON public.sales FOR INSERT TO authenticated
  WITH CHECK (public.platform_current_org() IS NOT NULL
    AND public.has_role(auth.uid(),'super_admin'::public.app_role));

-- O gatilho existente que atribui organization_id por pai/perfil deve aceitar o ator
-- (e só o ator) como autor na agência destino. Outros IDs seguem exigindo perfil local.
DO $patch$ DECLARE d text; BEGIN
  SELECT ddl INTO d FROM public.mt_pc_backup WHERE name='public.mt_1b_set_org()';
  IF position('IF _found IS NULL THEN' IN d)=0 THEN RAISE EXCEPTION 'mt_1b_set_org inesperada'; END IF;
  d := replace(d, 'IF _found IS NULL THEN',
    E'IF _t = ''profiles'' AND _id = auth.uid() AND public.mt_pc_context_org() IS NOT NULL\n        THEN _found := public.mt_pc_context_org(); END IF;\n        IF _found IS NULL THEN');
  EXECUTE d;
END $patch$;

-- As FKs compostas de AUTORIA impedem que o administrador (cujo perfil fica na Única)
-- registre a própria autoria na agência B. Substituição restrita às 8 colunas de autor:
-- FK normal para profiles(id) + trigger que preserva MESMA regra de agência para todos,
-- exceto auth.uid() dentro de contexto válido na própria organização. Demais FKs intocadas.
CREATE TABLE public.mt_pc_author_fks (
  table_name text PRIMARY KEY, column_name text NOT NULL, constraint_name text NOT NULL,
  fk_ddl text NOT NULL
);
REVOKE ALL ON public.mt_pc_author_fks FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.mt_pc_author_fks(table_name,column_name,constraint_name,fk_ddl)
SELECT c.conrelid::regclass::text, a.attname, c.conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
WHERE c.conname IN (
  'mt_1b_activity_logs_autor_id_org_fk',
  'mt_1b_sale_comments_autor_id_org_fk',
  'mt_1b_sale_status_history_autor_id_org_fk',
  'mt_1b_metas_created_by_org_fk',
  'mt_1b_exclusive_capture_setting_history_actor_id_org_fk',
  'mt_1b_exclusive_history_actor_id_org_fk',
  'mt_1b_exclusive_documents_uploaded_by_org_fk',
  'mt_1b_user_preview_audit_actor_user_id_org_fk'
);
DO $$ BEGIN IF (SELECT count(*) FROM public.mt_pc_author_fks)<>8 THEN
  RAISE EXCEPTION 'FKs de autoria incompletas'; END IF; END $$;
CREATE FUNCTION public.mt_pc_author_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _author uuid := nullif(to_jsonb(NEW)->>TG_ARGV[0],'')::uuid;
BEGIN
  IF _author IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=_author AND p.organization_id=NEW.organization_id
  ) AND NOT (_author=auth.uid() AND NEW.organization_id=public.mt_pc_context_org()) THEN
    RAISE EXCEPTION 'Autor de outra organizacao' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mt_pc_author_scope() FROM PUBLIC, anon, authenticated, service_role;
DO $f$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM public.mt_pc_author_fks LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.table_name,r.constraint_name);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles(id)',
      r.table_name,r.constraint_name,r.column_name);
    EXECUTE format('CREATE TRIGGER trg_01_pc_author_scope BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.mt_pc_author_scope(%L)',r.table_name,r.column_name);
  END LOOP;
END $f$;

-- Impede que platform_cancel_sale, SECURITY DEFINER do dono da plataforma, atue fora da
-- agência selecionada (fora de contexto mantém o comportamento antigo, como solicitado).
DO $patch$ DECLARE d text; BEGIN
  SELECT ddl INTO d FROM public.mt_pc_backup WHERE name='public.platform_cancel_sale(uuid,text)';
  IF position('IF _prev IS NULL THEN' IN d)=0 THEN RAISE EXCEPTION 'platform_cancel_sale inesperada'; END IF;
  d := replace(d,'IF _prev IS NULL THEN',
    E'IF public.mt_pc_context_org() IS NOT NULL AND _org IS DISTINCT FROM public.mt_pc_context_org() THEN\n    RAISE EXCEPTION ''Venda fora da imobiliaria atual'' USING ERRCODE=''42501'';\n  END IF;\n  IF _prev IS NULL THEN');
  EXECUTE d;
END $patch$;

-- Auditoria central de toda escrita em tabelas org_isolation. O gatilho AFTER vê a
-- organization_id FINAL, inclusive em operações dos demais gatilhos/RPCs definer.
CREATE FUNCTION public.mt_pc_audit_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _row jsonb := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  _ctx uuid; _org uuid;
BEGIN
  _ctx := public.mt_pc_context_id();
  IF _ctx IS NOT NULL THEN
    _org := (_row->>'organization_id')::uuid;
    -- Se uma função definer gravar fora do contexto, a transação inteira falha fechada.
    IF _org IS DISTINCT FROM public.mt_pc_context_org() THEN
      RAISE EXCEPTION 'Escrita fora da imobiliaria atual' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.platform_org_context_actions(context_session_id,actor_user_id,
      organization_id,table_name,operation,record_id)
    VALUES (_ctx,auth.uid(),_org,TG_TABLE_NAME,TG_OP,
      coalesce(_row->>'id',_row->>'sale_id',_row->>'user_id'));
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.mt_pc_audit_write() FROM PUBLIC, anon, authenticated, service_role;
DO $audit$ DECLARE r record; n int:=0; BEGIN
  FOR r IN SELECT schemaname,tablename FROM pg_policies
    WHERE schemaname='public' AND policyname='org_isolation' LOOP
    EXECUTE format('CREATE TRIGGER trg_zz_pc_audit AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.mt_pc_audit_write()',r.schemaname,r.tablename);
    n:=n+1;
  END LOOP;
  IF n<39 THEN RAISE EXCEPTION 'Tabelas de agencia nao auditadas (%)',n; END IF;
END $audit$;

-- A sessão muda no meio do comando de entrada/saída, e a 2g memoriza por comando;
-- inválida-se também em operações administrativas do banco.
CREATE TRIGGER mt_pc_ctx_invalidate AFTER INSERT OR DELETE OR UPDATE OR TRUNCATE
  ON public.platform_org_context_sessions FOR EACH STATEMENT EXECUTE FUNCTION public.mt_ctx_invalidate();
CREATE TRIGGER mt_pc_admin_invalidate AFTER INSERT OR DELETE OR UPDATE OR TRUNCATE
  ON public.platform_admins FOR EACH STATEMENT EXECUTE FUNCTION public.mt_ctx_invalidate();
COMMIT;
