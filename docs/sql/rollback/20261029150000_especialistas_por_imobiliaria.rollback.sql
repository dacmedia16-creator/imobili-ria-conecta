-- Rollback de 20261029150000_especialistas_por_imobiliaria (card t_6d8de1d7).
-- Volta ao modelo anterior (regiões por imobiliária criadora, página pública só da imobiliária histórica).
-- ATENÇÃO: escolhas de corretor feitas em região criada por OUTRA imobiliária (só possíveis depois da
-- migration) são apagadas, porque o modelo antigo não as suporta; o total aparece em NOTICE.
BEGIN;

DO $$ DECLARE _n int; BEGIN
  DELETE FROM public.corretor_positioning_regions c USING public.positioning_regions r
   WHERE r.id = c.region_id AND r.organization_id <> c.organization_id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RAISE NOTICE 'escolhas entre imobiliarias removidas: %', _n;
  UPDATE public.positioning_region_suggestions s SET region_id = NULL FROM public.positioning_regions r
   WHERE r.id = s.region_id AND r.organization_id <> s.organization_id;
END $$;

DROP FUNCTION public.list_public_specialist_agencies();
DROP FUNCTION public.list_public_org_regions(text);
DROP FUNCTION public.list_public_org_specialists(text, text, bigint);
DROP FUNCTION public.especialistas_org_publica(text);
DROP FUNCTION public.positioning_org_regions();
DROP FUNCTION public.positioning_region_create(text, text, text, text, text);
DROP FUNCTION public.positioning_region_decidir(bigint, text, text, bigint);
DROP FUNCTION public.positioning_region_editar(bigint, text, text, text, boolean);
DROP FUNCTION public.positioning_region_platform_pending();
DROP FUNCTION public.my_positioning_regions();
DROP TRIGGER trg_10_regiao_ativa_org ON public.corretor_positioning_regions;
DROP FUNCTION public.positioning_cpr_check_regiao();
DROP TRIGGER trg_positioning_regions_org_cidade ON public.organizations;
DROP FUNCTION public.positioning_regions_org_cidade();

-- Definições anteriores (copiadas da produção em 29/10/2026).
CREATE OR REPLACE FUNCTION public.list_public_positioning_regions()
 RETURNS TABLE(id bigint, cidade text, zona text, nome text, tipo text, corretores bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.id, r.cidade, r.zona, r.nome, r.tipo, count(DISTINCT p.id)::bigint AS corretores
  FROM public.positioning_regions r
  LEFT JOIN public.corretor_positioning_regions c ON c.region_id = r.id AND c.organization_id = r.organization_id
  LEFT JOIN public.profiles p ON p.id = c.corretor_id AND p.ativo AND p.organization_id = r.organization_id
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'corretor'::public.app_role
                  AND ur.organization_id = r.organization_id)
  WHERE r.ativo AND r.organization_id = public.mt_2c_public_org()
  GROUP BY r.id, r.cidade, r.zona, r.nome, r.tipo
  ORDER BY r.cidade, r.zona NULLS LAST, r.nome;
$function$;

CREATE OR REPLACE FUNCTION public.list_public_specialists(_search text DEFAULT NULL::text, _region_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id uuid, nome text, avatar_url text, telefone text, pagina_pessoal_url text, instagram_url text, regioes jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH o AS (SELECT public.mt_2c_public_org() AS id)
  SELECT p.id, p.nome, p.avatar_url, p.telefone, p.pagina_pessoal_url, p.instagram_url,
    coalesce(
      jsonb_agg(jsonb_build_object(
        'id', r.id, 'nome', r.nome, 'cidade', r.cidade, 'zona', r.zona, 'tipo', r.tipo
      ) ORDER BY r.cidade, r.nome) FILTER (WHERE r.id IS NOT NULL),
      '[]'::jsonb
    ) AS regioes
  FROM o
  JOIN public.profiles p ON p.organization_id = o.id
  LEFT JOIN public.corretor_positioning_regions c ON c.corretor_id = p.id AND c.organization_id = o.id
  LEFT JOIN public.positioning_regions r ON r.id = c.region_id AND r.ativo AND r.organization_id = o.id
  WHERE p.ativo
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'corretor'::public.app_role
                  AND ur.organization_id = o.id)
    AND (_region_id IS NULL OR EXISTS (
      SELECT 1 FROM public.corretor_positioning_regions cf
      WHERE cf.corretor_id = p.id AND cf.region_id = _region_id AND cf.organization_id = o.id
    ))
    AND (nullif(trim(_search), '') IS NULL OR p.nome ILIKE '%' || trim(_search) || '%' OR EXISTS (
      SELECT 1 FROM public.corretor_positioning_regions cs
      JOIN public.positioning_regions rs ON rs.id = cs.region_id AND rs.organization_id = o.id
      WHERE cs.corretor_id = p.id AND cs.organization_id = o.id
        AND (rs.nome ILIKE '%' || trim(_search) || '%' OR rs.cidade ILIKE '%' || trim(_search) || '%')
    ))
  GROUP BY p.id, p.nome, p.avatar_url, p.telefone, p.pagina_pessoal_url, p.instagram_url
  ORDER BY p.nome;
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

