-- Applies supabase-postgres-best-practices recommendations:
--   1) index FK/join columns missing an index (query-missing-indexes, schema-foreign-key-indexes)
--   2) drop redundant/duplicate indexes
--   3) wrap auth.uid() as (select auth.uid()) in every RLS policy so it is evaluated
--      once per statement instead of once per row (security-rls-performance)
--   4) fix profiles_self_update / user_roles_self_select / team_view, which were never
--      updated when 'super_admin' was introduced and still only check has_role(...,'admin')
--   5) drop sales_delete_admin: superseded by delete_sales_por_papel, whose condition is a
--      strict superset, so the two permissive policies were being evaluated redundantly

-- ============ 1) Missing FK indexes ============
CREATE INDEX IF NOT EXISTS idx_team_members_lider ON public.team_members(lider_id);
CREATE INDEX IF NOT EXISTS idx_sales_coordenador ON public.sales(coordenador_id);
CREATE INDEX IF NOT EXISTS idx_sales_team_leader ON public.sales(team_leader_id);
CREATE INDEX IF NOT EXISTS idx_sale_bank_accounts_sale ON public.sale_bank_accounts(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_documents_uploaded_by ON public.sale_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_sale_comments_sale ON public.sale_comments(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_comments_autor ON public.sale_comments(autor_id);
CREATE INDEX IF NOT EXISTS idx_sale_comments_doc ON public.sale_comments(doc_id);
CREATE INDEX IF NOT EXISTS idx_status_history_autor ON public.sale_status_history(autor_id);
CREATE INDEX IF NOT EXISTS idx_occ_commissions_occurrence ON public.occurrence_commissions(occurrence_id);
CREATE INDEX IF NOT EXISTS idx_occ_partners_occurrence ON public.occurrence_partners(occurrence_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sale ON public.notifications(sale_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_sale ON public.activity_logs(sale_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_autor ON public.activity_logs(autor_id);

-- ============ 2) Redundant/duplicate indexes ============
-- occurrences.sale_id is already UNIQUE (implicit index); this duplicate scanned the same column.
DROP INDEX IF EXISTS public.idx_occurrences_sale;
-- idx_notifications_user_unread(user_id, lida, created_at desc) already covers every query
-- idx_notifications_user_lida(user_id, lida) could serve.
DROP INDEX IF EXISTS public.idx_notifications_user_lida;

-- ============ 3+4) RLS policies: wrap auth.uid(), fix super_admin gaps ============

-- profiles
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles FOR SELECT TO authenticated
USING (
  id = (select auth.uid())
  OR public.has_any_role((select auth.uid()), ARRAY['gestor','juridico','financeiro','admin','super_admin']::public.app_role[])
);

DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles FOR UPDATE TO authenticated
USING (id = (select auth.uid()) OR public.has_any_role((select auth.uid()), ARRAY['admin','super_admin']::public.app_role[]))
WITH CHECK (id = (select auth.uid()) OR public.has_any_role((select auth.uid()), ARRAY['admin','super_admin']::public.app_role[]));

DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles FOR INSERT TO authenticated
WITH CHECK (id = (select auth.uid()) OR public.has_any_role((select auth.uid()), ARRAY['admin','super_admin']::public.app_role[]));

-- user_roles
DROP POLICY IF EXISTS user_roles_self_select ON public.user_roles;
CREATE POLICY user_roles_self_select ON public.user_roles FOR SELECT TO authenticated
USING (user_id = (select auth.uid()) OR public.has_any_role((select auth.uid()), ARRAY['admin','super_admin']::public.app_role[]));

DROP POLICY IF EXISTS user_roles_admin_write ON public.user_roles;
CREATE POLICY user_roles_admin_write ON public.user_roles FOR ALL TO authenticated
USING (
  (select auth.uid()) <> user_id AND (
    public.has_role((select auth.uid()),'super_admin')
    OR (public.has_role((select auth.uid()),'admin') AND role NOT IN ('admin','super_admin'))
  )
)
WITH CHECK (
  (select auth.uid()) <> user_id AND (
    public.has_role((select auth.uid()),'super_admin')
    OR (public.has_role((select auth.uid()),'admin') AND role NOT IN ('admin','super_admin'))
  )
);

-- team_members
DROP POLICY IF EXISTS team_view ON public.team_members;
CREATE POLICY team_view ON public.team_members FOR SELECT TO authenticated
USING (
  membro_id = (select auth.uid())
  OR lider_id = (select auth.uid())
  OR public.has_any_role((select auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
);

DROP POLICY IF EXISTS team_admin_write ON public.team_members;
CREATE POLICY team_admin_write ON public.team_members FOR ALL TO authenticated
USING (public.has_any_role((select auth.uid()), ARRAY['admin','super_admin']::public.app_role[]))
WITH CHECK (public.has_any_role((select auth.uid()), ARRAY['admin','super_admin']::public.app_role[]));

-- sales
DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales FOR SELECT TO authenticated
USING (
  corretor_id = (select auth.uid())
  OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[])
  OR (public.has_role((select auth.uid()),'gestor') AND public.is_lead_of((select auth.uid()), corretor_id))
  OR (public.has_role((select auth.uid()),'juridico') AND (status)::text = ANY (ARRAY[
    'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
    'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
    'aguardando_assinatura','contrato_assinado',
    'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
  ]))
);

DROP POLICY IF EXISTS sales_insert_corretor ON public.sales;
CREATE POLICY sales_insert_corretor ON public.sales FOR INSERT TO authenticated
WITH CHECK (corretor_id = (select auth.uid()));

DROP POLICY IF EXISTS sales_update_owner_draft ON public.sales;
CREATE POLICY sales_update_owner_draft ON public.sales FOR UPDATE TO authenticated
USING (
  public.can_view_sale((select auth.uid()), id)
  AND (NOT public.is_sale_locked(id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
)
WITH CHECK (
  public.can_view_sale((select auth.uid()), id)
  AND (NOT public.is_sale_locked(id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

-- sales_delete_admin's condition (admin/super_admin) is a strict subset of delete_sales_por_papel's
-- (super_admin/admin/financeiro OR own OR gestor-of-lead); drop the now-redundant policy instead of
-- recreating it, so DELETE only evaluates one permissive policy.
DROP POLICY IF EXISTS sales_delete_admin ON public.sales;

DROP POLICY IF EXISTS "delete_sales_por_papel" ON public.sales;
CREATE POLICY "delete_sales_por_papel" ON public.sales FOR DELETE TO authenticated
USING (
  public.has_any_role((select auth.uid()), ARRAY['super_admin','admin','financeiro']::public.app_role[])
  OR corretor_id = (select auth.uid())
  OR (public.has_role((select auth.uid()),'gestor') AND public.is_lead_of((select auth.uid()), corretor_id))
);

-- sale_parties
DROP POLICY IF EXISTS sale_parties_rw ON public.sale_parties;
CREATE POLICY sale_parties_rw ON public.sale_parties FOR ALL TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id))
WITH CHECK (
  public.can_view_sale((select auth.uid()), sale_id)
  AND (NOT public.is_sale_locked(sale_id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

-- sale_payment
DROP POLICY IF EXISTS sale_payment_rw ON public.sale_payment;
CREATE POLICY sale_payment_rw ON public.sale_payment FOR ALL TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id))
WITH CHECK (
  public.can_view_sale((select auth.uid()), sale_id)
  AND (NOT public.is_sale_locked(sale_id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

-- sale_bank_accounts
DROP POLICY IF EXISTS sale_bank_rw ON public.sale_bank_accounts;
CREATE POLICY sale_bank_rw ON public.sale_bank_accounts FOR ALL TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id))
WITH CHECK (
  public.can_view_sale((select auth.uid()), sale_id)
  AND (NOT public.is_sale_locked(sale_id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

-- sale_documents
DROP POLICY IF EXISTS sale_docs_select ON public.sale_documents;
CREATE POLICY sale_docs_select ON public.sale_documents FOR SELECT TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id));

DROP POLICY IF EXISTS sale_docs_insert ON public.sale_documents;
CREATE POLICY sale_docs_insert ON public.sale_documents FOR INSERT TO authenticated
WITH CHECK (
  public.can_view_sale((select auth.uid()), sale_id)
  AND (NOT public.is_sale_locked(sale_id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

DROP POLICY IF EXISTS sale_docs_update ON public.sale_documents;
CREATE POLICY sale_docs_update ON public.sale_documents FOR UPDATE TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id))
WITH CHECK (
  public.can_view_sale((select auth.uid()), sale_id)
  AND (NOT public.is_sale_locked(sale_id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

DROP POLICY IF EXISTS sale_docs_delete ON public.sale_documents;
CREATE POLICY sale_docs_delete ON public.sale_documents FOR DELETE TO authenticated
USING (
  public.can_view_sale((select auth.uid()), sale_id)
  AND (NOT public.is_sale_locked(sale_id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

-- sale_comments
DROP POLICY IF EXISTS sale_comments_view ON public.sale_comments;
CREATE POLICY sale_comments_view ON public.sale_comments FOR SELECT TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id));

DROP POLICY IF EXISTS sale_comments_insert ON public.sale_comments;
CREATE POLICY sale_comments_insert ON public.sale_comments FOR INSERT TO authenticated
WITH CHECK (public.can_view_sale((select auth.uid()), sale_id) AND autor_id = (select auth.uid()));

-- sale_status_history
DROP POLICY IF EXISTS history_view ON public.sale_status_history;
CREATE POLICY history_view ON public.sale_status_history FOR SELECT TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id));

DROP POLICY IF EXISTS history_insert ON public.sale_status_history;
CREATE POLICY history_insert ON public.sale_status_history FOR INSERT TO authenticated
WITH CHECK (public.can_view_sale((select auth.uid()), sale_id));

-- occurrences
DROP POLICY IF EXISTS occ_view ON public.occurrences;
CREATE POLICY occ_view ON public.occurrences FOR SELECT TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id));

DROP POLICY IF EXISTS occ_write ON public.occurrences;
CREATE POLICY occ_write ON public.occurrences FOR ALL TO authenticated
USING (
  public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
  AND public.can_view_sale((select auth.uid()), sale_id)
)
WITH CHECK (
  public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
  AND public.can_view_sale((select auth.uid()), sale_id)
  AND (NOT public.is_sale_locked(sale_id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

-- occurrence_commissions
DROP POLICY IF EXISTS occ_comm_view ON public.occurrence_commissions;
CREATE POLICY occ_comm_view ON public.occurrence_commissions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.can_view_sale((select auth.uid()), o.sale_id)));

DROP POLICY IF EXISTS occ_comm_write ON public.occurrence_commissions;
CREATE POLICY occ_comm_write ON public.occurrence_commissions FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_commissions.occurrence_id
    AND public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_commissions.occurrence_id
    AND public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
    AND (NOT public.is_sale_locked(o.sale_id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
));

-- occurrence_partners
DROP POLICY IF EXISTS occ_part_view ON public.occurrence_partners;
CREATE POLICY occ_part_view ON public.occurrence_partners FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND public.can_view_sale((select auth.uid()), o.sale_id)));

DROP POLICY IF EXISTS occ_part_write ON public.occurrence_partners;
CREATE POLICY occ_part_write ON public.occurrence_partners FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_partners.occurrence_id
    AND public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_partners.occurrence_id
    AND public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
    AND (NOT public.is_sale_locked(o.sale_id) OR public.has_any_role((select auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
));

-- notifications
DROP POLICY IF EXISTS notif_self ON public.notifications;
CREATE POLICY notif_self ON public.notifications FOR SELECT TO authenticated
USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS notif_update_self ON public.notifications;
CREATE POLICY notif_update_self ON public.notifications FOR UPDATE TO authenticated
USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS notif_insert ON public.notifications;
CREATE POLICY notif_insert ON public.notifications FOR INSERT TO authenticated
WITH CHECK (
  user_id = (select auth.uid())
  OR public.has_any_role((select auth.uid()), ARRAY['admin','super_admin','financeiro','gestor','juridico']::public.app_role[])
);

-- activity_logs
DROP POLICY IF EXISTS log_view ON public.activity_logs;
CREATE POLICY log_view ON public.activity_logs FOR SELECT TO authenticated
USING (
  ((sale_id IS NULL) AND public.has_any_role((select auth.uid()), ARRAY['admin','super_admin']::public.app_role[]))
  OR ((sale_id IS NOT NULL) AND public.can_view_sale((select auth.uid()), sale_id))
);

DROP POLICY IF EXISTS log_insert ON public.activity_logs;
CREATE POLICY log_insert ON public.activity_logs FOR INSERT TO authenticated
WITH CHECK (autor_id = (select auth.uid()));

-- document_extractions
DROP POLICY IF EXISTS "view extractions if can view sale" ON public.document_extractions;
CREATE POLICY "view extractions if can view sale" ON public.document_extractions FOR SELECT TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id));

DROP POLICY IF EXISTS "insert extractions if can view sale" ON public.document_extractions;
CREATE POLICY "insert extractions if can view sale" ON public.document_extractions FOR INSERT TO authenticated
WITH CHECK (public.can_view_sale((select auth.uid()), sale_id));

DROP POLICY IF EXISTS "update extractions if can view sale" ON public.document_extractions;
CREATE POLICY "update extractions if can view sale" ON public.document_extractions FOR UPDATE TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id))
WITH CHECK (public.can_view_sale((select auth.uid()), sale_id));

DROP POLICY IF EXISTS "delete extractions if can view sale" ON public.document_extractions;
CREATE POLICY "delete extractions if can view sale" ON public.document_extractions FOR DELETE TO authenticated
USING (public.can_view_sale((select auth.uid()), sale_id));

-- storage.objects (bucket sale-documents)
DROP POLICY IF EXISTS docs_select ON storage.objects;
CREATE POLICY docs_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'sale-documents' AND EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name,'/',1) AND public.can_view_sale((select auth.uid()), s.id)
  )
);
DROP POLICY IF EXISTS docs_insert ON storage.objects;
CREATE POLICY docs_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'sale-documents' AND EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name,'/',1) AND public.can_view_sale((select auth.uid()), s.id)
  )
);
DROP POLICY IF EXISTS docs_update ON storage.objects;
CREATE POLICY docs_update ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'sale-documents' AND EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name,'/',1) AND public.can_view_sale((select auth.uid()), s.id)
  )
);
DROP POLICY IF EXISTS docs_delete ON storage.objects;
CREATE POLICY docs_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'sale-documents' AND EXISTS (
    SELECT 1 FROM public.sales s WHERE s.id::text = split_part(name,'/',1) AND public.can_view_sale((select auth.uid()), s.id)
  )
);
