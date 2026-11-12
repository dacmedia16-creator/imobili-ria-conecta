-- Banner rotativo no topo do Início (cartão t_75786f5c, aprovado por Denis em 12/11/2026).
-- Decisão de Denis: "cada imobiliária administra o seu banner". Não existe banner global da plataforma.
--  * Tabela home_banners por imobiliária (organization_id). Navegador SEM acesso direto: tudo por RPC
--    SECURITY DEFINER que usa a imobiliária do contexto (current_org_id). RLS ligada + isolamento por org.
--  * Quem gerencia: admin, super_admin e staff da própria imobiliária (home_banner_pode_gerir).
--  * Quem vê: usuário ativo da imobiliária (is_active_user: o só-fotógrafo fica de fora) cujo papel está no
--    público-alvo (lista vazia = todos). O público aceita qualquer valor do enum app_role, então um papel
--    novo (ex.: 'locacao', cartão t_1fe07126) passa a valer sem outra migration.
--  * Sai do ar sozinho: o filtro por data (fuso de São Paulo, início e fim inclusivos) está na própria
--    consulta; não depende de rotina.
--  * Imagens: bucket PRIVADO 'home-banners', caminho <organization_id>/<uuid>.<ext>. Sem política para o
--    navegador: o servidor do ADM pede ao banco o caminho autorizado e gera a URL assinada (mesmo padrão
--    de locacao-documentos).
-- Rollback: docs/sql/rollback/20261121120000_home_banners.rollback.sql

-- 1) Tabela ------------------------------------------------------------------------------------------------
CREATE TABLE public.home_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 2 AND 80),
  imagem_path text NOT NULL UNIQUE,
  link text CHECK (link IS NULL OR length(link) <= 500),
  inicio date NOT NULL,
  fim date NOT NULL,
  publico text[] NOT NULL DEFAULT '{}'::text[],
  ordem integer NOT NULL DEFAULT 0 CHECK (ordem BETWEEN 0 AND 999),
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT home_banners_periodo CHECK (fim >= inicio)
);
CREATE INDEX home_banners_org_idx ON public.home_banners (organization_id, ativo, fim);

ALTER TABLE public.home_banners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.home_banners FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.home_banners TO service_role;
-- Defesa extra caso alguém conceda leitura no futuro: nunca enxergar outra imobiliária.
CREATE POLICY org_isolation ON public.home_banners AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
COMMENT ON TABLE public.home_banners
  IS 'Banners do topo do Início, por imobiliária (t_75786f5c). Acesso só pelas RPCs home_banner*.';

-- 2) Bucket privado das imagens ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('home-banners', 'home-banners', false, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'home-banners' AND public IS DISTINCT FROM false)
  THEN RAISE EXCEPTION 'Bucket home-banners deve ser privado'; END IF;
END $$;

-- 3) Permissão de gerenciar -----------------------------------------------------------------------------------
CREATE FUNCTION public.home_banner_pode_gerir() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(auth.uid() IS NOT NULL AND public.current_org_id() IS NOT NULL
    AND public.mt_1b_gate(public.current_org_id())
    AND public.has_any_role(auth.uid(), ARRAY['admin', 'super_admin', 'staff']::public.app_role[]), false)
$$;
REVOKE ALL ON FUNCTION public.home_banner_pode_gerir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_banner_pode_gerir() TO authenticated, service_role;

-- 4) Banners que o usuário logado vê agora no Início ------------------------------------------------------------
CREATE FUNCTION public.home_banners_ativos() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id();
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF _uid IS NULL OR _org IS NULL OR NOT public.is_active_user(_uid) THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'titulo', b.titulo,
                                                       'imagem_path', b.imagem_path, 'link', b.link)
                                    ORDER BY b.ordem, b.created_at)
    FROM (SELECT * FROM public.home_banners h
           WHERE h.organization_id = _org AND h.ativo AND _hoje BETWEEN h.inicio AND h.fim
             AND (cardinality(h.publico) = 0 OR EXISTS (
                   SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role::text = ANY (h.publico)))
           ORDER BY h.ordem, h.created_at LIMIT 20) b), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.home_banners_ativos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_banners_ativos() TO authenticated;

