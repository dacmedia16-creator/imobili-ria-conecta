
DROP POLICY IF EXISTS sales_select ON public.sales;
DROP POLICY IF EXISTS sales_update_owner_draft ON public.sales;
DROP POLICY IF EXISTS sales_delete_admin ON public.sales;

CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND (
      s.corretor_id = _user
      OR public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (public.has_role(_user,'gestor') AND public.is_lead_of(_user, s.corretor_id))
      OR (public.has_role(_user,'juridico') AND s.status::text = ANY (ARRAY[
        'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
        'aguardando_assinatura','contrato_assinado',
        'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
      ]))
    )
  )
$$;

CREATE POLICY sales_select ON public.sales
FOR SELECT TO authenticated
USING (
  corretor_id = auth.uid()
  OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[])
  OR (public.has_role(auth.uid(),'gestor') AND public.is_lead_of(auth.uid(), corretor_id))
  OR (public.has_role(auth.uid(),'juridico') AND (status)::text = ANY (ARRAY[
    'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
    'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
    'aguardando_assinatura','contrato_assinado',
    'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
  ]))
);

CREATE POLICY sales_update_owner_draft ON public.sales
FOR UPDATE
USING (
  public.can_view_sale(auth.uid(), id)
  AND (NOT public.is_sale_locked(id) OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
)
WITH CHECK (
  public.can_view_sale(auth.uid(), id)
  AND (NOT public.is_sale_locked(id) OR public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]))
);

CREATE POLICY sales_delete_admin ON public.sales
FOR DELETE
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]));
