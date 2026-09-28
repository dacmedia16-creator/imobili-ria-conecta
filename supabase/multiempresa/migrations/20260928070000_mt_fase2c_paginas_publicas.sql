-- ADM MAX multiempresa — Fase 2c: páginas públicas (Especialistas) após a 1b.
-- NÃO aplicar em produção sem aprovação de Denis. Fora de supabase/migrations (sem `db push`).
--
-- Achado (auditoria de prontidão 28/09): a 1b passou `list_public_specialists` e
-- `list_public_positioning_regions` para o dono `mt_1b_definer` (sem BYPASSRLS). Para o visitante
-- anônimo, `current_org_id()` é NULL e a policy RESTRICTIVE `org_isolation` devolve 0 linhas:
-- a página pública /especialistas ficaria vazia em produção.
--
-- Correção: as duas RPCs voltam ao dono ORIGINAL (registrado em mt_1b_function_backup) e passam a
-- filtrar explicitamente UMA agência: a do usuário logado, senão a agência histórica
-- (legacy_default). Sem agência resolvida, nada é listado (falha fechada). Nunca mistura agências.
-- Página pública por agência (subdomínio/slug) depende de decisão de Denis (domínio definitivo).
-- Pré-requisito: 1a–1e (2a/2b opcionais). Rollback: .down.sql
BEGIN;
CREATE TABLE public.mt_2c_function_backup (signature text PRIMARY KEY, ddl text NOT NULL, owner_name text NOT NULL);
REVOKE ALL ON public.mt_2c_function_backup FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.mt_2c_function_backup(signature, ddl, owner_name)
SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text
  FROM pg_proc p
 WHERE p.oid IN ('public.list_public_specialists(text,bigint)'::regprocedure,
                 'public.list_public_positioning_regions()'::regprocedure);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_2c_function_backup) <> 2 THEN
    RAISE EXCEPTION 'Snapshot 2c incompleto';
  END IF;
  IF (SELECT count(*) FROM public.mt_1b_function_backup
       WHERE signature IN ('list_public_specialists(text,bigint)', 'list_public_positioning_regions()')) <> 2 THEN
    RAISE EXCEPTION 'Dono original (1b) nao encontrado; abortando 2c';
  END IF;
END $$;

-- Agência exibida na página pública: a do usuário logado ou, para visitante, a agência histórica.
CREATE FUNCTION public.mt_2c_public_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(public.current_org_id(), public.legacy_default_org_id())
$$;
REVOKE ALL ON FUNCTION public.mt_2c_public_org() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mt_2c_public_org() TO anon, authenticated, service_role;

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

-- Volta ao dono original (o que era antes da 1b). O filtro de agência agora é explícito no SQL.
DO $owner$
DECLARE f record;
BEGIN
  FOR f IN SELECT signature, owner_name FROM public.mt_1b_function_backup
            WHERE signature IN ('list_public_specialists(text,bigint)', 'list_public_positioning_regions()')
  LOOP
    EXECUTE format('ALTER FUNCTION public.%s OWNER TO %I', f.signature, f.owner_name);
  END LOOP;
END $owner$;
COMMIT;
