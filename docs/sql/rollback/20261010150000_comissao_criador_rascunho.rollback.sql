-- rollback 20261010150000_comissao_criador_rascunho
CREATE OR REPLACE FUNCTION public.can_edit_sale_comissao(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  select
    public.is_active_user(_user) and (
      public.has_any_role(_user, array['financeiro','admin','super_admin']::public.app_role[])
      or (
        public.has_any_role(_user, array['gestor','team_leader']::public.app_role[])
        and not public.is_sale_locked(_sale_id)
        and exists (
          select 1 from public.sales s
          where s.id = _sale_id
          and (
            s.status::text = any(array[
              'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
              'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor'
            ])
            or (s.status::text = 'rascunho' and public.is_lead_of_sale_responsavel(_user, s.id))
          )
        )
      )
      or (
        public.has_role(_user, 'lancamento'::public.app_role)
        and exists (
          select 1 from public.sales s
          where s.id = _sale_id
          and s.corretor_id = _user
          and s.modalidade = 'lancamento'
          and s.status::text = any(array['rascunho','devolvida_ajuste'])
        )
      )
      or (
        not public.is_sale_locked(_sale_id)
        and exists (
          select 1 from public.sales s
          where s.id = _sale_id
          and public.is_sale_responsavel(_user, s.id)
          and s.status::text = any(array['rascunho','devolvida_ajuste'])
        )
      )
    )

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_user) AND EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$;
