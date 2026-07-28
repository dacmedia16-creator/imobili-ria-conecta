-- Todas as policies abaixo chamavam auth.uid() direto na cláusula USING/WITH CHECK, o que faz o
-- Postgres reavaliar a função POR LINHA em vez de uma vez só por query (auth_rls_initplan no linter
-- do Supabase). Envolver em "(select auth.uid())" faz o planner cachear o valor uma vez (initplan) --
-- mesmo resultado, mais rápido conforme as tabelas crescem. Não muda nenhuma regra de permissão,
-- só a forma como o Postgres avalia a mesma expressão. Testado ao vivo (simulação de RLS) pra
-- corretor/gestor/financeiro/jurídico/admin/super_admin depois de aplicar.

-- activity_logs
DROP POLICY IF EXISTS log_insert ON public.activity_logs;
CREATE POLICY log_insert ON public.activity_logs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((autor_id = (select auth.uid())));
DROP POLICY IF EXISTS log_view ON public.activity_logs;
CREATE POLICY log_view ON public.activity_logs AS PERMISSIVE FOR SELECT TO authenticated USING ((((sale_id IS NULL) AND has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role])) OR ((sale_id IS NOT NULL) AND can_view_sale((select auth.uid()), sale_id))));

-- document_extractions
DROP POLICY IF EXISTS "delete extractions if can view sale" ON public.document_extractions;
CREATE POLICY "delete extractions if can view sale" ON public.document_extractions AS PERMISSIVE FOR DELETE TO authenticated USING (can_view_sale((select auth.uid()), sale_id));
DROP POLICY IF EXISTS "insert extractions if can view sale" ON public.document_extractions;
CREATE POLICY "insert extractions if can view sale" ON public.document_extractions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (can_view_sale((select auth.uid()), sale_id));
DROP POLICY IF EXISTS "update extractions if can view sale" ON public.document_extractions;
CREATE POLICY "update extractions if can view sale" ON public.document_extractions AS PERMISSIVE FOR UPDATE TO authenticated USING (can_view_sale((select auth.uid()), sale_id)) WITH CHECK (can_view_sale((select auth.uid()), sale_id));
DROP POLICY IF EXISTS "view extractions if can view sale" ON public.document_extractions;
CREATE POLICY "view extractions if can view sale" ON public.document_extractions AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale((select auth.uid()), sale_id));

-- notifications
DROP POLICY IF EXISTS notif_insert ON public.notifications;
CREATE POLICY notif_insert ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = (select auth.uid())) OR has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role, 'financeiro'::app_role, 'gestor'::app_role, 'juridico'::app_role])));
DROP POLICY IF EXISTS notif_self ON public.notifications;
CREATE POLICY notif_self ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = (select auth.uid())));
DROP POLICY IF EXISTS notif_update_self ON public.notifications;
CREATE POLICY notif_update_self ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = (select auth.uid()))) WITH CHECK ((user_id = (select auth.uid())));

-- occurrence_commissions
DROP POLICY IF EXISTS occ_comm_view ON public.occurrence_commissions;
CREATE POLICY occ_comm_view ON public.occurrence_commissions AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1 FROM occurrences o WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_view_sale((select auth.uid()), o.sale_id)))));
DROP POLICY IF EXISTS occ_comm_write ON public.occurrence_commissions;
CREATE POLICY occ_comm_write ON public.occurrence_commissions AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1 FROM occurrences o WHERE ((o.id = occurrence_commissions.occurrence_id) AND has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]))))) WITH CHECK ((EXISTS ( SELECT 1 FROM occurrences o WHERE ((o.id = occurrence_commissions.occurrence_id) AND has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]) AND ((NOT is_sale_locked(o.sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))))));

