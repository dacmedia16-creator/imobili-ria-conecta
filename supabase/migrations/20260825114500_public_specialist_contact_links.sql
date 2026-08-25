-- Contatos públicos opcionais para a vitrine de especialistas.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pagina_pessoal_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_pagina_pessoal_url_http,
  ADD CONSTRAINT profiles_pagina_pessoal_url_http CHECK (
    pagina_pessoal_url IS NULL OR pagina_pessoal_url ~* '^https?://'
  ),
  DROP CONSTRAINT IF EXISTS profiles_instagram_url_https,
  ADD CONSTRAINT profiles_instagram_url_https CHECK (
    instagram_url IS NULL OR instagram_url ~* '^https://(www\.)?instagram\.com/'
  );

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
