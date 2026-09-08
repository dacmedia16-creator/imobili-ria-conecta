-- Leitura da venda do líder principal pela auxiliar da MESMA equipe.
-- Não ampliar can_view_sale/is_lead_of: também autorizam escrita e transições.
BEGIN;

CREATE FUNCTION public.can_read_principal_sale_as_co_leader(_sale_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sales s
    JOIN public.teams t ON t.lider_id = s.corretor_id
    JOIN public.team_co_leaders cl ON cl.team_id = t.id
    JOIN public.profiles p ON p.id = cl.user_id AND p.ativo IS TRUE
    WHERE s.id = _sale_id
      AND cl.user_id = (SELECT auth.uid())
      AND public.has_any_role(cl.user_id, ARRAY['gestor','team_leader']::public.app_role[])
  );
$$;
-- Identidade sempre vinculada ao JWT corrente; não recebe UUID de outro usuário.
REVOKE ALL ON FUNCTION public.can_read_principal_sale_as_co_leader(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_principal_sale_as_co_leader(uuid) TO authenticated;

-- As policies antigas e seus filtros permanecem. Apenas este ramo SELECT é novo.
CREATE POLICY sales_co_leader_principal_read ON public.sales
FOR SELECT TO authenticated
USING (public.can_read_principal_sale_as_co_leader(id));

CREATE POLICY occurrences_co_leader_principal_read ON public.occurrences
FOR SELECT TO authenticated
USING (public.can_read_principal_sale_as_co_leader(sale_id));

CREATE POLICY occurrence_commissions_co_leader_principal_read ON public.occurrence_commissions
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_id AND public.can_read_principal_sale_as_co_leader(o.sale_id)
));

CREATE POLICY occurrence_partners_co_leader_principal_read ON public.occurrence_partners
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_id AND public.can_read_principal_sale_as_co_leader(o.sale_id)
));

-- Projeções já lidas pelo detalhe/ocorrência e pelo cálculo exibido na tela.
CREATE POLICY sale_parties_co_leader_principal_read ON public.sale_parties
FOR SELECT TO authenticated
USING (public.can_read_principal_sale_as_co_leader(sale_id));
CREATE POLICY sale_payment_co_leader_principal_read ON public.sale_payment
FOR SELECT TO authenticated
USING (public.can_read_principal_sale_as_co_leader(sale_id));
CREATE POLICY sale_commission_extras_co_leader_principal_read ON public.sale_commission_extras
FOR SELECT TO authenticated
USING (public.can_read_principal_sale_as_co_leader(sale_id));

-- Antes, o SELECT de occurrences impunha can_view_sale implicitamente ao EXISTS.
-- Tornar essa barreira explícita impede que a nova leitura libere escrita indireta.
ALTER POLICY occ_comm_write ON public.occurrence_commissions
USING (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_id
    AND public.can_view_sale((SELECT auth.uid()), o.sale_id)
    AND public.has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin','gestor','team_leader']::public.app_role[])
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_id
    AND public.can_view_sale((SELECT auth.uid()), o.sale_id)
    AND public.has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin','gestor','team_leader']::public.app_role[])
    AND (NOT public.is_sale_locked(o.sale_id) OR public.has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
));
ALTER POLICY occ_part_write ON public.occurrence_partners
USING (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_id
    AND public.can_view_sale((SELECT auth.uid()), o.sale_id)
    AND public.has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin','gestor','team_leader']::public.app_role[])
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.occurrences o
  WHERE o.id = occurrence_id
    AND public.can_view_sale((SELECT auth.uid()), o.sale_id)
    AND public.has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin','gestor','team_leader']::public.app_role[])
    AND (NOT public.is_sale_locked(o.sale_id) OR public.has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
));

-- UPDATE/DELETE filtrados dependiam também do SELECT antigo dos extras.
-- INSERT e a regra de cálculo/edição de comissão não são ampliados nem reescritos.
ALTER POLICY sale_commission_extras_update ON public.sale_commission_extras
USING (public.can_view_sale((SELECT auth.uid()), sale_id) AND public.can_edit_sale_comissao((SELECT auth.uid()), sale_id));
ALTER POLICY sale_commission_extras_delete ON public.sale_commission_extras
USING (public.can_view_sale((SELECT auth.uid()), sale_id) AND public.can_edit_sale_comissao((SELECT auth.uid()), sale_id));

-- Upload/alteração/exclusão de arquivo dependiam do SELECT antigo de sales.
-- Preservar essa dependência sem conceder nova leitura de documentos ou contas.
ALTER POLICY docs_insert ON storage.objects
WITH CHECK (bucket_id = 'sale-documents' AND EXISTS (
  SELECT 1 FROM public.sales s
  WHERE s.id::text = split_part(objects.name, '/', 1)
    AND public.can_view_sale((SELECT auth.uid()), s.id)
    AND public.can_edit_sale_stage((SELECT auth.uid()), s.id)
));
ALTER POLICY docs_update ON storage.objects
USING (bucket_id = 'sale-documents' AND EXISTS (
  SELECT 1 FROM public.sales s
  WHERE s.id::text = split_part(objects.name, '/', 1)
    AND public.can_view_sale((SELECT auth.uid()), s.id)
    AND public.can_edit_sale_stage((SELECT auth.uid()), s.id)
));
ALTER POLICY docs_delete ON storage.objects
USING (bucket_id = 'sale-documents' AND EXISTS (
  SELECT 1 FROM public.sales s
  WHERE s.id::text = split_part(objects.name, '/', 1)
    AND public.can_view_sale((SELECT auth.uid()), s.id)
    AND public.can_edit_sale_stage((SELECT auth.uid()), s.id)
));

COMMIT;