CREATE OR REPLACE FUNCTION public.submit_positioning_region_suggestion(_cidade text, _zona text, _nome text, _tipo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _id uuid;
BEGIN
  IF _user IS NULL OR NOT public.is_active_user(_user)
    OR NOT public.has_any_role(
      _user,
      ARRAY['corretor','gestor','team_leader']::public.app_role[]
    ) THEN
    RAISE EXCEPTION 'Apenas Corretores, Gestores e Team Leaders ativos podem sugerir regioes.';
  END IF;
  IF length(trim(coalesce(_cidade, ''))) < 2 OR length(trim(coalesce(_cidade, ''))) > 80
    OR length(trim(coalesce(_nome, ''))) < 2 OR length(trim(coalesce(_nome, ''))) > 120 THEN
    RAISE EXCEPTION 'Preencha cidade e nome da regiao corretamente.';
  END IF;
  IF _tipo NOT IN ('bairro', 'condominio', 'cidade', 'grupo') THEN
    RAISE EXCEPTION 'Tipo de regiao invalido.';
  END IF;
  IF (SELECT count(*) FROM public.positioning_region_suggestions
      WHERE suggested_by = _user AND status = 'pendente') >= 5 THEN
    RAISE EXCEPTION 'Voce ja possui 5 sugestoes pendentes.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.positioning_regions r
    WHERE lower(trim(r.cidade)) = lower(trim(_cidade))
      AND lower(trim(r.nome)) = lower(trim(_nome))
      AND r.ativo
  ) THEN
    RAISE EXCEPTION 'Essa regiao ja esta disponivel no catalogo.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.positioning_region_suggestions s
    WHERE s.status = 'pendente'
      AND lower(trim(s.cidade)) = lower(trim(_cidade))
      AND lower(trim(s.nome)) = lower(trim(_nome))
  ) THEN
    RAISE EXCEPTION 'Essa regiao ja foi sugerida e aguarda analise.';
  END IF;

  INSERT INTO public.positioning_region_suggestions (suggested_by, cidade, zona, nome, tipo)
  VALUES (_user, trim(_cidade), nullif(trim(coalesce(_zona, '')), ''), trim(_nome), _tipo)
  RETURNING id INTO _id;
  RETURN _id;
END;
$function$;


-- Mesmo padrão da fase 1b: CREATE temporário no schema só para a troca de dono.
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.save_my_positioning(bigint[], boolean) OWNER TO mt_1b_definer;
ALTER FUNCTION public.submit_positioning_region_suggestion(text, text, text, text) OWNER TO mt_1b_definer;
ALTER FUNCTION public.review_positioning_region_suggestion(uuid, text, text, text, text, text) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.save_my_positioning(bigint[], boolean),
  public.submit_positioning_region_suggestion(text, text, text, text),
  public.review_positioning_region_suggestion(uuid, text, text, text, text, text) TO anon, authenticated, service_role;

DROP FUNCTION public.positioning_region_obter_ou_criar(uuid, uuid, text, text, text, text, text);
DROP FUNCTION public.regioes_staff_org();
DROP TABLE public.positioning_region_orgs;

CREATE POLICY positioning_regions_admin_write ON public.positioning_regions AS PERMISSIVE FOR ALL TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'super_admin'::public.app_role])))
  WITH CHECK ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'super_admin'::public.app_role])));
ALTER TABLE public.corretor_positioning_regions ADD CONSTRAINT corretor_positioning_regions_region_org_fk
  FOREIGN KEY (region_id, organization_id) REFERENCES public.positioning_regions(id, organization_id) ON DELETE CASCADE;
ALTER TABLE public.positioning_region_suggestions ADD CONSTRAINT positioning_region_suggestions_region_org_fk
  FOREIGN KEY (region_id, organization_id) REFERENCES public.positioning_regions(id, organization_id) ON DELETE SET NULL (region_id);
DROP INDEX public.positioning_regions_cidade_nome_uniq;
ALTER TABLE public.positioning_regions ADD CONSTRAINT positioning_regions_org_unique UNIQUE (organization_id, cidade, nome, tipo);
ALTER TABLE public.positioning_regions DROP CONSTRAINT positioning_regions_uf_check;
ALTER TABLE public.positioning_regions DROP COLUMN uf, DROP COLUMN created_by;
DROP FUNCTION public.regiao_norm(text);

DELETE FROM public.organization_modules WHERE module = 'especialistas_publico';
DELETE FROM public.organization_module_history WHERE module = 'especialistas_publico';
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm'));
CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm')
     OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT enabled INTO _current FROM public.organization_modules
    WHERE organization_id = _org AND module = _module FOR UPDATE;
  IF _current IS NOT DISTINCT FROM _enabled THEN RETURN _enabled; END IF;
  INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (_org, _module, _enabled, now(), _actor)
  ON CONFLICT (organization_id, module)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = _actor;
  INSERT INTO public.organization_module_history (organization_id, module, enabled, actor_id)
  VALUES (_org, _module, _enabled, _actor);
  RETURN _enabled;
END $$;

COMMIT;
