-- REVERT DE EMERGÊNCIA. A migration anterior revogou EXECUTE de authenticated nessas funções
-- achando que só afetaria chamada direta via /rest/v1/rpc/... -- mas RLS avalia a expressão da
-- policy com o privilégio do papel que fez a query (authenticated), então revogar EXECUTE de uma
-- função usada DENTRO de uma policy quebra QUALQUER leitura/escrita nas tabelas que usam ela, não só
-- a chamada direta. Confirmado ao vivo: "permission denied for function is_active_user" ao tentar
-- SELECT em sales como authenticated logo após a migration anterior.
--
-- Conclusão: não existe, em Postgres/PostgREST puro, uma forma de "permitir uso só dentro de RLS,
-- mas bloquear RPC direto" via GRANT/REVOKE -- é o mesmo privilégio de EXECUTE nos dois casos. A
-- forma certa de resolver o item #7 da auditoria (funções auxiliares expostas como RPC público)
-- seria mover essas funções pra um schema não exposto pelo PostgREST (ex.: "private", fora de
-- db-schemas) e apontar as policies/funções pra lá -- isso fica pendente, não foi refeito nesta
-- sessão dado o risco. Esta migration só restaura o estado original (GRANT de volta).
GRANT EXECUTE ON FUNCTION public.can_edit_sale_comissao(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_sale_stage(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_sale(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_lead_of(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_sale_locked(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_team_or_parent(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sees_team(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sees_own_team_leader(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_team_depth() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_team_leader_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_role_change() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_sale_status_transition() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_contrato_pendencia(uuid, text, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.change_sale_status(uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.dashboard_stats() TO anon;
