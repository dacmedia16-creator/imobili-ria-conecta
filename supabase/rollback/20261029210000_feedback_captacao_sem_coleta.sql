-- Rollback de 20261029210000_feedback_captacao_sem_coleta.sql: volta a exigir linha na coleta
-- (definição vigente desde 20261028160000). Não mexe em dados; marcações já feitas continuam gravadas.
BEGIN;

CREATE OR REPLACE FUNCTION public.owner_feedback_can_edit(_code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
      OR EXISTS (
        SELECT 1 FROM public.portal_listing_snapshots s
         WHERE s.organization_id = public.current_org_id()
           AND s.listing_code = _code
           AND public.owner_feedback_responsavel_ok(s.listing_code, s.broker_id))
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_can_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_can_edit(text) TO authenticated, service_role;

COMMIT;
