-- ADM MAX multiempresa — Fase 1, marco 1a (fundação). SOMENTE ambiente local/homologação.
-- NÃO aplicar em produção sem aprovação expressa de Denis (plano PLANO_MULTIEMPRESA_ADM_MAX.md).
-- Arquivo propositalmente fora de supabase/migrations para não entrar em `db push`.
--
-- Escopo: organizations, organization_members, platform_admins (super-admin da PLATAFORMA, separado do
-- app_role super_admin legado, que passa a valer só dentro da agência); organization_id + backfill Única
-- Escolha nas tabelas núcleo; FKs compostas; unicidades/exclusão por organização; policy RESTRICTIVE de
-- organização (combina por AND com as permissivas existentes, que combinam por OR); correções de RPCs
-- SECURITY DEFINER que liam dados de todas as agências.
-- Rollback: 20260928000000_mt_fase1a_fundacao.down.sql

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 1. Organizações, membros e super-admin da plataforma
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  nome text NOT NULL CHECK (length(btrim(nome)) >= 2),
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'suspensa')),
  -- Organização que recebe linhas sem organização durante a TRANSIÇÃO do legado. No máximo uma.
  -- No ambiente piloto novo nenhuma organização deve ter esta marca (default falha fechado).
  legacy_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX organizations_single_legacy_default ON public.organizations (legacy_default) WHERE legacy_default;

CREATE TABLE public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  -- Decisão inicial: uma agência por usuário (e-mail compartilhado entre agências fica para decisão futura).
  CONSTRAINT organization_members_one_org_per_user UNIQUE (user_id)
);

CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizations, public.organization_members, public.platform_admins FROM anon, authenticated;
GRANT SELECT ON public.organizations, public.organization_members TO authenticated;
GRANT ALL ON public.organizations, public.organization_members, public.platform_admins TO service_role;

-- Única Escolha: organização histórica, id fixo para permitir conciliação entre ambientes.
INSERT INTO public.organizations (id, slug, nome, legacy_default)
VALUES ('00000000-0000-4000-8000-000000000001', 'unica-escolha', 'Única Escolha', true);