-- occurrence_partners
DROP POLICY IF EXISTS occ_part_view ON public.occurrence_partners;
CREATE POLICY occ_part_view ON public.occurrence_partners AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1 FROM occurrences o WHERE ((o.id = occurrence_partners.occurrence_id) AND can_view_sale((select auth.uid()), o.sale_id)))));
DROP POLICY IF EXISTS occ_part_write ON public.occurrence_partners;
CREATE POLICY occ_part_write ON public.occurrence_partners AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1 FROM occurrences o WHERE ((o.id = occurrence_partners.occurrence_id) AND has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]))))) WITH CHECK ((EXISTS ( SELECT 1 FROM occurrences o WHERE ((o.id = occurrence_partners.occurrence_id) AND has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]) AND ((NOT is_sale_locked(o.sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))))));

-- occurrences
DROP POLICY IF EXISTS occ_view ON public.occurrences;
CREATE POLICY occ_view ON public.occurrences AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale((select auth.uid()), sale_id));
DROP POLICY IF EXISTS occ_write ON public.occurrences;
CREATE POLICY occ_write ON public.occurrences AS PERMISSIVE FOR ALL TO authenticated USING ((has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]) AND can_view_sale((select auth.uid()), sale_id))) WITH CHECK ((has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role]) AND can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]))));

-- profiles
DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((id = (select auth.uid())) OR has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role])));
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (((id = (select auth.uid())) OR has_any_role((select auth.uid()), ARRAY['gestor'::app_role, 'juridico'::app_role, 'financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) OR sees_own_team_leader(id, (select auth.uid()))));
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING (((id = (select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role))) WITH CHECK (((id = (select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)));

-- sale_bank_accounts
DROP POLICY IF EXISTS sale_bank_delete ON public.sale_bank_accounts;
CREATE POLICY sale_bank_delete ON public.sale_bank_accounts AS PERMISSIVE FOR DELETE TO authenticated USING ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));
DROP POLICY IF EXISTS sale_bank_insert ON public.sale_bank_accounts;
CREATE POLICY sale_bank_insert ON public.sale_bank_accounts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));
DROP POLICY IF EXISTS sale_bank_select ON public.sale_bank_accounts;
CREATE POLICY sale_bank_select ON public.sale_bank_accounts AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale((select auth.uid()), sale_id));
DROP POLICY IF EXISTS sale_bank_update ON public.sale_bank_accounts;
CREATE POLICY sale_bank_update ON public.sale_bank_accounts AS PERMISSIVE FOR UPDATE TO authenticated USING (can_view_sale((select auth.uid()), sale_id)) WITH CHECK ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));

-- sale_comments
DROP POLICY IF EXISTS sale_comments_insert ON public.sale_comments;
CREATE POLICY sale_comments_insert ON public.sale_comments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((can_view_sale((select auth.uid()), sale_id) AND (autor_id = (select auth.uid()))));
DROP POLICY IF EXISTS sale_comments_view ON public.sale_comments;
CREATE POLICY sale_comments_view ON public.sale_comments AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale((select auth.uid()), sale_id));

-- sale_commission_extras
DROP POLICY IF EXISTS sale_commission_extras_delete ON public.sale_commission_extras;
CREATE POLICY sale_commission_extras_delete ON public.sale_commission_extras AS PERMISSIVE FOR DELETE TO authenticated USING (can_edit_sale_comissao((select auth.uid()), sale_id));
DROP POLICY IF EXISTS sale_commission_extras_insert ON public.sale_commission_extras;
CREATE POLICY sale_commission_extras_insert ON public.sale_commission_extras AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (can_edit_sale_comissao((select auth.uid()), sale_id));
DROP POLICY IF EXISTS sale_commission_extras_select ON public.sale_commission_extras;
CREATE POLICY sale_commission_extras_select ON public.sale_commission_extras AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale((select auth.uid()), sale_id));
DROP POLICY IF EXISTS sale_commission_extras_update ON public.sale_commission_extras;
CREATE POLICY sale_commission_extras_update ON public.sale_commission_extras AS PERMISSIVE FOR UPDATE TO authenticated USING (can_edit_sale_comissao((select auth.uid()), sale_id)) WITH CHECK (can_edit_sale_comissao((select auth.uid()), sale_id));

