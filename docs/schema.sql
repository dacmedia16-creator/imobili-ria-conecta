-- ============================================================
-- Schema completo (public) - Migration idempotente
-- Gerado automaticamente a partir do banco atual
-- ============================================================

-- ============================================================
-- ENUMS / TYPES
-- ============================================================
DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='app_role' AND n.nspname='public') THEN
    CREATE TYPE public.app_role AS ENUM ('corretor', 'coordenador', 'gestor', 'juridico', 'financeiro', 'admin', 'super_admin');
  END IF;
END $mig$;

DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='doc_status' AND n.nspname='public') THEN
    CREATE TYPE public.doc_status AS ENUM ('pendente', 'enviado', 'aprovado', 'recusado');
  END IF;
END $mig$;

DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='sale_status' AND n.nspname='public') THEN
    CREATE TYPE public.sale_status AS ENUM ('rascunho', 'enviada_revisao', 'devolvida_ajuste', 'aprovada_gestor', 'enviada_juridico', 'em_elaboracao_contrato', 'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_concluida', 'arquivada', 'cancelada', 'contrato_conferencia_gestor', 'contrato_conferencia_corretor', 'contrato_ok_corretor', 'ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor');
  END IF;
END $mig$;


-- ============================================================
-- FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND (
      s.corretor_id = _user
      OR public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (public.has_role(_user,'gestor') AND public.is_lead_of(_user, s.corretor_id))
      OR (public.has_role(_user,'juridico') AND s.status::text = ANY (ARRAY[
        'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
        'aguardando_assinatura','contrato_assinado',
        'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
      ]))
    )
  )
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email,'@',1)), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'corretor');
  RETURN NEW;
END; $function$
;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$function$
;

CREATE OR REPLACE FUNCTION public.is_lead_of(_lider uuid, _membro uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    LEFT JOIN public.teams pt ON pt.id = t.parent_team_id
    WHERE tm.membro_id = _membro AND (t.lider_id = _lider OR pt.lider_id = _lider)
  )
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_team_leader_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(NEW.lider_id, 'gestor') THEN
    RAISE EXCEPTION 'O líder de uma equipe precisa ter o papel gestor.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$
;

CREATE OR REPLACE FUNCTION public.enforce_team_depth()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.parent_team_id IS NOT NULL THEN
    IF NEW.parent_team_id = NEW.id THEN
      RAISE EXCEPTION 'Uma equipe não pode ser sub-equipe dela mesma.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.teams t WHERE t.id = NEW.parent_team_id AND t.parent_team_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Só é permitido 1 nível de sub-equipes.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $function$
;

-- leads_team_or_parent/sees_team/sees_own_team_leader existem pra evitar recursão de RLS:
-- teams_select consultava team_members direto, team_members_select consultava teams direto,
-- e o Postgres detectava isso como recursão infinita (42P17). Rodando como SECURITY DEFINER,
-- essas consultas internas não reavaliam a RLS de teams/team_members, quebrando o ciclo.
CREATE OR REPLACE FUNCTION public.leads_team_or_parent(_team_id uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = _team_id AND (
      t.lider_id = _user
      OR EXISTS (SELECT 1 FROM public.teams pt WHERE pt.id = t.parent_team_id AND pt.lider_id = _user)
    )
  )
$function$
;

CREATE OR REPLACE FUNCTION public.sees_team(_team_id uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.leads_team_or_parent(_team_id, _user)
    OR EXISTS (SELECT 1 FROM public.teams ct WHERE ct.parent_team_id = _team_id AND ct.lider_id = _user)
    OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = _team_id AND tm.membro_id = _user)
$function$
;

CREATE OR REPLACE FUNCTION public.sees_own_team_leader(_profile_id uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    LEFT JOIN public.teams pt ON pt.id = t.parent_team_id
    WHERE tm.membro_id = _user AND (t.lider_id = _profile_id OR pt.lider_id = _profile_id)
  )
$function$
;

