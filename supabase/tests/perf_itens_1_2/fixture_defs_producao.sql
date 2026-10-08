-- definições de PRODUÇÃO (lidas somente leitura) aplicadas dentro da transação da POC
CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  SELECT public.is_active_user(_user) AND EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND s.organization_id = (SELECT public.user_org(_user)) AND (
      s.corretor_id = _user
      OR s.corretor_captador_id = _user
      OR s.corretor_vendedor_id = _user
      OR s.lider_captador_id = _user
      OR s.lider_vendedor_id = _user
      OR EXISTS (SELECT 1 FROM public.sale_commission_extras sce WHERE sce.sale_id = s.id AND sce.user_id = _user)
      OR public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (public.has_any_role(_user, ARRAY['gestor','team_leader']::public.app_role[])
          AND (public.is_lead_of(_user, s.corretor_id) OR public.is_lead_of_sale_corretor(_user, s.id)))
      OR (public.has_role(_user,'juridico'::public.app_role) AND s.status::text = ANY (ARRAY[
        'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
        'aguardando_assinatura','contrato_assinado',
        'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
      ]))
    )
  )

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_user) AND EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$;

CREATE OR REPLACE FUNCTION public.is_lead_of_sale_corretor(_lider uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _lider IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sale_corretores(_sale_id) c WHERE public.is_lead_of(_lider, c)
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_sale_corretor(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user IS NOT NULL AND EXISTS (SELECT 1 FROM public.sale_corretores(_sale_id) c WHERE c = _user)
$function$;

CREATE OR REPLACE FUNCTION public.is_sale_responsavel(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user IS NOT NULL AND EXISTS (SELECT 1 FROM public.sale_responsaveis(_sale_id) c WHERE c = _user)
$function$;

