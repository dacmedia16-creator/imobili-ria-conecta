-- Amplia o posicionamento público para todos os profissionais comerciais ativos:
-- Corretor, Gestor e Team Leader. Consentimento, telefone e ao menos uma região
-- continuam obrigatórios para aparecer na vitrine.
BEGIN;

DROP POLICY IF EXISTS corretor_positioning_self_insert
  ON public.corretor_positioning_regions;
CREATE POLICY corretor_positioning_self_insert
  ON public.corretor_positioning_regions FOR INSERT TO authenticated
  WITH CHECK (
    corretor_id = (SELECT auth.uid())
    AND public.is_active_user((SELECT auth.uid()))
    AND public.has_any_role(
      (SELECT auth.uid()),
      ARRAY['corretor','gestor','team_leader']::public.app_role[]
    )
  );

CREATE OR REPLACE FUNCTION public.save_my_positioning(
  _region_ids bigint[],
  _public_enabled boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
BEGIN
  IF _user IS NULL OR NOT public.is_active_user(_user)
    OR NOT public.has_any_role(
      _user,
      ARRAY['corretor','gestor','team_leader']::public.app_role[]
    ) THEN
    RAISE EXCEPTION 'Apenas Corretores, Gestores e Team Leaders ativos podem editar o posicionamento.';
  END IF;

  IF coalesce(cardinality(_region_ids), 0) > 20 THEN
    RAISE EXCEPTION 'Selecione no maximo 20 regioes.';
  END IF;

  IF _public_enabled AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user
      AND nullif(trim(p.nome), '') IS NOT NULL
      AND nullif(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g'), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Preencha nome e telefone antes de publicar seu perfil.';
  END IF;

  IF _public_enabled AND coalesce(cardinality(_region_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Selecione pelo menos uma regiao antes de publicar seu perfil.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(_region_ids, ARRAY[]::bigint[])) requested(id)
    LEFT JOIN public.positioning_regions r ON r.id = requested.id AND r.ativo
    WHERE r.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Uma das regioes selecionadas nao esta disponivel.';
  END IF;

  DELETE FROM public.corretor_positioning_regions WHERE corretor_id = _user;
  INSERT INTO public.corretor_positioning_regions (corretor_id, region_id)
  SELECT _user, requested.id
  FROM unnest(coalesce(_region_ids, ARRAY[]::bigint[])) AS requested(id)
  GROUP BY requested.id;

  UPDATE public.profiles
  SET public_profile_enabled = _public_enabled
  WHERE profiles.id = _user;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_public_positioning_regions()
RETURNS TABLE (id bigint, cidade text, zona text, nome text, tipo text, corretores bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id, r.cidade, r.zona, r.nome, r.tipo,
    count(DISTINCT p.id)::bigint AS corretores
  FROM public.positioning_regions r
  LEFT JOIN public.corretor_positioning_regions c ON c.region_id = r.id
  LEFT JOIN public.profiles p
    ON p.id = c.corretor_id
    AND p.ativo
    AND p.public_profile_enabled
    AND nullif(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g'), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id
        AND ur.role IN ('corretor','gestor','team_leader')
    )
  WHERE r.ativo
  GROUP BY r.id, r.cidade, r.zona, r.nome, r.tipo
  ORDER BY r.cidade, r.zona NULLS LAST, r.nome;
$$;

CREATE OR REPLACE FUNCTION public.list_public_specialists(
  _search text DEFAULT NULL,
  _region_id bigint DEFAULT NULL
)
RETURNS TABLE (
  id uuid, nome text, avatar_url text, telefone text,
  pagina_pessoal_url text, instagram_url text, regioes jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id, p.nome, p.avatar_url, p.telefone,
    p.pagina_pessoal_url, p.instagram_url,
    jsonb_agg(jsonb_build_object(
      'id', r.id, 'nome', r.nome, 'cidade', r.cidade, 'zona', r.zona, 'tipo', r.tipo
    ) ORDER BY r.cidade, r.nome) AS regioes
  FROM public.profiles p
  JOIN public.corretor_positioning_regions c ON c.corretor_id = p.id
  JOIN public.positioning_regions r ON r.id = c.region_id AND r.ativo
  WHERE p.ativo AND p.public_profile_enabled
    AND nullif(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g'), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id
        AND ur.role IN ('corretor','gestor','team_leader')
    )
    AND (_region_id IS NULL OR EXISTS (
      SELECT 1 FROM public.corretor_positioning_regions cf
      WHERE cf.corretor_id = p.id AND cf.region_id = _region_id
    ))
    AND (nullif(trim(_search), '') IS NULL OR p.nome ILIKE '%' || trim(_search) || '%' OR EXISTS (
      SELECT 1 FROM public.corretor_positioning_regions cs
      JOIN public.positioning_regions rs ON rs.id = cs.region_id
      WHERE cs.corretor_id = p.id
        AND (rs.nome ILIKE '%' || trim(_search) || '%' OR rs.cidade ILIKE '%' || trim(_search) || '%')
    ))
  GROUP BY p.id, p.nome, p.avatar_url, p.telefone, p.pagina_pessoal_url, p.instagram_url
  ORDER BY p.nome;
$$;

CREATE OR REPLACE FUNCTION public.submit_positioning_region_suggestion(
  _cidade text,
  _zona text,
  _nome text,
  _tipo text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.save_my_positioning(bigint[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_public_positioning_regions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_public_specialists(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_positioning_region_suggestion(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_my_positioning(bigint[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_positioning_regions() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_specialists(text, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_positioning_region_suggestion(text,text,text,text) TO authenticated;

COMMIT;
