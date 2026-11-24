-- Rollback de 20270104120000_leads_sem_responsavel_so_admin (t_b904eca2).
-- Volta ao estado da 20270103120000: gestor vê (e atribui) os leads SEM responsável.
BEGIN;

CREATE OR REPLACE FUNCTION public.leads_ve_responsavel(_resp uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND coalesce(
    public.leads_admin()
    OR (_resp IS NULL AND public.leads_gestor())
    OR _resp IN (SELECT public.leads_responsaveis_visiveis()), false)
$$;
REVOKE ALL ON FUNCTION public.leads_ve_responsavel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leads_ve_responsavel(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS leads_read ON public.leads;
CREATE POLICY leads_read ON public.leads FOR SELECT TO authenticated
  USING ((SELECT public.leads_admin())
         OR (responsavel_id IS NULL AND (SELECT public.leads_gestor()))
         OR responsavel_id IN (SELECT public.leads_responsaveis_visiveis()));

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20270104120000';

COMMIT;
