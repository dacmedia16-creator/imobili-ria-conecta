-- ============================================================
-- 1) is_active_user(NULL) hoje retorna TRUE (fail-open) por causa do COALESCE sem checar se _user é
-- NULL primeiro. Não é explorável hoje (toda policy combina isso com uma comparação de igualdade que
-- já falha sozinha pra NULL), mas é uma armadilha pra qualquer policy nova que use só essa função
-- como gate. Corrige pra fail-closed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_active_user(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user IS NOT NULL AND COALESCE((SELECT ativo FROM public.profiles WHERE id = _user), true);
$function$;

-- ============================================================
-- 2) Remove policy de DELETE duplicada em sales -- delete_sales_por_papel já cobre admin/super_admin
-- (além de corretor dono e gestor da equipe), sales_delete_admin era só um subconjunto redundante.
-- ============================================================
DROP POLICY IF EXISTS sales_delete_admin ON public.sales;

-- ============================================================
-- 3) Índices em foreign keys que não tinham (cascade delete e joins faziam table scan em vez de
-- index scan -- pouco sentido hoje com poucas linhas, mas cresce ruim conforme o volume aumenta).
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_activity_logs_autor_id ON public.activity_logs (autor_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sale_id ON public.notifications (sale_id);
CREATE INDEX IF NOT EXISTS idx_occurrence_commissions_occurrence_id ON public.occurrence_commissions (occurrence_id);
CREATE INDEX IF NOT EXISTS idx_occurrence_commissions_extra_id ON public.occurrence_commissions (sale_commission_extra_id);
CREATE INDEX IF NOT EXISTS idx_occurrence_partners_occurrence_id ON public.occurrence_partners (occurrence_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_aceita_financeiro_por ON public.occurrences (aceita_financeiro_por);
CREATE INDEX IF NOT EXISTS idx_occurrences_reopened_by ON public.occurrences (reopened_by);
CREATE INDEX IF NOT EXISTS idx_sale_bank_accounts_sale_id ON public.sale_bank_accounts (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_comments_autor_id ON public.sale_comments (autor_id);
CREATE INDEX IF NOT EXISTS idx_sale_comments_doc_id ON public.sale_comments (doc_id);
CREATE INDEX IF NOT EXISTS idx_sale_comments_sale_id ON public.sale_comments (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_commission_extras_sale_id ON public.sale_commission_extras (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_documents_uploaded_by ON public.sale_documents (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_sale_status_history_autor_id ON public.sale_status_history (autor_id);
CREATE INDEX IF NOT EXISTS idx_sales_coordenador_id ON public.sales (coordenador_id);
CREATE INDEX IF NOT EXISTS idx_sales_team_leader_id ON public.sales (team_leader_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON public.team_members (team_id);
CREATE INDEX IF NOT EXISTS idx_teams_lider_id ON public.teams (lider_id);
CREATE INDEX IF NOT EXISTS idx_teams_parent_team_id ON public.teams (parent_team_id);

-- NOTA: esta migration originalmente também tentava REVOKE EXECUTE ... FROM PUBLIC em várias
-- funções auxiliares internas (has_role, can_view_sale, etc.), pra impedir chamada direta via
-- /rest/v1/rpc/<nome>. Isso foi revertido nas duas migrations seguintes -- ver
-- 20260727040000_fix_revoke_execute_target_roles.sql e
-- 20260727050000_emergency_revert_execute_revoke.sql pro que aconteceu e por quê.