-- Restringe edição por status/papel além da visibilidade de can_view_sale — ex.: corretor só
-- edita a própria venda em rascunho/devolvida_ajuste/contrato_conferencia_corretor (etapas que
-- são "a vez dele"), gestor só nos status em que é a vez do gestor, etc.
CREATE OR REPLACE FUNCTION public.can_edit_sale_stage(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.sales s
    where s.id = _sale_id
    and (
      public.has_any_role(_user, array['financeiro','admin','super_admin']::public.app_role[])
      or (s.corretor_id = _user and s.status::text = any(array['rascunho','devolvida_ajuste','contrato_conferencia_corretor']))
      or (public.has_role(_user,'gestor') and s.status::text = any(array[
            'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
            'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor']))
      or (public.has_role(_user,'juridico') and s.status::text = any(array['aprovada_gestor','em_elaboracao_contrato']))
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_sale_locked(_sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.occurrences o
    WHERE o.sale_id = _sale_id AND o.aceita_financeiro = true
  ) OR EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND s.status::text = 'ocorrencia_concluida'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.log_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload)
  VALUES (
    auth.uid(), NULL,
    CASE WHEN TG_OP = 'INSERT' THEN 'role_granted' ELSE 'role_revoked' END,
    jsonb_build_object(
      'target_user', COALESCE(NEW.user_id, OLD.user_id),
      'role', COALESCE(NEW.role, OLD.role)::text
    )
  );
  RETURN COALESCE(NEW, OLD);
END; $function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$
;

-- Reforça no servidor a máquina de estados do fluxo corretor -> gestor -> jurídico -> financeiro
-- (mesma lógica de vendas.$id.tsx), para que nenhum papel pule etapas via UPDATE direto na API.
CREATE OR REPLACE FUNCTION public.validate_sale_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  is_owner boolean := (OLD.corretor_id = auth.uid());
  allowed boolean := false;
  from_status text := OLD.status::text;
  to_status text := NEW.status::text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF public.has_any_role(actor, ARRAY['admin','super_admin']::app_role[]) THEN
    RETURN NEW;
  END IF;

  IF is_owner AND (from_status, to_status) IN (
    ('rascunho', 'enviada_revisao'),
    ('devolvida_ajuste', 'enviada_revisao'),
    ('contrato_conferencia_corretor', 'contrato_ok_corretor'),
    ('contrato_conferencia_corretor', 'contrato_conferencia_gestor')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_role(actor, 'gestor') AND (from_status, to_status) IN (
    ('enviada_revisao', 'aprovada_gestor'),
    ('enviada_revisao', 'devolvida_ajuste'),
    ('contrato_conferencia_gestor', 'contrato_conferencia_corretor'),
    ('contrato_conferencia_gestor', 'aguardando_assinatura'),
    ('contrato_conferencia_gestor', 'em_elaboracao_contrato'),
    ('contrato_ok_corretor', 'aguardando_assinatura'),
    ('contrato_ok_corretor', 'contrato_conferencia_corretor'),
    ('aguardando_assinatura', 'contrato_assinado'),
    ('contrato_assinado', 'ocorrencia_pendente'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_role(actor, 'juridico') AND (from_status, to_status) IN (
    ('aprovada_gestor', 'em_elaboracao_contrato'),
    ('aprovada_gestor', 'enviada_revisao'),
    ('aprovada_gestor', 'devolvida_ajuste'),
    ('em_elaboracao_contrato', 'contrato_conferencia_gestor'),
    ('em_elaboracao_contrato', 'enviada_revisao'),
    ('em_elaboracao_contrato', 'devolvida_ajuste')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_role(actor, 'financeiro') AND (from_status, to_status) IN (
    ('ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor'),
    ('ocorrencia_analise_financeiro', 'ocorrencia_concluida'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida'),
    ('ocorrencia_concluida', 'ocorrencia_pendente')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Transição de status não permitida para este usuário: % -> %', from_status, to_status
      USING ERRCODE = '42501';
  END IF;

  IF from_status = 'aguardando_assinatura' AND to_status = 'contrato_assinado' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sale_documents d
      WHERE d.sale_id = OLD.id AND d.tipo = 'contrato_assinado'
    ) THEN
      RAISE EXCEPTION 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;


-- ============================================================
-- TABELAS
-- ============================================================

-- ===== TABELA: profiles =====
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  nome text NOT NULL DEFAULT ''::text,
  email text,
  telefone text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles AS PERMISSIVE FOR INSERT TO  WITH CHECK (((id = auth.uid()) OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role])));
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles AS PERMISSIVE FOR SELECT TO  USING (((id = auth.uid()) OR has_any_role(auth.uid(), ARRAY['gestor'::app_role, 'juridico'::app_role, 'financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) OR sees_own_team_leader(profiles.id, auth.uid())));
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING (((id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))) WITH CHECK (((id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== TABELA: sales =====
CREATE TABLE IF NOT EXISTS public.sales (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  corretor_id uuid NOT NULL,
  status sale_status NOT NULL DEFAULT 'rascunho'::sale_status,
  imovel_id text,
  matricula text,
  iptu text,
  codigo_interno text,
  imovel_observacoes text,
  coordenador_id uuid,
  team_leader_id uuid,
  corretor_captador text,
  corretor_vendedor text,
  indicador text,
  valor_anunciado numeric(14,2),
  valor_negociado numeric(14,2),
  percentual_comissao numeric(6,3),
  valor_total_comissao numeric(14,2),
  forma_pagamento text,
  negociacao_observacoes text,
  posse_data date,
  posse_observacoes text,
  comissao_valor numeric(14,2),
  comissao_quando text,
  comissao_observacoes text,
  valor_comissao_captador numeric(14,2),
  valor_comissao_vendedor numeric(14,2),
  valor_comissao_imobiliaria numeric(14,2),
  percentual_comissao_captador numeric(6,3),
  percentual_comissao_vendedor numeric(6,3),
  valor_comissao_indicador numeric(14,2),
  percentual_comissao_indicador numeric(6,3),
  indicador_lado text,
  tempo_venda text,
  midia text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sales_pkey PRIMARY KEY (id),
  CONSTRAINT sales_coordenador_id_fkey FOREIGN KEY (coordenador_id) REFERENCES auth.users(id),
  CONSTRAINT sales_corretor_id_fkey FOREIGN KEY (corretor_id) REFERENCES auth.users(id),
  CONSTRAINT sales_team_leader_id_fkey FOREIGN KEY (team_leader_id) REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_sales_corretor ON public.sales USING btree (corretor_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON public.sales USING btree (status);
CREATE INDEX IF NOT EXISTS idx_sales_corretor_status ON public.sales USING btree (corretor_id, status);
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS delete_sales_por_papel ON public.sales;
CREATE POLICY delete_sales_por_papel ON public.sales AS PERMISSIVE FOR DELETE TO authenticated USING ((has_any_role(auth.uid(), ARRAY['super_admin'::app_role, 'admin'::app_role, 'financeiro'::app_role]) OR (corretor_id = auth.uid()) OR (has_role(auth.uid(), 'gestor'::app_role) AND is_lead_of(auth.uid(), corretor_id))));
DROP POLICY IF EXISTS sales_delete_admin ON public.sales;
CREATE POLICY sales_delete_admin ON public.sales AS PERMISSIVE FOR DELETE TO  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]));
DROP POLICY IF EXISTS sales_insert_corretor ON public.sales;
CREATE POLICY sales_insert_corretor ON public.sales AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((corretor_id = auth.uid()));
DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales AS PERMISSIVE FOR SELECT TO authenticated USING (((corretor_id = auth.uid()) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) OR (has_role(auth.uid(), 'gestor'::app_role) AND is_lead_of(auth.uid(), corretor_id)) OR (has_role(auth.uid(), 'juridico'::app_role) AND ((status)::text = ANY (ARRAY['aprovada_gestor'::text, 'enviada_juridico'::text, 'em_elaboracao_contrato'::text, 'contrato_conferencia_gestor'::text, 'contrato_conferencia_corretor'::text, 'contrato_ok_corretor'::text, 'aguardando_assinatura'::text, 'contrato_assinado'::text, 'ocorrencia_pendente'::text, 'ocorrencia_analise_financeiro'::text, 'ocorrencia_devolvida_gestor'::text, 'ocorrencia_concluida'::text])))));
DROP POLICY IF EXISTS sales_update_owner_draft ON public.sales;
-- WITH CHECK também exige can_edit_sale_stage(auth.uid(), id) — trava por status/papel além da
-- visibilidade de can_view_sale (ex.: corretor só edita em rascunho/devolvida_ajuste/
-- contrato_conferencia_corretor, gestor só nos status onde é a vez dele, etc.).
CREATE POLICY sales_update_owner_draft ON public.sales AS PERMISSIVE FOR UPDATE TO  USING ((can_view_sale(auth.uid(), id) AND ((NOT is_sale_locked(id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])))) WITH CHECK ((can_view_sale(auth.uid(), id) AND ((NOT is_sale_locked(id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage(auth.uid(), id)));
DROP TRIGGER IF EXISTS trg_sales_updated ON public.sales;
CREATE TRIGGER trg_sales_updated BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_validate_sale_status ON public.sales;
CREATE TRIGGER trg_validate_sale_status BEFORE UPDATE ON public.sales FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION validate_sale_status_transition();

-- ===== TABELA: teams =====
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lider_id uuid NOT NULL,
  nome text NOT NULL DEFAULT ''::text,
  cor text NOT NULL DEFAULT '#6366f1'::text,
  parent_team_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT teams_pkey PRIMARY KEY (id),
  CONSTRAINT teams_lider_id_fkey FOREIGN KEY (lider_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT teams_parent_team_id_fkey FOREIGN KEY (parent_team_id) REFERENCES public.teams(id) ON DELETE CASCADE
);
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_teams_leader_role ON public.teams;
CREATE TRIGGER trg_teams_leader_role BEFORE INSERT OR UPDATE OF lider_id ON public.teams FOR EACH ROW EXECUTE FUNCTION enforce_team_leader_role();
DROP TRIGGER IF EXISTS trg_teams_depth ON public.teams;
CREATE TRIGGER trg_teams_depth BEFORE INSERT OR UPDATE OF parent_team_id ON public.teams FOR EACH ROW EXECUTE FUNCTION enforce_team_depth();
DROP POLICY IF EXISTS teams_select ON public.teams;
-- Gestor só vê/gerencia a própria equipe (+ sub-equipes dela, + a equipe-mãe pra contexto).
-- Usa sees_team/leads_team_or_parent (SECURITY DEFINER) em vez de EXISTS direto em team_members
-- pra não recair na recursão de RLS corrigida em 20260721190000_fix_teams_rls_recursion.sql.
-- lider_id = auth.uid() aparece direto (sem passar por sees_team) pra funcionar mesmo quando a
-- linha acaba de ser inserida na mesma transação (INSERT ... RETURNING / .insert().select()),
-- caso em que uma reconsulta da própria tabela por id ainda não enxerga a linha nova.
CREATE POLICY teams_select ON public.teams AS PERMISSIVE FOR SELECT TO authenticated USING ((has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR (lider_id = auth.uid()) OR sees_team(teams.id, auth.uid())));
DROP POLICY IF EXISTS teams_write ON public.teams;
-- WITH CHECK usa lider_id/parent_team_id direto (colunas da própria linha) em vez de
-- leads_team_or_parent(teams.id, ...) pro mesmo motivo: numa linha nova, id ainda não existe
-- na tabela pra essa função encontrar via subquery.
CREATE POLICY teams_write ON public.teams AS PERMISSIVE FOR ALL TO authenticated USING ((has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR leads_team_or_parent(teams.id, auth.uid()))) WITH CHECK ((has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR (lider_id = auth.uid()) OR ((parent_team_id IS NOT NULL) AND leads_team_or_parent(parent_team_id, auth.uid()))));
DROP TRIGGER IF EXISTS trg_teams_updated ON public.teams;
CREATE TRIGGER trg_teams_updated BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== TABELA: team_members =====
CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  membro_id uuid NOT NULL,
  team_id uuid NOT NULL,
  tipo text NOT NULL DEFAULT 'coordenador'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT team_members_membro_id_key UNIQUE (membro_id),
  CONSTRAINT team_members_pkey PRIMARY KEY (id),
  CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  CONSTRAINT team_members_membro_id_fkey FOREIGN KEY (membro_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_members_select ON public.team_members;
CREATE POLICY team_members_select ON public.team_members AS PERMISSIVE FOR SELECT TO authenticated USING ((has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR (membro_id = auth.uid()) OR sees_team(team_members.team_id, auth.uid())));
DROP POLICY IF EXISTS team_members_write ON public.team_members;
CREATE POLICY team_members_write ON public.team_members AS PERMISSIVE FOR ALL TO authenticated USING ((has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR leads_team_or_parent(team_members.team_id, auth.uid()))) WITH CHECK ((has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR leads_team_or_parent(team_members.team_id, auth.uid())));

-- ===== TABELA: user_roles =====
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role),
  CONSTRAINT user_roles_pkey PRIMARY KEY (id),
  CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_roles_admin_write ON public.user_roles;
CREATE POLICY user_roles_admin_write ON public.user_roles AS PERMISSIVE FOR ALL TO  USING (((auth.uid() <> user_id) AND (has_role(auth.uid(), 'super_admin'::app_role) OR (has_role(auth.uid(), 'admin'::app_role) AND (role <> ALL (ARRAY['admin'::app_role, 'super_admin'::app_role])))))) WITH CHECK (((auth.uid() <> user_id) AND (has_role(auth.uid(), 'super_admin'::app_role) OR (has_role(auth.uid(), 'admin'::app_role) AND (role <> ALL (ARRAY['admin'::app_role, 'super_admin'::app_role]))))));
DROP POLICY IF EXISTS user_roles_self_select ON public.user_roles;
CREATE POLICY user_roles_self_select ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)));
DROP TRIGGER IF EXISTS trg_log_role_change_del ON public.user_roles;
CREATE TRIGGER trg_log_role_change_del AFTER DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION log_role_change();
DROP TRIGGER IF EXISTS trg_log_role_change_ins ON public.user_roles;
CREATE TRIGGER trg_log_role_change_ins AFTER INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION log_role_change();

-- ===== TABELA: activity_logs =====
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  autor_id uuid,
  sale_id uuid,
  acao text NOT NULL,
  payload jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT activity_logs_pkey PRIMARY KEY (id),
  CONSTRAINT activity_logs_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES auth.users(id),
  CONSTRAINT activity_logs_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_target ON public.activity_logs USING btree (((payload ->> 'target_user'::text)));
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS log_insert ON public.activity_logs;
CREATE POLICY log_insert ON public.activity_logs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((autor_id = auth.uid()));
DROP POLICY IF EXISTS log_view ON public.activity_logs;
CREATE POLICY log_view ON public.activity_logs AS PERMISSIVE FOR SELECT TO  USING ((((sale_id IS NULL) AND has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role])) OR ((sale_id IS NOT NULL) AND can_view_sale(auth.uid(), sale_id))));

-- ===== TABELA: notifications =====
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sale_id uuid,
  tipo text NOT NULL,
  titulo text NOT NULL,
  mensagem text,
  lida boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_lida ON public.notifications USING btree (user_id, lida);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications USING btree (user_id, lida, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_insert ON public.notifications;
CREATE POLICY notif_insert ON public.notifications AS PERMISSIVE FOR INSERT TO  WITH CHECK (((user_id = auth.uid()) OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'financeiro'::app_role, 'gestor'::app_role, 'juridico'::app_role])));
DROP POLICY IF EXISTS notif_self ON public.notifications;
CREATE POLICY notif_self ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
DROP POLICY IF EXISTS notif_update_self ON public.notifications;
CREATE POLICY notif_update_self ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

-- ===== TABELA: occurrences =====
CREATE TABLE IF NOT EXISTS public.occurrences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  codigo_imovel text,
  tempo_venda text,
  data_assinatura date,
  nota_fiscal_obrigatoria boolean DEFAULT false,
  midia text,
  valor_anunciado numeric(14,2),
  valor_negociado numeric(14,2),
  percentual_comissao numeric(6,3),
  valor_comissao numeric(14,2),
  financiamento boolean DEFAULT false,
  financiamento_valor numeric(14,2),
  financiamento_banco text,
  financiamento_correspondente text,
  financiamento_previsao date,
  prev_recebimento_valor numeric(14,2),
  prev_recebimento_data date,
  prev_recebimento_forma text,
  prev_recebimento2_valor numeric,
  prev_recebimento2_data date,
  prev_recebimento2_forma text,
  prev_recebimento3_valor numeric,
  prev_recebimento3_data date,
  prev_recebimento3_forma text,
  observacoes text,
  status text NOT NULL DEFAULT 'pendente'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  reopen_reason text,
  reopened_at timestamp with time zone,
  reopened_by uuid,
  aceita_financeiro boolean NOT NULL DEFAULT false,
  aceita_financeiro_em timestamp with time zone,
  aceita_financeiro_por uuid,
  CONSTRAINT occurrences_sale_id_key UNIQUE (sale_id),
  CONSTRAINT occurrences_pkey PRIMARY KEY (id),
  CONSTRAINT occurrences_aceita_financeiro_por_fkey FOREIGN KEY (aceita_financeiro_por) REFERENCES auth.users(id),
  CONSTRAINT occurrences_reopened_by_fkey FOREIGN KEY (reopened_by) REFERENCES auth.users(id),
  CONSTRAINT occurrences_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_occurrences_sale ON public.occurrences USING btree (sale_id);
ALTER TABLE public.occurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS occ_view ON public.occurrences;
CREATE POLICY occ_view ON public.occurrences AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale(auth.uid(), sale_id));
DROP POLICY IF EXISTS occ_write ON public.occurrences;
CREATE POLICY occ_write ON public.occurrences AS PERMISSIVE FOR ALL TO  USING ((has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]) AND can_view_sale(auth.uid(), sale_id))) WITH CHECK ((has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]) AND can_view_sale(auth.uid(), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))));
DROP TRIGGER IF EXISTS trg_occ_updated ON public.occurrences;
CREATE TRIGGER trg_occ_updated BEFORE UPDATE ON public.occurrences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== TABELA: sale_bank_accounts =====
CREATE TABLE IF NOT EXISTS public.sale_bank_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  titular text,
  banco text,
  agencia text,
  conta text,
  pix text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sale_bank_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT sale_bank_accounts_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);
