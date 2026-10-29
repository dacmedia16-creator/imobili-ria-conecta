-- Feedback ao Proprietário: o captador atual (ou o gestor/team leader dele) pode marcar ações também
-- num anúncio LIGADO a uma captação que ainda não apareceu na coleta (portal_listing_snapshots).
-- Caso real (t_5b336055 / t_80259df9, "pode publicar" de Denis 29/10): anúncio ligado hoje aparece na
-- /feedback pelo XML RE/MAX, mas a marcação era recusada porque só se olhava a coleta.
-- O que NÃO muda: anúncio sem captação ligada e sem coleta continua bloqueado (responsável NULL -> false);
-- com captação ligada, o responsável é sempre o captador atual (corretor antigo segue sem acesso);
-- admin/super_admin continua liberado. Nenhum dado muda; só esta função.
-- Rollback: supabase/rollback/20261029210000_feedback_captacao_sem_coleta.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.owner_feedback_can_edit(_code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
      OR EXISTS (
        SELECT 1 FROM public.portal_listing_snapshots s
         WHERE s.organization_id = public.current_org_id()
           AND s.listing_code = _code
           AND public.owner_feedback_responsavel_ok(s.listing_code, s.broker_id))
      -- Sem coleta: só vale com captação ligada (sem captação, o responsável fica NULL e dá false).
      OR public.owner_feedback_responsavel_ok(_code, NULL)
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_can_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_can_edit(text) TO authenticated, service_role;

COMMIT;