-- 5) Tela de cadastro -------------------------------------------------------------------------------------------
CREATE FUNCTION public.home_banners_lista() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.current_org_id();
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.home_banner_pode_gerir() THEN
    RAISE EXCEPTION 'Só administrador ou staff da imobiliária gerencia banners.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'titulo', h.titulo, 'imagem_path', h.imagem_path,
      'link', h.link, 'inicio', h.inicio, 'fim', h.fim, 'publico', to_jsonb(h.publico), 'ordem', h.ordem,
      'ativo', h.ativo, 'no_ar', h.ativo AND _hoje BETWEEN h.inicio AND h.fim, 'updated_at', h.updated_at)
    ORDER BY h.ordem, h.created_at)
    FROM public.home_banners h WHERE h.organization_id = _org), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.home_banners_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_banners_lista() TO authenticated;

-- Caminho novo para o envio da imagem (o servidor gera a URL assinada de envio com ele).
CREATE FUNCTION public.home_banner_preparar_envio(_ext text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.home_banner_pode_gerir() THEN
    RAISE EXCEPTION 'Só administrador ou staff da imobiliária gerencia banners.' USING ERRCODE = '42501';
  END IF;
  IF _ext IS NULL OR _ext NOT IN ('jpg', 'jpeg', 'png', 'webp') THEN
    RAISE EXCEPTION 'Envie uma imagem JPG, PNG ou WEBP.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('path', public.current_org_id()::text || '/' || gen_random_uuid()::text || '.' || _ext);
END $$;
REVOKE ALL ON FUNCTION public.home_banner_preparar_envio(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_banner_preparar_envio(text) TO authenticated;

-- Cria (_id nulo) ou edita. Devolve {id, path_antigo}: o servidor apaga a imagem trocada.
CREATE FUNCTION public.home_banner_salvar(_id uuid, _titulo text, _imagem_path text, _link text, _inicio date,
  _fim date, _publico text[], _ordem integer, _ativo boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _uid uuid := auth.uid(); _org uuid := public.current_org_id(); _old public.home_banners;
  _l text := nullif(btrim(coalesce(_link, '')), ''); _pub text[]; _novo uuid;
BEGIN
  IF NOT public.home_banner_pode_gerir() THEN
    RAISE EXCEPTION 'Só administrador ou staff da imobiliária gerencia banners.' USING ERRCODE = '42501';
  END IF;
  IF _titulo IS NULL OR length(btrim(_titulo)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Dê um nome ao banner (2 a 80 letras).' USING ERRCODE = '22023';
  END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio THEN
    RAISE EXCEPTION 'A data final precisa ser igual ou depois da inicial.' USING ERRCODE = '22023';
  END IF;
  IF _ordem IS NULL OR _ordem NOT BETWEEN 0 AND 999 THEN
    RAISE EXCEPTION 'Ordem inválida (0 a 999).' USING ERRCODE = '22023';
  END IF;
  -- Link: rota interna do ADM ("/vendas") ou endereço externo https. Nada de javascript:, http: ou "//host".
  IF _l IS NOT NULL AND NOT (length(_l) <= 500 AND (_l ~ '^/[A-Za-z0-9/_.~%?=&#+-]*$' AND _l !~ '^//'
                                                    OR _l ~ '^https://[^[:space:]<>"]+$')) THEN
    RAISE EXCEPTION 'Link inválido: use uma tela do ADM (começando com /) ou um endereço https://.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT p ORDER BY p), '{}') INTO _pub
    FROM unnest(coalesce(_publico, '{}'::text[])) p WHERE nullif(btrim(p), '') IS NOT NULL;
  IF EXISTS (SELECT 1 FROM unnest(_pub) p WHERE NOT (p = ANY (enum_range(NULL::public.app_role)::text[])))
     OR 'fotografo' = ANY (_pub) THEN
    RAISE EXCEPTION 'Público inválido.' USING ERRCODE = '22023';
  END IF;
  IF _id IS NOT NULL THEN
    SELECT * INTO _old FROM public.home_banners WHERE id = _id AND organization_id = _org FOR UPDATE;
    IF _old.id IS NULL THEN RAISE EXCEPTION 'Banner não encontrado.' USING ERRCODE = 'P0002'; END IF;
  END IF;
  -- Imagem: precisa ser um arquivo já enviado, desta imobiliária e ainda não usado por outro banner.
  IF _imagem_path IS NULL
     OR _imagem_path !~ ('^' || _org::text || '/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'home-banners' AND o.name = _imagem_path)
     OR EXISTS (SELECT 1 FROM public.home_banners h WHERE h.imagem_path = _imagem_path
                 AND h.id IS DISTINCT FROM _id) THEN
    RAISE EXCEPTION 'Imagem não encontrada. Envie a imagem de novo.' USING ERRCODE = '22023';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.home_banners (organization_id, titulo, imagem_path, link, inicio, fim, publico, ordem, ativo,
                                     criado_por, updated_by)
    VALUES (_org, btrim(_titulo), _imagem_path, _l, _inicio, _fim, _pub, _ordem, coalesce(_ativo, true), _uid, _uid)
    RETURNING id INTO _novo;
    RETURN jsonb_build_object('id', _novo, 'path_antigo', NULL);
  END IF;
  UPDATE public.home_banners SET titulo = btrim(_titulo), imagem_path = _imagem_path, link = _l, inicio = _inicio,
         fim = _fim, publico = _pub, ordem = _ordem, ativo = coalesce(_ativo, ativo), updated_by = _uid, updated_at = now()
   WHERE id = _id AND organization_id = _org;
  RETURN jsonb_build_object('id', _id,
    'path_antigo', CASE WHEN _old.imagem_path IS DISTINCT FROM _imagem_path THEN _old.imagem_path END);
END $$;
REVOKE ALL ON FUNCTION public.home_banner_salvar(uuid, text, text, text, date, date, text[], integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_banner_salvar(uuid, text, text, text, date, date, text[], integer, boolean) TO authenticated;

CREATE FUNCTION public.home_banner_ativar(_id uuid, _ativo boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.home_banner_pode_gerir() THEN
    RAISE EXCEPTION 'Só administrador ou staff da imobiliária gerencia banners.' USING ERRCODE = '42501';
  END IF;
  IF _ativo IS NULL THEN RAISE EXCEPTION 'Valor inválido.' USING ERRCODE = '22023'; END IF;
  UPDATE public.home_banners SET ativo = _ativo, updated_by = auth.uid(), updated_at = now()
   WHERE id = _id AND organization_id = public.current_org_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Banner não encontrado.' USING ERRCODE = 'P0002'; END IF;
  RETURN _ativo;
END $$;
REVOKE ALL ON FUNCTION public.home_banner_ativar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_banner_ativar(uuid, boolean) TO authenticated;

-- Exclui e devolve o caminho da imagem (o servidor apaga o arquivo).
CREATE FUNCTION public.home_banner_excluir(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _path text;
BEGIN
  IF NOT public.home_banner_pode_gerir() THEN
    RAISE EXCEPTION 'Só administrador ou staff da imobiliária gerencia banners.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.home_banners WHERE id = _id AND organization_id = public.current_org_id()
  RETURNING imagem_path INTO _path;
  IF _path IS NULL THEN RAISE EXCEPTION 'Banner não encontrado.' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('path', _path);
END $$;
REVOKE ALL ON FUNCTION public.home_banner_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_banner_excluir(uuid) TO authenticated;