ALTER TABLE public.sale_bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_bank_rw ON public.sale_bank_accounts;
CREATE POLICY sale_bank_rw ON public.sale_bank_accounts AS PERMISSIVE FOR ALL TO  USING (can_view_sale(auth.uid(), sale_id)) WITH CHECK ((can_view_sale(auth.uid(), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))));

-- ===== TABELA: sale_documents =====
CREATE TABLE IF NOT EXISTS public.sale_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  tipo text NOT NULL,
  storage_path text,
  file_name text,
  uploaded_by uuid,
  status doc_status NOT NULL DEFAULT 'pendente'::doc_status,
  motivo_recusa text,
  versao integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  extraction_status text NOT NULL DEFAULT 'none'::text,
  parte text NOT NULL DEFAULT 'outros'::text,
  CONSTRAINT sale_documents_pkey PRIMARY KEY (id),
  CONSTRAINT sale_documents_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT sale_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id),
  CONSTRAINT sale_documents_extraction_status_check CHECK ((extraction_status = ANY (ARRAY['none'::text, 'pending'::text, 'done'::text, 'failed'::text]))),
  CONSTRAINT sale_documents_parte_check CHECK ((parte = ANY (ARRAY['comprador_1'::text, 'comprador_2'::text, 'vendedor_1'::text, 'vendedor_2'::text, 'imovel'::text, 'outros'::text])))
);
CREATE INDEX IF NOT EXISTS idx_docs_sale_tipo ON public.sale_documents USING btree (sale_id, tipo);
CREATE INDEX IF NOT EXISTS sale_documents_sale_parte_idx ON public.sale_documents USING btree (sale_id, parte);
ALTER TABLE public.sale_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_docs_delete ON public.sale_documents;
CREATE POLICY sale_docs_delete ON public.sale_documents AS PERMISSIVE FOR DELETE TO  USING ((can_view_sale(auth.uid(), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))));
DROP POLICY IF EXISTS sale_docs_insert ON public.sale_documents;
CREATE POLICY sale_docs_insert ON public.sale_documents AS PERMISSIVE FOR INSERT TO  WITH CHECK ((can_view_sale(auth.uid(), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))));
DROP POLICY IF EXISTS sale_docs_select ON public.sale_documents;
CREATE POLICY sale_docs_select ON public.sale_documents AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale(auth.uid(), sale_id));
DROP POLICY IF EXISTS sale_docs_update ON public.sale_documents;
CREATE POLICY sale_docs_update ON public.sale_documents AS PERMISSIVE FOR UPDATE TO  USING (can_view_sale(auth.uid(), sale_id)) WITH CHECK ((can_view_sale(auth.uid(), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))));
DROP TRIGGER IF EXISTS trg_docs_updated ON public.sale_documents;
CREATE TRIGGER trg_docs_updated BEFORE UPDATE ON public.sale_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== TABELA: sale_parties =====
CREATE TABLE IF NOT EXISTS public.sale_parties (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  papel text NOT NULL,
  nome text,
  rg text,
  cpf_cnpj text,
  profissao text,
  email text,
  telefone text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sale_parties_sale_id_papel_key UNIQUE (sale_id, papel),
  CONSTRAINT sale_parties_pkey PRIMARY KEY (id),
  CONSTRAINT sale_parties_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);
