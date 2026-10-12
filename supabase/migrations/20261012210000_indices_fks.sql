-- t_daa40545 (item 6): índices para chaves estrangeiras sem índice na coluna inicial.
-- Só cria índices; nenhum dado é alterado. Idempotente (IF NOT EXISTS) e tolerante a ambientes
-- em que a tabela/coluna ainda não existe (pula). Tabelas pequenas: CREATE INDEX comum dentro da
-- transação da migration (CONCURRENTLY não roda em transação e não é necessário neste volume).
-- Reversão: supabase/rollback/20261012210000_indices_fks.sql
do $$
declare
  r record;
begin
  for r in
    select * from (values
    ('clientes', 'updated_by', 'idx_clientes_updated_by_fk'),
    ('exclusive_capture_setting_history', 'actor_id', 'idx_exclusive_capture_setting_history_actor_id_fk'),
    ('exclusive_captures', 'created_by', 'idx_exclusive_captures_created_by_fk'),
    ('exclusive_captures', 'unit_id', 'idx_exclusive_captures_unit_id_fk'),
    ('exclusive_documents', 'uploaded_by', 'idx_exclusive_documents_uploaded_by_fk'),
    ('exclusive_expiry_alert_deliveries', 'organization_id', 'idx_exclusive_expiry_alert_deliveries_organization_id_fk'),
    ('exclusive_history', 'actor_id', 'idx_exclusive_history_actor_id_fk'),
    ('exclusive_listing_links', 'decided_by', 'idx_exclusive_listing_links_decided_by_fk'),
    ('exclusive_listing_links', 'ended_by', 'idx_exclusive_listing_links_ended_by_fk'),
    ('exclusive_listing_links', 'linked_by', 'idx_exclusive_listing_links_linked_by_fk'),
    ('exclusive_plan_done', 'action_id', 'idx_exclusive_plan_done_action_id_fk'),
    ('exclusive_plan_done', 'done_by', 'idx_exclusive_plan_done_done_by_fk'),
    ('exclusive_plan_done', 'organization_id', 'idx_exclusive_plan_done_organization_id_fk'),
    ('juridico_agent_audit', 'document_id', 'idx_juridico_agent_audit_document_id_fk'),
    ('metas', 'created_by', 'idx_metas_created_by_fk'),
    ('operational_impersonation_actions', 'actor_user_id', 'idx_operational_impersonation_actions_actor_user_id_fk'),
    ('operational_impersonation_actions', 'impersonation_session_id', 'idx_operational_impersonation_actio_impersonation_session_id_fk'),
    ('operational_impersonation_actions', 'target_user_id', 'idx_operational_impersonation_actions_target_user_id_fk'),
    ('operational_impersonation_sessions', 'actor_user_id', 'idx_operational_impersonation_sessions_actor_user_id_fk'),
    ('operational_impersonation_sessions', 'target_user_id', 'idx_operational_impersonation_sessions_target_user_id_fk'),
    ('owner_feedback_action_done', 'action_id', 'idx_owner_feedback_action_done_action_id_fk'),
    ('owner_feedback_action_done', 'done_by', 'idx_owner_feedback_action_done_done_by_fk'),
    ('platform_org_context_actions', 'actor_user_id', 'idx_platform_org_context_actions_actor_user_id_fk'),
    ('platform_org_context_actions', 'organization_id', 'idx_platform_org_context_actions_organization_id_fk'),
    ('platform_org_context_sessions', 'organization_id', 'idx_platform_org_context_sessions_organization_id_fk'),
    ('platform_sale_cancellations', 'sale_organization_id', 'idx_platform_sale_cancellations_sale_organization_id_fk'),
    ('positioning_region_suggestions', 'region_id', 'idx_positioning_region_suggestions_region_id_fk'),
    ('positioning_region_suggestions', 'reviewed_by', 'idx_positioning_region_suggestions_reviewed_by_fk'),
    ('positioning_region_suggestions', 'suggested_by', 'idx_positioning_region_suggestions_suggested_by_fk'),
    ('room_reservation_reminder_deliveries', 'recipient_id', 'idx_room_reservation_reminder_deliveries_recipient_id_fk'),
    ('room_reservations', 'canceled_by', 'idx_room_reservations_canceled_by_fk'),
    ('sale_comment_recipients', 'user_id', 'idx_sale_comment_recipients_user_id_fk'),
    ('sale_documents', 'deleted_by', 'idx_sale_documents_deleted_by_fk'),
    ('sales', 'area_confirmada_por', 'idx_sales_area_confirmada_por_fk'),
    ('sales', 'indicador_captador_id', 'idx_sales_indicador_captador_id_fk'),
    ('sales', 'indicador_vendedor_id', 'idx_sales_indicador_vendedor_id_fk'),
    ('sales', 'lancamento_saldo_confirmado_por', 'idx_sales_lancamento_saldo_confirmado_por_fk'),
    ('support_ticket_messages', 'author_id', 'idx_support_ticket_messages_author_id_fk'),
    ('user_preview_audit', 'actor_user_id', 'idx_user_preview_audit_actor_user_id_fk'),
    ('user_preview_audit', 'target_user_id', 'idx_user_preview_audit_target_user_id_fk')
    ) as v(tbl, col, idx)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = r.tbl and column_name = r.col
    ) then
      execute format('create index if not exists %I on public.%I (%I)', r.idx, r.tbl, r.col);
    else
      raise notice 'pulado (não existe neste ambiente): %.%', r.tbl, r.col;
    end if;
  end loop;
end $$;
