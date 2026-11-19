-- Página pública /especialistas: logo de cada imobiliária no card (pedido de Denis 19/11, t_332f1790).
-- Muda SÓ o retorno de list_public_specialist_agencies: acrescenta logo_path (caminho no bucket
-- público organization-logos, o mesmo usado nos PDFs e em Dados da imobiliária). Nenhum outro dado novo.
-- O tipo de retorno muda, então é DROP + CREATE (CREATE OR REPLACE não aceita). Corpo copiado da produção em 19/11.
-- Reversão: docs/sql/rollback/20261204120000_especialistas_logo_imobiliaria.rollback.sql
BEGIN;

DROP FUNCTION public.list_public_specialist_agencies();

CREATE FUNCTION public.list_public_specialist_agencies()
RETURNS TABLE(slug text, nome text, cidade text, uf text, especialistas bigint, logo_path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT o.slug, o.nome, o.cidade, o.uf, count(p.id)::bigint, o.logo_path
    FROM public.organizations o
    JOIN public.organization_modules m ON m.organization_id = o.id AND m.module = 'especialistas_publico' AND m.enabled
    JOIN public.profiles p ON p.organization_id = o.id AND p.ativo
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'corretor'::public.app_role
                   AND ur.organization_id = o.id)
   WHERE o.status = 'ativa'
   GROUP BY o.id, o.slug, o.nome, o.cidade, o.uf, o.logo_path
   ORDER BY o.nome
$$;

REVOKE ALL ON FUNCTION public.list_public_specialist_agencies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_specialist_agencies() TO anon, authenticated, service_role;

COMMIT;