ALTER TABLE public.sale_parties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_parties_rw ON public.sale_parties;
CREATE POLICY sale_parties_rw ON public.sale_parties AS PERMISSIVE FOR ALL TO  USING (can_view_sale(auth.uid(), sale_id)) WITH CHECK ((can_view_sale(auth.uid(), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))));

-- ===== TABELA: sale_payment =====
CREATE TABLE IF NOT EXISTS public.sale_payment (
  sale_id uuid NOT NULL,
  entrada_valor numeric(14,2),
  entrada_data date,
  parcela1_valor numeric(14,2),
  parcela1_data date,
  parcela2_valor numeric(14,2),
  parcela2_data date,
  fgts boolean DEFAULT false,
  fgts_valor numeric(14,2),
  fgts_observacao text,
  financiamento boolean DEFAULT false,
  financiamento_valor numeric(14,2),
  financiamento_observacao text,
  observacoes text,
  CONSTRAINT sale_payment_pkey PRIMARY KEY (sale_id),
  CONSTRAINT sale_payment_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);
ALTER TABLE public.sale_payment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_payment_rw ON public.sale_payment;
CREATE POLICY sale_payment_rw ON public.sale_payment AS PERMISSIVE FOR ALL TO  USING (can_view_sale(auth.uid(), sale_id)) WITH CHECK ((can_view_sale(auth.uid(), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))));