-- sale_documents
DROP POLICY IF EXISTS sale_docs_delete ON public.sale_documents;
CREATE POLICY sale_docs_delete ON public.sale_documents AS PERMISSIVE FOR DELETE TO authenticated USING ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));
DROP POLICY IF EXISTS sale_docs_insert ON public.sale_documents;
CREATE POLICY sale_docs_insert ON public.sale_documents AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));
DROP POLICY IF EXISTS sale_docs_select ON public.sale_documents;
CREATE POLICY sale_docs_select ON public.sale_documents AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale((select auth.uid()), sale_id));
DROP POLICY IF EXISTS sale_docs_update ON public.sale_documents;
CREATE POLICY sale_docs_update ON public.sale_documents AS PERMISSIVE FOR UPDATE TO authenticated USING (can_view_sale((select auth.uid()), sale_id)) WITH CHECK ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));

-- sale_parties
DROP POLICY IF EXISTS sale_parties_delete ON public.sale_parties;
CREATE POLICY sale_parties_delete ON public.sale_parties AS PERMISSIVE FOR DELETE TO authenticated USING ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));
DROP POLICY IF EXISTS sale_parties_insert ON public.sale_parties;
CREATE POLICY sale_parties_insert ON public.sale_parties AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));
DROP POLICY IF EXISTS sale_parties_select ON public.sale_parties;
CREATE POLICY sale_parties_select ON public.sale_parties AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale((select auth.uid()), sale_id));
DROP POLICY IF EXISTS sale_parties_update ON public.sale_parties;
CREATE POLICY sale_parties_update ON public.sale_parties AS PERMISSIVE FOR UPDATE TO authenticated USING (can_view_sale((select auth.uid()), sale_id)) WITH CHECK ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));

-- sale_payment
DROP POLICY IF EXISTS sale_payment_delete ON public.sale_payment;
CREATE POLICY sale_payment_delete ON public.sale_payment AS PERMISSIVE FOR DELETE TO authenticated USING ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));
DROP POLICY IF EXISTS sale_payment_insert ON public.sale_payment;
CREATE POLICY sale_payment_insert ON public.sale_payment AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));
DROP POLICY IF EXISTS sale_payment_select ON public.sale_payment;
CREATE POLICY sale_payment_select ON public.sale_payment AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale((select auth.uid()), sale_id));
DROP POLICY IF EXISTS sale_payment_update ON public.sale_payment;
CREATE POLICY sale_payment_update ON public.sale_payment AS PERMISSIVE FOR UPDATE TO authenticated USING (can_view_sale((select auth.uid()), sale_id)) WITH CHECK ((can_view_sale((select auth.uid()), sale_id) AND ((NOT is_sale_locked(sale_id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), sale_id)));

-- sale_status_history
DROP POLICY IF EXISTS history_insert ON public.sale_status_history;
CREATE POLICY history_insert ON public.sale_status_history AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (can_view_sale((select auth.uid()), sale_id));
DROP POLICY IF EXISTS history_view ON public.sale_status_history;
CREATE POLICY history_view ON public.sale_status_history AS PERMISSIVE FOR SELECT TO authenticated USING (can_view_sale((select auth.uid()), sale_id));

-- sales
DROP POLICY IF EXISTS delete_sales_por_papel ON public.sales;
CREATE POLICY delete_sales_por_papel ON public.sales AS PERMISSIVE FOR DELETE TO authenticated USING ((is_active_user((select auth.uid())) AND (has_any_role((select auth.uid()), ARRAY['super_admin'::app_role, 'admin'::app_role, 'financeiro'::app_role]) OR ((corretor_id = (select auth.uid())) AND (NOT is_sale_locked(id))) OR (has_role((select auth.uid()), 'gestor'::app_role) AND is_lead_of((select auth.uid()), corretor_id) AND (NOT is_sale_locked(id))))));
DROP POLICY IF EXISTS sales_insert_corretor ON public.sales;
CREATE POLICY sales_insert_corretor ON public.sales AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((corretor_id = (select auth.uid())) AND has_role((select auth.uid()), 'corretor'::app_role)));
DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales AS PERMISSIVE FOR SELECT TO authenticated USING ((is_active_user((select auth.uid())) AND ((corretor_id = (select auth.uid())) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) OR (has_role((select auth.uid()), 'gestor'::app_role) AND is_lead_of((select auth.uid()), corretor_id)) OR (has_role((select auth.uid()), 'juridico'::app_role) AND ((status)::text = ANY (ARRAY['aprovada_gestor'::text, 'enviada_juridico'::text, 'em_elaboracao_contrato'::text, 'contrato_conferencia_gestor'::text, 'contrato_conferencia_corretor'::text, 'contrato_ok_corretor'::text, 'aguardando_assinatura'::text, 'contrato_assinado'::text, 'ocorrencia_pendente'::text, 'ocorrencia_analise_financeiro'::text, 'ocorrencia_devolvida_gestor'::text, 'ocorrencia_concluida'::text]))))));
DROP POLICY IF EXISTS sales_update_owner_draft ON public.sales;
CREATE POLICY sales_update_owner_draft ON public.sales AS PERMISSIVE FOR UPDATE TO authenticated USING ((can_view_sale((select auth.uid()), id) AND ((NOT is_sale_locked(id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])))) WITH CHECK ((can_view_sale((select auth.uid()), id) AND ((NOT is_sale_locked(id)) OR has_any_role((select auth.uid()), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])) AND can_edit_sale_stage((select auth.uid()), id)));

