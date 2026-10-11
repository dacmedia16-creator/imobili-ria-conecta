-- Tentativa de destravar item #7 da auditoria (funções auxiliares internas expostas como RPC
-- público via /rest/v1/rpc/<nome>). A migration anterior tentou REVOKE ... FROM PUBLIC, mas o
-- Supabase concede EXECUTE direto pros papéis anon/authenticated (não via PUBLIC) por padrão --
-- então aquele REVOKE não teve efeito nenhum (confirmado via information_schema.routine_privileges).
-- Esta migration revoga dos papéis certos -- e por isso quebrou RLS ao vivo (ver migration seguinte).
REVOKE EXECUTE ON FUNCTION public.can_edit_sale_comissao(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_edit_sale_stage(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_view_sale(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_active_user(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_lead_of(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_sale_locked(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leads_team_or_parent(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sees_team(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sees_own_team_leader(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_team_depth() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_team_leader_role() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_role_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_sale_status_transition() FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.update_contrato_pendencia(uuid, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.change_sale_status(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_stats() FROM anon;