-- ===== TABELA: sale_status_history =====
CREATE TABLE IF NOT EXISTS public.sale_status_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  de sale_status,
  para sale_status NOT NULL,
  autor_id uuid,
  motivo text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sale_status_history_pkey PRIMARY KEY (id),
  CONSTRAINT sale_status_history_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES auth.users(id),
  CONSTRAINT sale_status_history_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_status_history_sale ON public.sale_status_history USING btree (sale_id, created_at DESC);
ALTER TABLE public.sale_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS history_insert ON public.sale_status_history;
CREATE POLICY history_insert ON public.sale_status_history AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (can_view_sale(auth.uid(), sale_id));
DROP POLICY IF EXISTS history_view ON public.sale_status_history;
CREATE POLICY history_view ON public.sale_status_history AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale(auth.uid(), sale_id));

-- ===== TABELA: document_extractions =====
CREATE TABLE IF NOT EXISTS public.document_extractions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  raw_json jsonb,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT document_extractions_document_id_key UNIQUE (document_id),
  CONSTRAINT document_extractions_pkey PRIMARY KEY (id),
  CONSTRAINT document_extractions_document_id_fkey FOREIGN KEY (document_id) REFERENCES sale_documents(id) ON DELETE CASCADE,
  CONSTRAINT document_extractions_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT document_extractions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text])))
);
CREATE INDEX IF NOT EXISTS idx_document_extractions_sale ON public.document_extractions USING btree (sale_id);
ALTER TABLE public.document_extractions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "delete extractions if can view sale" ON public.document_extractions;
CREATE POLICY "delete extractions if can view sale" ON public.document_extractions AS PERMISSIVE FOR DELETE TO authenticated USING (can_view_sale(auth.uid(), sale_id));
DROP POLICY IF EXISTS "insert extractions if can view sale" ON public.document_extractions;
CREATE POLICY "insert extractions if can view sale" ON public.document_extractions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (can_view_sale(auth.uid(), sale_id));
DROP POLICY IF EXISTS "update extractions if can view sale" ON public.document_extractions;
CREATE POLICY "update extractions if can view sale" ON public.document_extractions AS PERMISSIVE FOR UPDATE TO authenticated USING (can_view_sale(auth.uid(), sale_id)) WITH CHECK (can_view_sale(auth.uid(), sale_id));
DROP POLICY IF EXISTS "view extractions if can view sale" ON public.document_extractions;
CREATE POLICY "view extractions if can view sale" ON public.document_extractions AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale(auth.uid(), sale_id));
DROP TRIGGER IF EXISTS trg_document_extractions_updated_at ON public.document_extractions;
CREATE TRIGGER trg_document_extractions_updated_at BEFORE UPDATE ON public.document_extractions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===== TABELA: occurrence_commissions =====
CREATE TABLE IF NOT EXISTS public.occurrence_commissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL,
  papel text NOT NULL,
  nome text,
  percentual numeric(6,3),
  valor numeric(14,2),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT occurrence_commissions_pkey PRIMARY KEY (id),
  CONSTRAINT occurrence_commissions_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES occurrences(id) ON DELETE CASCADE
);
ALTER TABLE public.occurrence_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS occ_comm_view ON public.occurrence_commissions;
CREATE POLICY occ_comm_view ON public.occurrence_commissions AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_view_sale(auth.uid(), o.sale_id)))));
DROP POLICY IF EXISTS occ_comm_write ON public.occurrence_commissions;
CREATE POLICY occ_comm_write ON public.occurrence_commissions AS PERMISSIVE FOR ALL TO  USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]) AND ((NOT is_sale_locked(o.sale_id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))))));

