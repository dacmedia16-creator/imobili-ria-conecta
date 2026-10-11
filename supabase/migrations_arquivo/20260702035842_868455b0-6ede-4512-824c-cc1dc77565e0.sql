
-- 1) Novas colunas na ocorrência
ALTER TABLE public.occurrences
  ADD COLUMN IF NOT EXISTS aceita_financeiro boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS aceita_financeiro_em timestamptz,
  ADD COLUMN IF NOT EXISTS aceita_financeiro_por uuid REFERENCES auth.users(id);

-- 2) Função de trava
CREATE OR REPLACE FUNCTION public.is_sale_locked(_sale_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.occurrences o
    WHERE o.sale_id = _sale_id AND o.aceita_financeiro = true
  ) OR EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND s.status::text = 'ocorrencia_concluida'
  );
$$;

-- 3) can_view_sale: remover coordenador, adicionar super_admin
CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND (
      s.corretor_id = _user
      OR public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (public.has_role(_user,'gestor') AND public.is_lead_of(_user, s.corretor_id))
      OR (public.has_role(_user,'juridico') AND s.status::text = ANY (ARRAY['aprovada_gestor','enviada_juridico','em_elaboracao_contrato','aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_concluida']))
    )
  )
$$;

-- 4) activity_logs view: admin e super_admin veem logs globais
DROP POLICY IF EXISTS log_view ON public.activity_logs;
CREATE POLICY log_view ON public.activity_logs FOR SELECT
USING (
  ((sale_id IS NULL) AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]))
  OR ((sale_id IS NOT NULL) AND public.can_view_sale(auth.uid(), sale_id))
);

-- 5) notifications insert: remover coordenador, adicionar super_admin
DROP POLICY IF EXISTS notif_insert ON public.notifications;
CREATE POLICY notif_insert ON public.notifications FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','financeiro','gestor','juridico']::public.app_role[])
);

-- 6) profiles view: gestor/juridico/financeiro/admin/super_admin
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles FOR SELECT
USING (
  id = auth.uid()
  OR public.has_any_role(auth.uid(), ARRAY['gestor','juridico','financeiro','admin','super_admin']::public.app_role[])
);

DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles FOR INSERT
WITH CHECK (
  id = auth.uid()
  OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[])
);

-- 7) sales: adicionar super_admin, aplicar trava no UPDATE
DROP POLICY IF EXISTS sales_delete_admin ON public.sales;
CREATE POLICY sales_delete_admin ON public.sales FOR DELETE
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]));

DROP POLICY IF EXISTS sales_update_owner_draft ON public.sales;
CREATE POLICY sales_update_owner_draft ON public.sales FOR UPDATE
USING (
  public.can_view_sale(auth.uid(), id)
  AND (
    NOT public.is_sale_locked(id)
    OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[])
  )
)
WITH CHECK (
  public.can_view_sale(auth.uid(), id)
  AND (
    NOT public.is_sale_locked(id)
    OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[])
  )
);

-- 8) sale_parties, sale_payment, sale_bank_accounts, sale_documents: trava
DROP POLICY IF EXISTS sale_parties_rw ON public.sale_parties;
CREATE POLICY sale_parties_rw ON public.sale_parties FOR ALL
USING (public.can_view_sale(auth.uid(), sale_id))
WITH CHECK (
  public.can_view_sale(auth.uid(), sale_id)
  AND (NOT public.is_sale_locked(sale_id)
       OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

DROP POLICY IF EXISTS sale_payment_rw ON public.sale_payment;
CREATE POLICY sale_payment_rw ON public.sale_payment FOR ALL
USING (public.can_view_sale(auth.uid(), sale_id))
WITH CHECK (
  public.can_view_sale(auth.uid(), sale_id)
  AND (NOT public.is_sale_locked(sale_id)
       OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

DROP POLICY IF EXISTS sale_bank_rw ON public.sale_bank_accounts;
CREATE POLICY sale_bank_rw ON public.sale_bank_accounts FOR ALL
USING (public.can_view_sale(auth.uid(), sale_id))
WITH CHECK (
  public.can_view_sale(auth.uid(), sale_id)
  AND (NOT public.is_sale_locked(sale_id)
       OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

DROP POLICY IF EXISTS sale_docs_insert ON public.sale_documents;
CREATE POLICY sale_docs_insert ON public.sale_documents FOR INSERT
WITH CHECK (
  public.can_view_sale(auth.uid(), sale_id)
  AND (NOT public.is_sale_locked(sale_id)
       OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

DROP POLICY IF EXISTS sale_docs_update ON public.sale_documents;
CREATE POLICY sale_docs_update ON public.sale_documents FOR UPDATE
USING (public.can_view_sale(auth.uid(), sale_id))
WITH CHECK (
  public.can_view_sale(auth.uid(), sale_id)
  AND (NOT public.is_sale_locked(sale_id)
       OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

DROP POLICY IF EXISTS sale_docs_delete ON public.sale_documents;
CREATE POLICY sale_docs_delete ON public.sale_documents FOR DELETE
USING (
  public.can_view_sale(auth.uid(), sale_id)
  AND (NOT public.is_sale_locked(sale_id)
       OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

-- 9) occurrences: swap coordenador->gestor + super_admin (financeiro/admin/super_admin sempre podem)
DROP POLICY IF EXISTS occ_write ON public.occurrences;
CREATE POLICY occ_write ON public.occurrences FOR ALL
USING (
  public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
  AND public.can_view_sale(auth.uid(), sale_id)
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
  AND public.can_view_sale(auth.uid(), sale_id)
  AND (NOT public.is_sale_locked(sale_id)
       OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

DROP POLICY IF EXISTS occ_comm_write ON public.occurrence_commissions;
CREATE POLICY occ_comm_write ON public.occurrence_commissions FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_commissions.occurrence_id
    AND public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_commissions.occurrence_id
    AND public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
    AND (NOT public.is_sale_locked(o.sale_id)
         OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
));

DROP POLICY IF EXISTS occ_part_write ON public.occurrence_partners;
CREATE POLICY occ_part_write ON public.occurrence_partners FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_partners.occurrence_id
    AND public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_partners.occurrence_id
    AND public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin','gestor']::public.app_role[])
    AND (NOT public.is_sale_locked(o.sale_id)
         OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
));

-- 10) team_members: admin OU super_admin gerencia
DROP POLICY IF EXISTS team_admin_write ON public.team_members;
CREATE POLICY team_admin_write ON public.team_members FOR ALL
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]));

-- 11) user_roles: admin gerencia papéis comuns; só super_admin concede admin/super_admin; ninguém edita o próprio
DROP POLICY IF EXISTS user_roles_admin_write ON public.user_roles;
CREATE POLICY user_roles_admin_write ON public.user_roles FOR ALL
USING (
  auth.uid() <> user_id AND (
    public.has_role(auth.uid(),'super_admin')
    OR (public.has_role(auth.uid(),'admin') AND role NOT IN ('admin','super_admin'))
  )
)
WITH CHECK (
  auth.uid() <> user_id AND (
    public.has_role(auth.uid(),'super_admin')
    OR (public.has_role(auth.uid(),'admin') AND role NOT IN ('admin','super_admin'))
  )
);

-- 12) Promover dacmedia16@gmail.com a super_admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'super_admin'::public.app_role FROM auth.users WHERE email='dacmedia16@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;
