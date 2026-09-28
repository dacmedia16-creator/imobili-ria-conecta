-- Rollback do marco 1a (fundação multiempresa). SOMENTE local/homologação.
-- Restaura policies, constraints, índices e funções ao estado implantado (catálogo 27/09/2026).
-- Pré-condição: só existe a organização legada; se houver dados de outras agências, a restauração das
-- unicidades globais pode falhar (proposital: não apagar dados de agência sem decisão).
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE NOT legacy_default) THEN
    RAISE EXCEPTION 'Rollback abortado: existem organizacoes alem da legada. Exportar/remover conscientemente antes.';
  END IF;
END $$;

-- Funções originais
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
END; $function$;

CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_active_user(_user) AND EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND (
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
    WHERE tm.membro_id = _membro AND (
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
  LEFT JOIN public.profiles p ON p.id = r.responsible_id
  WHERE r.status = 'confirmed'
    AND public.is_active_user(auth.uid())
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
  _suggestion public.positioning_region_suggestions%ROWTYPE;
  _region_id bigint;
  _final_cidade text;
  _final_nome text;
  _final_tipo text;
BEGIN
  IF _user IS NULL OR NOT public.is_active_user(_user)
    OR NOT public.has_any_role(_user, ARRAY['admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Apenas administradores podem analisar sugestoes.';
  END IF;
  IF _decision NOT IN ('aprovar', 'rejeitar') THEN RAISE EXCEPTION 'Decisao invalida.'; END IF;

  SELECT * INTO _suggestion FROM public.positioning_region_suggestions
  WHERE id = _suggestion_id FOR UPDATE;
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

  INSERT INTO public.positioning_regions (cidade, zona, nome, tipo)
  VALUES (_final_cidade, nullif(trim(coalesce(_zona, _suggestion.zona, '')), ''), _final_nome, _final_tipo)
  ON CONFLICT (cidade, nome, tipo) DO UPDATE SET ativo = true, zona = EXCLUDED.zona
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
BEGIN
  IF _user IS NULL OR NOT public.is_active_user(_user)
    OR NOT public.has_role(_user, 'corretor'::public.app_role) THEN
    RAISE EXCEPTION 'Apenas corretores ativos podem editar o posicionamento.';
  END IF;

  IF (SELECT count(DISTINCT id) FROM unnest(coalesce(_region_ids, ARRAY[]::bigint[])) requested(id)) > 2 THEN
    RAISE EXCEPTION 'Selecione no maximo 2 locais.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(_region_ids, ARRAY[]::bigint[])) requested(id)
    LEFT JOIN public.positioning_regions r ON r.id = requested.id AND r.ativo
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

-- Policies, triggers e constraints de organização
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','user_roles','teams','team_members','clientes','sales','sale_payment',
    'sale_documents','occurrences','room_reservations','positioning_regions','positioning_region_suggestions',
    'corretor_positioning_regions']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_00_org ON public.%I', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_01_org_participants ON public.room_reservations;

ALTER TABLE public.room_reservations DROP CONSTRAINT room_reservations_org_no_overlap;
ALTER TABLE public.room_reservations ADD CONSTRAINT room_reservations_no_overlap EXCLUDE USING gist
  (room WITH =, tsrange((reserved_date + start_time), (reserved_date + end_time), '[)'::text) WITH &&)
  WHERE ((status = 'confirmed'::text));
ALTER TABLE public.positioning_regions DROP CONSTRAINT positioning_regions_org_unique;
ALTER TABLE public.positioning_regions ADD CONSTRAINT positioning_regions_unique UNIQUE (cidade, nome, tipo);
DROP INDEX public.sales_org_imovel_id_ativa_key;
CREATE UNIQUE INDEX sales_imovel_id_ativa_key ON public.sales USING btree (imovel_id)
  WHERE ((imovel_id IS NOT NULL) AND (status <> ALL (ARRAY['arquivada'::sale_status, 'cancelada'::sale_status])));
DROP INDEX public.clientes_org_cpf_cnpj_normalizado_key;
CREATE UNIQUE INDEX clientes_cpf_cnpj_normalizado_key ON public.clientes USING btree (cpf_cnpj_normalizado) WHERE (cpf_cnpj_normalizado <> ''::text);

-- Remover colunas derruba FKs compostas, chaves (id, organization_id) e índices associados.
ALTER TABLE public.corretor_positioning_regions DROP COLUMN organization_id;
ALTER TABLE public.positioning_region_suggestions DROP COLUMN organization_id;
ALTER TABLE public.room_reservations DROP COLUMN organization_id;
ALTER TABLE public.occurrences DROP COLUMN organization_id;
ALTER TABLE public.sale_documents DROP COLUMN organization_id;
ALTER TABLE public.sale_payment DROP COLUMN organization_id;
ALTER TABLE public.team_members DROP COLUMN organization_id;
ALTER TABLE public.user_roles DROP COLUMN organization_id;
ALTER TABLE public.clientes DROP COLUMN organization_id;
ALTER TABLE public.sales DROP COLUMN organization_id CASCADE;
ALTER TABLE public.positioning_regions DROP COLUMN organization_id CASCADE;
ALTER TABLE public.teams DROP COLUMN organization_id CASCADE;
ALTER TABLE public.profiles DROP COLUMN organization_id CASCADE;

DROP FUNCTION public.mt_set_own_org();
DROP FUNCTION public.mt_inherit_org();
DROP FUNCTION public.mt_profiles_org();
DROP FUNCTION public.mt_room_participants_same_org();
DROP FUNCTION public.platform_create_organization(text, text);
DROP TABLE public.organization_members;
DROP TABLE public.organizations;
DROP FUNCTION public.current_org_id();
DROP FUNCTION public.user_org(uuid);
-- platform_admins/is_platform_super_admin criadas pela publicação 20260929090000 (marca no COMMENT)
-- ficam: pertencem à regra de cancelar venda, não à 1a. (Depois das policies de organizations,
-- que dependem da função.)
DO $$ BEGIN
  IF obj_description('public.platform_admins'::regclass, 'pg_class') IS DISTINCT FROM
     'origem:20260929090000_excluir_cancelar_venda' THEN
    DROP TABLE public.platform_admins;
    DROP FUNCTION public.is_platform_super_admin(uuid);
  END IF;
END $$;
DROP FUNCTION public.legacy_default_org_id();

COMMIT;