-- ---------------------------------------------------------------------------------------------
-- 2. Funções de contexto (SECURITY DEFINER, search_path fixo, sem EXECUTE para anon)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.user_org(_user uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT m.organization_id FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = _user AND m.ativo AND o.status = 'ativa'
$$;

CREATE FUNCTION public.current_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.user_org(auth.uid())
$$;

CREATE FUNCTION public.is_platform_super_admin(_user uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _user IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user)
$$;

CREATE FUNCTION public.legacy_default_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id FROM public.organizations WHERE legacy_default AND status = 'ativa'
$$;

-- Só o super-admin da plataforma (Denis) cria imobiliárias. Sem autocadastro público.
CREATE FUNCTION public.platform_create_organization(_slug text, _nome text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.is_platform_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma cria imobiliarias.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.organizations (slug, nome, created_by) VALUES (lower(btrim(_slug)), btrim(_nome), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.user_org(uuid), public.current_org_id(), public.is_platform_super_admin(uuid),
  public.legacy_default_org_id(), public.platform_create_organization(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_org(uuid), public.current_org_id(), public.is_platform_super_admin(uuid),
  public.legacy_default_org_id(), public.platform_create_organization(text, text) TO authenticated, service_role;

CREATE POLICY organizations_member_select ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING (id = public.current_org_id() OR public.is_platform_super_admin());
CREATE POLICY organization_members_select ON public.organization_members AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_super_admin()
    OR (organization_id = public.current_org_id()
        AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','gestor']::public.app_role[])));

-- ---------------------------------------------------------------------------------------------
-- 3. Colunas organization_id (aditivas, inicialmente NULL) + backfill
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN organization_id uuid;
ALTER TABLE public.user_roles ADD COLUMN organization_id uuid;
ALTER TABLE public.teams ADD COLUMN organization_id uuid;
ALTER TABLE public.team_members ADD COLUMN organization_id uuid;
ALTER TABLE public.clientes ADD COLUMN organization_id uuid;
ALTER TABLE public.sales ADD COLUMN organization_id uuid;
ALTER TABLE public.sale_payment ADD COLUMN organization_id uuid;
ALTER TABLE public.sale_documents ADD COLUMN organization_id uuid;
ALTER TABLE public.occurrences ADD COLUMN organization_id uuid;
ALTER TABLE public.room_reservations ADD COLUMN organization_id uuid;
ALTER TABLE public.positioning_regions ADD COLUMN organization_id uuid;
ALTER TABLE public.positioning_region_suggestions ADD COLUMN organization_id uuid;
ALTER TABLE public.corretor_positioning_regions ADD COLUMN organization_id uuid;
-- profiles usa GRANT por coluna (cpf/creci ocultos): expor só a organização.
GRANT SELECT (organization_id) ON public.profiles TO authenticated;

-- Órfãos que impediriam as FKs compostas: aborta com contagem em vez de corrigir dados às cegas.
DO $$
DECLARE r record; n bigint; problems text := '';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('sales','corretor_id'),('sales','corretor_captador_id'),('sales','corretor_vendedor_id'),
    ('sales','lider_captador_id'),('sales','lider_vendedor_id'),('sales','team_leader_id'),
    ('sales','coordenador_id'),('sales','indicador_captador_id'),('sales','indicador_vendedor_id'),
    ('teams','lider_id'),('team_members','membro_id'),('user_roles','user_id'),
    ('room_reservations','responsible_id'),('positioning_region_suggestions','suggested_by')) v(t, c)
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I x WHERE x.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.%I)', r.t, r.c, r.c) INTO n;
    IF n > 0 THEN problems := problems || format('%s.%s=%s ', r.t, r.c, n); END IF;
  END LOOP;
  IF problems <> '' THEN
    RAISE EXCEPTION 'Referencias sem profile (corrigir antes do backfill): %', problems;
  END IF;
END $$;

-- Backfill: todo o legado pertence à Única Escolha. Em produção, executar em lotes (ver relatório).
UPDATE public.profiles SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
INSERT INTO public.organization_members (organization_id, user_id, ativo)
SELECT '00000000-0000-4000-8000-000000000001', p.id, true FROM public.profiles p
WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
ON CONFLICT DO NOTHING;
UPDATE public.teams SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE public.clientes SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE public.sales SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE public.room_reservations SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE public.positioning_regions SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE public.positioning_region_suggestions SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE public.user_roles x SET organization_id = p.organization_id FROM public.profiles p WHERE p.id = x.user_id AND x.organization_id IS NULL;
UPDATE public.team_members x SET organization_id = t.organization_id FROM public.teams t WHERE t.id = x.team_id AND x.organization_id IS NULL;
UPDATE public.sale_payment x SET organization_id = s.organization_id FROM public.sales s WHERE s.id = x.sale_id AND x.organization_id IS NULL;
UPDATE public.sale_documents x SET organization_id = s.organization_id FROM public.sales s WHERE s.id = x.sale_id AND x.organization_id IS NULL;
UPDATE public.occurrences x SET organization_id = s.organization_id FROM public.sales s WHERE s.id = x.sale_id AND x.organization_id IS NULL;
UPDATE public.corretor_positioning_regions x SET organization_id = p.organization_id FROM public.profiles p WHERE p.id = x.corretor_id AND x.organization_id IS NULL;

-- Todas as linhas precisam ter organização (falha fechado).
ALTER TABLE public.profiles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.user_roles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.teams ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.team_members ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.clientes ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.sales ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.sale_payment ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.sale_documents ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.occurrences ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.room_reservations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.positioning_regions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.positioning_region_suggestions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.corretor_positioning_regions ALTER COLUMN organization_id SET NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 4. FKs para organizations, chaves compostas e FKs compostas (mesma organização nos vínculos)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.profiles ADD CONSTRAINT profiles_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.teams ADD CONSTRAINT teams_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.clientes ADD CONSTRAINT clientes_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.sales ADD CONSTRAINT sales_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.room_reservations ADD CONSTRAINT room_reservations_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.positioning_regions ADD CONSTRAINT positioning_regions_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);
ALTER TABLE public.positioning_region_suggestions ADD CONSTRAINT positioning_region_suggestions_organization_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);

ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_org_key UNIQUE (id, organization_id);
ALTER TABLE public.teams ADD CONSTRAINT teams_id_org_key UNIQUE (id, organization_id);
ALTER TABLE public.sales ADD CONSTRAINT sales_id_org_key UNIQUE (id, organization_id);
ALTER TABLE public.positioning_regions ADD CONSTRAINT positioning_regions_id_org_key UNIQUE (id, organization_id);

ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_profile_org_fk FOREIGN KEY (user_id, organization_id) REFERENCES public.profiles(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.teams ADD CONSTRAINT teams_lider_org_fk FOREIGN KEY (lider_id, organization_id) REFERENCES public.profiles(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.teams ADD CONSTRAINT teams_parent_org_fk FOREIGN KEY (parent_team_id, organization_id) REFERENCES public.teams(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.team_members ADD CONSTRAINT team_members_team_org_fk FOREIGN KEY (team_id, organization_id) REFERENCES public.teams(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.team_members ADD CONSTRAINT team_members_membro_org_fk FOREIGN KEY (membro_id, organization_id) REFERENCES public.profiles(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.sale_payment ADD CONSTRAINT sale_payment_sale_org_fk FOREIGN KEY (sale_id, organization_id) REFERENCES public.sales(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.sale_documents ADD CONSTRAINT sale_documents_sale_org_fk FOREIGN KEY (sale_id, organization_id) REFERENCES public.sales(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.occurrences ADD CONSTRAINT occurrences_sale_org_fk FOREIGN KEY (sale_id, organization_id) REFERENCES public.sales(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.room_reservations ADD CONSTRAINT room_reservations_responsible_org_fk FOREIGN KEY (responsible_id, organization_id) REFERENCES public.profiles(id, organization_id);
ALTER TABLE public.positioning_region_suggestions ADD CONSTRAINT positioning_region_suggestions_suggested_by_org_fk FOREIGN KEY (suggested_by, organization_id) REFERENCES public.profiles(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.positioning_region_suggestions ADD CONSTRAINT positioning_region_suggestions_region_org_fk FOREIGN KEY (region_id, organization_id) REFERENCES public.positioning_regions(id, organization_id) ON DELETE SET NULL (region_id);
ALTER TABLE public.corretor_positioning_regions ADD CONSTRAINT corretor_positioning_regions_corretor_org_fk FOREIGN KEY (corretor_id, organization_id) REFERENCES public.profiles(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.corretor_positioning_regions ADD CONSTRAINT corretor_positioning_regions_region_org_fk FOREIGN KEY (region_id, organization_id) REFERENCES public.positioning_regions(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.sales ADD CONSTRAINT sales_corretor_org_fk FOREIGN KEY (corretor_id, organization_id) REFERENCES public.profiles(id, organization_id);
ALTER TABLE public.sales ADD CONSTRAINT sales_corretor_captador_org_fk FOREIGN KEY (corretor_captador_id, organization_id) REFERENCES public.profiles(id, organization_id);
ALTER TABLE public.sales ADD CONSTRAINT sales_corretor_vendedor_org_fk FOREIGN KEY (corretor_vendedor_id, organization_id) REFERENCES public.profiles(id, organization_id);
ALTER TABLE public.sales ADD CONSTRAINT sales_lider_captador_org_fk FOREIGN KEY (lider_captador_id, organization_id) REFERENCES public.profiles(id, organization_id);
ALTER TABLE public.sales ADD CONSTRAINT sales_lider_vendedor_org_fk FOREIGN KEY (lider_vendedor_id, organization_id) REFERENCES public.profiles(id, organization_id);
ALTER TABLE public.sales ADD CONSTRAINT sales_team_leader_org_fk FOREIGN KEY (team_leader_id, organization_id) REFERENCES public.profiles(id, organization_id);
ALTER TABLE public.sales ADD CONSTRAINT sales_coordenador_org_fk FOREIGN KEY (coordenador_id, organization_id) REFERENCES public.profiles(id, organization_id);
ALTER TABLE public.sales ADD CONSTRAINT sales_indicador_captador_org_fk FOREIGN KEY (indicador_captador_id, organization_id) REFERENCES public.profiles(id, organization_id);
ALTER TABLE public.sales ADD CONSTRAINT sales_indicador_vendedor_org_fk FOREIGN KEY (indicador_vendedor_id, organization_id) REFERENCES public.profiles(id, organization_id);

-- Unicidades por organização (substituem as globais)
DROP INDEX public.clientes_cpf_cnpj_normalizado_key;
CREATE UNIQUE INDEX clientes_org_cpf_cnpj_normalizado_key ON public.clientes (organization_id, cpf_cnpj_normalizado) WHERE (cpf_cnpj_normalizado <> ''::text);
DROP INDEX public.sales_imovel_id_ativa_key;
CREATE UNIQUE INDEX sales_org_imovel_id_ativa_key ON public.sales (organization_id, imovel_id)
  WHERE ((imovel_id IS NOT NULL) AND (status <> ALL (ARRAY['arquivada'::sale_status, 'cancelada'::sale_status])));
ALTER TABLE public.positioning_regions DROP CONSTRAINT positioning_regions_unique;
ALTER TABLE public.positioning_regions ADD CONSTRAINT positioning_regions_org_unique UNIQUE (organization_id, cidade, nome, tipo);
ALTER TABLE public.room_reservations DROP CONSTRAINT room_reservations_no_overlap;
ALTER TABLE public.room_reservations ADD CONSTRAINT room_reservations_org_no_overlap EXCLUDE USING gist
  (organization_id WITH =, room WITH =, tsrange((reserved_date + start_time), (reserved_date + end_time), '[)'::text) WITH &&)
  WHERE ((status = 'confirmed'::text));

-- Índices de organização (consultas e policies)
CREATE INDEX idx_user_roles_org_user ON public.user_roles (organization_id, user_id);
CREATE INDEX idx_teams_org ON public.teams (organization_id);
CREATE INDEX idx_team_members_org ON public.team_members (organization_id);
CREATE INDEX idx_clientes_org ON public.clientes (organization_id);
CREATE INDEX idx_sales_org_status ON public.sales (organization_id, status);
CREATE INDEX idx_sale_payment_org ON public.sale_payment (organization_id);
CREATE INDEX idx_sale_documents_org ON public.sale_documents (organization_id);
CREATE INDEX idx_occurrences_org ON public.occurrences (organization_id);
CREATE INDEX idx_room_reservations_org_date ON public.room_reservations (organization_id, reserved_date);
CREATE INDEX idx_positioning_region_suggestions_org ON public.positioning_region_suggestions (organization_id, status);
CREATE INDEX idx_corretor_positioning_regions_org ON public.corretor_positioning_regions (organization_id);

-- ---------------------------------------------------------------------------------------------
-- 5. Triggers de organização: servidor atribui; cliente não escolhe nem troca de agência
-- ---------------------------------------------------------------------------------------------
-- Tabelas com organização própria: usuário autenticado grava sempre na própria agência.
-- Sem usuário (service_role/migração): exige organization_id explícito; senão usa o default legado
-- transitório (se existir); senão falha.
CREATE FUNCTION public.mt_set_own_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _actor uuid := auth.uid(); _org uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id AND _actor IS NOT NULL THEN
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
  ELSE
    NEW.organization_id := coalesce(NEW.organization_id, public.legacy_default_org_id());
    IF NEW.organization_id IS NULL THEN
      RAISE EXCEPTION 'organization_id obrigatorio' USING ERRCODE = '23502';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Tabelas filhas: organização herdada do registro pai (argumentos: tabela pai, coluna local de ligação).
CREATE FUNCTION public.mt_inherit_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _parent_table text := TG_ARGV[0]; _fk text := TG_ARGV[1]; _key uuid; _org uuid;
BEGIN
  _key := (to_jsonb(NEW) ->> _fk)::uuid;
  EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', _parent_table) INTO _org USING _key;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'Registro pai sem organizacao (%.%)', _parent_table, _fk USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND _org IS DISTINCT FROM OLD.organization_id AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'organization_id nao pode ser alterado' USING ERRCODE = '42501';
  END IF;
  NEW.organization_id := _org;
  RETURN NEW;
END $$;

-- profiles: organização vem de organization_members (quando existir) e não muda por ação do usuário.
CREATE FUNCTION public.mt_profiles_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'organization_id nao pode ser alterado' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  NEW.organization_id := coalesce(public.user_org(NEW.id), NEW.organization_id,
    CASE WHEN auth.uid() IS NULL THEN public.legacy_default_org_id() END);
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id obrigatorio' USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END $$;

-- Participantes de reserva precisam ser da mesma agência.
CREATE FUNCTION public.mt_room_participants_same_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(NEW.participant_user_ids, ARRAY[]::uuid[])) u(id)
    LEFT JOIN public.profiles p ON p.id = u.id AND p.organization_id = NEW.organization_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Participante de outra organizacao' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.mt_set_own_org(), public.mt_inherit_org(), public.mt_profiles_org(),
  public.mt_room_participants_same_org() FROM PUBLIC, anon, authenticated;

-- Nome "trg_00_*": dispara antes dos demais BEFORE triggers (ordem alfabética).
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.mt_profiles_org();
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.mt_set_own_org();
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.mt_set_own_org();
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.mt_set_own_org();
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.room_reservations FOR EACH ROW EXECUTE FUNCTION public.mt_set_own_org();
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.positioning_regions FOR EACH ROW EXECUTE FUNCTION public.mt_set_own_org();
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.positioning_region_suggestions FOR EACH ROW EXECUTE FUNCTION public.mt_set_own_org();
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.mt_inherit_org('profiles', 'user_id');
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.team_members FOR EACH ROW EXECUTE FUNCTION public.mt_inherit_org('teams', 'team_id');
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.sale_payment FOR EACH ROW EXECUTE FUNCTION public.mt_inherit_org('sales', 'sale_id');
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.sale_documents FOR EACH ROW EXECUTE FUNCTION public.mt_inherit_org('sales', 'sale_id');
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.occurrences FOR EACH ROW EXECUTE FUNCTION public.mt_inherit_org('sales', 'sale_id');
CREATE TRIGGER trg_00_org BEFORE INSERT OR UPDATE ON public.corretor_positioning_regions FOR EACH ROW EXECUTE FUNCTION public.mt_inherit_org('profiles', 'corretor_id');
CREATE TRIGGER trg_01_org_participants BEFORE INSERT OR UPDATE OF participant_user_ids ON public.room_reservations
  FOR EACH ROW EXECUTE FUNCTION public.mt_room_participants_same_org();

-- ---------------------------------------------------------------------------------------------
-- 6. Gate de organização em RLS: policy RESTRICTIVE (AND) sobre as permissivas existentes (OR)
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','user_roles','teams','team_members','clientes','sales','sale_payment',
    'sale_documents','occurrences','room_reservations','positioning_regions','positioning_region_suggestions',
    'corretor_positioning_regions']
  LOOP
    EXECUTE format('CREATE POLICY org_isolation ON public.%I AS RESTRICTIVE FOR ALL TO public
      USING (organization_id = (SELECT public.current_org_id()))
      WITH CHECK (organization_id = (SELECT public.current_org_id()))', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Funções SECURITY DEFINER do núcleo: passam a respeitar a organização
-- ---------------------------------------------------------------------------------------------
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
  IF _org IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org AND status = 'ativa') THEN
    RAISE EXCEPTION 'Organizacao invalida para novo usuario';
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id) VALUES (_org, NEW.id);
  INSERT INTO public.profiles (id, nome, email, organization_id)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email,'@',1)), NEW.email, _org);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'corretor');
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_active_user(_user) AND EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND s.organization_id = public.user_org(_user) AND (
      s.corretor_id = _user
      OR s.corretor_captador_id = _user
      OR s.corretor_vendedor_id = _user
      OR s.lider_captador_id = _user
      OR s.lider_vendedor_id = _user
      OR EXISTS (SELECT 1 FROM public.sale_commission_extras sce WHERE sce.sale_id = s.id AND sce.user_id = _user)
      OR public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (public.has_any_role(_user, ARRAY['gestor','team_leader']::public.app_role[]) AND public.is_lead_of(_user, s.corretor_id))
      OR (public.has_role(_user,'juridico'::public.app_role) AND s.status::text = ANY (ARRAY[
        'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
        'aguardando_assinatura','contrato_assinado',
        'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
      ]))
    )
  )
$function$;

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
    WHERE tm.membro_id = _membro
      AND t.organization_id = public.user_org(_lider)
      AND (
      t.lider_id = _lider
      OR pt.lider_id = _lider
      OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = t.id AND cl.user_id = _lider)
      OR (pt.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = pt.id AND cl.user_id = _lider))
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.list_room_occupancy()
 RETURNS TABLE(id uuid, reservation_group_id uuid, room text, reserved_date date, start_time time without time zone, end_time time without time zone, responsible_id uuid, responsible_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.id, r.reservation_group_id, r.room, r.reserved_date, r.start_time, r.end_time,
         r.responsible_id, COALESCE(NULLIF(btrim(p.nome), ''), r.responsible_name)
  FROM public.room_reservations r
  LEFT JOIN public.profiles p ON p.id = r.responsible_id AND p.organization_id = r.organization_id
  WHERE r.status = 'confirmed'
    AND public.is_active_user(auth.uid())
    AND r.organization_id = public.current_org_id()
  ORDER BY r.reserved_date, r.start_time;
$function$;

CREATE OR REPLACE FUNCTION public.list_room_reservation_users()
 RETURNS TABLE(id uuid, nome text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.nome
  FROM public.profiles p
  WHERE p.ativo = true
    AND p.organization_id = public.current_org_id()
  ORDER BY p.nome NULLS LAST, p.id;
$function$;

CREATE OR REPLACE FUNCTION public.review_positioning_region_suggestion(_suggestion_id uuid, _decision text, _cidade text DEFAULT NULL::text, _zona text DEFAULT NULL::text, _nome text DEFAULT NULL::text, _tipo text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _org uuid := public.current_org_id();
  _suggestion public.positioning_region_suggestions%ROWTYPE;
  _region_id bigint;
  _final_cidade text;
  _final_nome text;
  _final_tipo text;
BEGIN
  IF _user IS NULL OR _org IS NULL OR NOT public.is_active_user(_user)
    OR NOT public.has_any_role(_user, ARRAY['admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Apenas administradores podem analisar sugestoes.';
  END IF;
  IF _decision NOT IN ('aprovar', 'rejeitar') THEN RAISE EXCEPTION 'Decisao invalida.'; END IF;

  SELECT * INTO _suggestion FROM public.positioning_region_suggestions
  WHERE id = _suggestion_id AND organization_id = _org FOR UPDATE;
  IF NOT FOUND OR _suggestion.status <> 'pendente' THEN
    RAISE EXCEPTION 'Sugestao nao encontrada ou ja analisada.';
  END IF;

  IF _decision = 'rejeitar' THEN
    UPDATE public.positioning_region_suggestions
    SET status = 'rejeitada', reviewed_by = _user, reviewed_at = now()
    WHERE id = _suggestion_id;
    RETURN NULL;
  END IF;

  _final_cidade := trim(coalesce(nullif(_cidade, ''), _suggestion.cidade));
  _final_nome := trim(coalesce(nullif(_nome, ''), _suggestion.nome));
  _final_tipo := coalesce(nullif(_tipo, ''), _suggestion.tipo);
  IF length(_final_cidade) < 2 OR length(_final_nome) < 2
    OR _final_tipo NOT IN ('bairro', 'condominio', 'cidade', 'grupo') THEN
    RAISE EXCEPTION 'Dados finais da regiao invalidos.';
  END IF;

  INSERT INTO public.positioning_regions (organization_id, cidade, zona, nome, tipo)
  VALUES (_org, _final_cidade, nullif(trim(coalesce(_zona, _suggestion.zona, '')), ''), _final_nome, _final_tipo)
  ON CONFLICT (organization_id, cidade, nome, tipo) DO UPDATE SET ativo = true, zona = EXCLUDED.zona
  RETURNING id INTO _region_id;

  UPDATE public.positioning_region_suggestions
  SET status = 'aprovada', reviewed_by = _user, reviewed_at = now(), region_id = _region_id,
      cidade = _final_cidade, zona = nullif(trim(coalesce(_zona, _suggestion.zona, '')), ''),
      nome = _final_nome, tipo = _final_tipo
  WHERE id = _suggestion_id;
  RETURN _region_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_my_positioning(_region_ids bigint[], _public_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _org uuid := public.current_org_id();
BEGIN
  IF _user IS NULL OR _org IS NULL OR NOT public.is_active_user(_user)
    OR NOT public.has_role(_user, 'corretor'::public.app_role) THEN
    RAISE EXCEPTION 'Apenas corretores ativos podem editar o posicionamento.';
  END IF;

  IF (SELECT count(DISTINCT id) FROM unnest(coalesce(_region_ids, ARRAY[]::bigint[])) requested(id)) > 2 THEN
    RAISE EXCEPTION 'Selecione no maximo 2 locais.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(_region_ids, ARRAY[]::bigint[])) requested(id)
    LEFT JOIN public.positioning_regions r ON r.id = requested.id AND r.ativo AND r.organization_id = _org
    WHERE r.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Um dos locais selecionados nao esta disponivel.';
  END IF;

  DELETE FROM public.corretor_positioning_regions WHERE corretor_id = _user;
  INSERT INTO public.corretor_positioning_regions (corretor_id, region_id)
  SELECT _user, requested.id
  FROM unnest(coalesce(_region_ids, ARRAY[]::bigint[])) AS requested(id)
  GROUP BY requested.id;
END;
$function$;

COMMIT;
