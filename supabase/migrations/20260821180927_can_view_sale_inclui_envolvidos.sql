-- Hoje só o dono da venda (corretor_id) enxerga, além de financeiro/admin/super_admin, do
-- gestor/team_leader que lidera esse dono, e do jurídico em status específicos. Captador e
-- vendedor vinculados a uma conta real (corretor_captador_id/corretor_vendedor_id) podem ser
-- pessoas diferentes de quem criou o registro -- de propósito, podem até ser de equipes
-- diferentes (ver 20260805120000) -- e ficavam sem acesso à própria venda. Estende
-- can_view_sale (gate central também de sale_parties, sale_payment, sale_bank_accounts,
-- sale_documents, sale_status_history, sale_commission_extras, occurrence_commissions etc.) e a
-- policy sales_select (que duplica essa lógica inline desde sempre, ver 20260630234432) pra
-- também liberar: captador/vendedor principais, o líder de cada lado, e o "extra" vinculado a
-- conta em sale_commission_extras.user_id. Só leitura -- can_edit_sale_stage não muda, então
-- isso não dá permissão de edição pra ninguém que não tinha antes.

CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_active_user(_user) AND EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND (
      s.corretor_id = _user
      OR s.corretor_captador_id = _user
      OR s.corretor_vendedor_id = _user
      OR s.lider_captador_id = _user
      OR s.lider_vendedor_id = _user
      OR EXISTS (SELECT 1 FROM public.sale_commission_extras sce WHERE sce.sale_id = s.id AND sce.user_id = _user)
      OR public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (public.has_any_role(_user, ARRAY['gestor','team_leader']::public.app_role[]) AND public.is_lead_of(_user, s.corretor_id))
      OR (public.has_role(_user,'juridico'::public.app_role) AND s.status::text = ANY (ARRAY[
        'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
        'aguardando_assinatura','contrato_assinado',
        'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
      ]))
    )
  )
$function$;

-- Essas colunas passam a entrar em toda checagem de RLS de venda (sales_select + can_view_sale),
-- ou seja, em toda leitura de venda e das tabelas relacionadas -- precisam de índice.
CREATE INDEX IF NOT EXISTS idx_sales_corretor_captador_id ON public.sales (corretor_captador_id);
CREATE INDEX IF NOT EXISTS idx_sales_corretor_vendedor_id ON public.sales (corretor_vendedor_id);
CREATE INDEX IF NOT EXISTS idx_sales_lider_captador_id ON public.sales (lider_captador_id);
CREATE INDEX IF NOT EXISTS idx_sales_lider_vendedor_id ON public.sales (lider_vendedor_id);
CREATE INDEX IF NOT EXISTS idx_sale_commission_extras_user_id ON public.sale_commission_extras (user_id);

DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales FOR SELECT TO authenticated
USING (
  is_active_user((SELECT auth.uid()))
  AND (
    (corretor_id = (SELECT auth.uid()))
    OR (corretor_captador_id = (SELECT auth.uid()))
    OR (corretor_vendedor_id = (SELECT auth.uid()))
    OR (lider_captador_id = (SELECT auth.uid()))
    OR (lider_vendedor_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.sale_commission_extras sce WHERE sce.sale_id = sales.id AND sce.user_id = (SELECT auth.uid()))
    OR has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin']::app_role[])
    OR (has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader']::app_role[]) AND is_lead_of((SELECT auth.uid()), corretor_id))
    OR (has_role((SELECT auth.uid()), 'juridico'::app_role) AND (status::text = ANY (ARRAY[
      'aprovada_gestor','enviada_juridico','em_elaboracao_contrato','contrato_conferencia_gestor',
      'contrato_conferencia_corretor','contrato_ok_corretor','aguardando_assinatura','contrato_assinado',
      'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
    ])))
  )
);
