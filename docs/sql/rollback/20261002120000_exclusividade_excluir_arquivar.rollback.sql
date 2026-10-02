-- Rollback de 20261002120000_exclusividade_excluir_arquivar (restaura definições de 02/10/2026).
-- Atenção: captações excluídas (discarded_at) voltam a aparecer após o rollback.
BEGIN;
DROP FUNCTION public.exclusive_archive(uuid, text);
CREATE OR REPLACE FUNCTION public.exclusive_can_view(_id uuid, _actor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  SELECT public.exclusive_capture_enabled() AND public.exclusive_actor_active(_actor)
    AND public.has_any_role(_actor,
      ARRAY['corretor','gestor','team_leader','admin','super_admin']::public.app_role[]) AND EXISTS (
    SELECT 1 FROM public.exclusive_captures c
    WHERE c.id = _id AND (
      c.captor_id = _actor
      OR public.has_any_role(_actor, ARRAY['admin','super_admin']::public.app_role[])
      OR (public.has_any_role(_actor, ARRAY['gestor','team_leader']::public.app_role[])
          AND public.is_lead_of(_actor, c.captor_id))
    )
  )

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_actor) AND EXISTS (SELECT 1 FROM public.exclusive_captures WHERE id=_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$
;

CREATE OR REPLACE FUNCTION public.exclusive_is_editor(_id uuid, _actor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  SELECT public.exclusive_can_view(_id, _actor) AND EXISTS (
    SELECT 1 FROM public.exclusive_captures c WHERE c.id = _id
      AND c.status IN ('rascunho','devolvida')
  )

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_actor) AND EXISTS (SELECT 1 FROM public.exclusive_captures WHERE id=_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$
;

ALTER TABLE public.exclusive_captures
  DROP COLUMN archived_at, DROP COLUMN archived_by, DROP COLUMN discarded_at, DROP COLUMN discarded_by;
COMMIT;