-- team_members
DROP POLICY IF EXISTS team_members_select ON public.team_members;
CREATE POLICY team_members_select ON public.team_members AS PERMISSIVE FOR SELECT TO authenticated USING ((has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR (membro_id = (select auth.uid())) OR sees_team(team_id, (select auth.uid()))));
DROP POLICY IF EXISTS team_members_write ON public.team_members;
CREATE POLICY team_members_write ON public.team_members AS PERMISSIVE FOR ALL TO authenticated USING ((has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR leads_team_or_parent(team_id, (select auth.uid())))) WITH CHECK ((has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR leads_team_or_parent(team_id, (select auth.uid()))));

-- teams
DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams AS PERMISSIVE FOR SELECT TO authenticated USING ((has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR (lider_id = (select auth.uid())) OR sees_team(id, (select auth.uid()))));
DROP POLICY IF EXISTS teams_write ON public.teams;
CREATE POLICY teams_write ON public.teams AS PERMISSIVE FOR ALL TO authenticated USING ((is_active_user((select auth.uid())) AND (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR leads_team_or_parent(id, (select auth.uid()))))) WITH CHECK ((is_active_user((select auth.uid())) AND (has_any_role((select auth.uid()), ARRAY['admin'::app_role, 'super_admin'::app_role]) OR (lider_id = (select auth.uid())) OR ((parent_team_id IS NOT NULL) AND leads_team_or_parent(parent_team_id, (select auth.uid()))))));

-- user_roles
DROP POLICY IF EXISTS user_roles_admin_write ON public.user_roles;
CREATE POLICY user_roles_admin_write ON public.user_roles AS PERMISSIVE FOR ALL TO authenticated USING ((((select auth.uid()) <> user_id) AND (has_role((select auth.uid()), 'super_admin'::app_role) OR (has_role((select auth.uid()), 'admin'::app_role) AND (role <> ALL (ARRAY['admin'::app_role, 'super_admin'::app_role])))))) WITH CHECK ((((select auth.uid()) <> user_id) AND (has_role((select auth.uid()), 'super_admin'::app_role) OR (has_role((select auth.uid()), 'admin'::app_role) AND (role <> ALL (ARRAY['admin'::app_role, 'super_admin'::app_role]))))));
DROP POLICY IF EXISTS user_roles_self_select ON public.user_roles;
CREATE POLICY user_roles_self_select ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = (select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)));
DROP POLICY IF EXISTS user_roles_self_update_notif ON public.user_roles;
CREATE POLICY user_roles_self_update_notif ON public.user_roles AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = (select auth.uid()))) WITH CHECK ((user_id = (select auth.uid())));
