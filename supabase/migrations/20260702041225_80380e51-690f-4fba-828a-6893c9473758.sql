
ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'contrato_conferencia_gestor';
ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'contrato_conferencia_corretor';
ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'contrato_ok_corretor';
ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'ocorrencia_analise_financeiro';
ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS 'ocorrencia_devolvida_gestor';

CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
