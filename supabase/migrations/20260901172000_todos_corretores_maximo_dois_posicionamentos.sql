-- Todos os corretores ativos aparecem na vitrine, mesmo sem opt-in ou região.
-- Cada corretor pode manter no máximo dois locais de posicionamento.
BEGIN;

-- Ajusta dados legados antes de ativar a trava. Mantém os dois registros mais antigos.
WITH ranked AS (
  SELECT corretor_id, region_id,
         row_number() OVER (PARTITION BY corretor_id ORDER BY created_at, region_id) AS position_number
  FROM public.corretor_positioning_regions
)
DELETE FROM public.corretor_positioning_regions c
USING ranked r
WHERE c.corretor_id = r.corretor_id
  AND c.region_id = r.region_id
  AND r.position_number > 2;

CREATE OR REPLACE FUNCTION public.enforce_max_two_positioning_regions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.corretor_positioning_regions WHERE corretor_id = NEW.corretor_id) >= 2 THEN
    RAISE EXCEPTION 'Cada corretor pode selecionar no maximo 2 locais.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_max_two_positioning_regions ON public.corretor_positioning_regions;
CREATE TRIGGER trg_max_two_positioning_regions
BEFORE INSERT ON public.corretor_positioning_regions
FOR EACH ROW EXECUTE FUNCTION public.enforce_max_two_positioning_regions();

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
$$;

CREATE OR REPLACE FUNCTION public.list_public_positioning_regions()
RETURNS TABLE (id bigint, cidade text, zona text, nome text, tipo text, corretores bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.cidade, r.zona, r.nome, r.tipo, count(DISTINCT p.id)::bigint AS corretores
  FROM public.positioning_regions r
  LEFT JOIN public.corretor_positioning_regions c ON c.region_id = r.id
  LEFT JOIN public.profiles p ON p.id = c.corretor_id AND p.ativo
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'corretor'::public.app_role)
  WHERE r.ativo
  GROUP BY r.id, r.cidade, r.zona, r.nome, r.tipo
  ORDER BY r.cidade, r.zona NULLS LAST, r.nome;
$$;

DROP FUNCTION IF EXISTS public.list_public_specialists(text, bigint);
CREATE FUNCTION public.list_public_specialists(
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
  SELECT p.id, p.nome, p.avatar_url, p.telefone, p.pagina_pessoal_url, p.instagram_url,
    coalesce(
      jsonb_agg(jsonb_build_object(
        'id', r.id, 'nome', r.nome, 'cidade', r.cidade, 'zona', r.zona, 'tipo', r.tipo
      ) ORDER BY r.cidade, r.nome) FILTER (WHERE r.id IS NOT NULL),
      '[]'::jsonb
    ) AS regioes
  FROM public.profiles p
  LEFT JOIN public.corretor_positioning_regions c ON c.corretor_id = p.id
  LEFT JOIN public.positioning_regions r ON r.id = c.region_id AND r.ativo
  WHERE p.ativo
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'corretor'::public.app_role)
    AND (_region_id IS NULL OR EXISTS (
      SELECT 1 FROM public.corretor_positioning_regions cf WHERE cf.corretor_id = p.id AND cf.region_id = _region_id
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

REVOKE ALL ON FUNCTION public.list_public_specialists(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_specialists(text, bigint) TO anon, authenticated;

COMMIT;