-- ===== TABELA: occurrence_partners =====
CREATE TABLE IF NOT EXISTS public.occurrence_partners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL,
  nome text,
  cpf_cnpj text,
  percentual numeric(6,3),
  valor numeric(14,2),
  banco text,
  agencia text,
  conta text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT occurrence_partners_pkey PRIMARY KEY (id),
  CONSTRAINT occurrence_partners_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES occurrences(id) ON DELETE CASCADE
);
ALTER TABLE public.occurrence_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS occ_part_view ON public.occurrence_partners;
CREATE POLICY occ_part_view ON public.occurrence_partners AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_view_sale(auth.uid(), o.sale_id)))));
DROP POLICY IF EXISTS occ_part_write ON public.occurrence_partners;
CREATE POLICY occ_part_write ON public.occurrence_partners AS PERMISSIVE FOR ALL TO  USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]) AND ((NOT is_sale_locked(o.sale_id)) OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))))));

-- ===== TABELA: sale_comments =====
CREATE TABLE IF NOT EXISTS public.sale_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL,
  autor_id uuid NOT NULL,
  escopo text NOT NULL DEFAULT 'revisao'::text,
  texto text NOT NULL,
  doc_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sale_comments_pkey PRIMARY KEY (id),
  CONSTRAINT sale_comments_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES auth.users(id),
  CONSTRAINT sale_comments_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES sale_documents(id) ON DELETE SET NULL,
  CONSTRAINT sale_comments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);
ALTER TABLE public.sale_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sale_comments_insert ON public.sale_comments;
CREATE POLICY sale_comments_insert ON public.sale_comments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((can_view_sale(auth.uid(), sale_id) AND (autor_id = auth.uid())));
DROP POLICY IF EXISTS sale_comments_view ON public.sale_comments;
CREATE POLICY sale_comments_view ON public.sale_comments AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale(auth.uid(), sale_id));
