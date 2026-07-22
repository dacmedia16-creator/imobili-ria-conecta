-- can_edit_sale_stage() esquecia 'contrato_conferencia_corretor' na lista de status em que o
-- corretor pode editar a venda, mesmo esse sendo exatamente o passo em que ele confere o
-- contrato e clica "Dar OK no contrato" / "Devolver ao gestor" — validate_sale_status_transition
-- já permitia essa transição pro dono da venda, mas o WITH CHECK de sales_update_owner_draft
-- (que chama can_edit_sale_stage) bloqueava antes mesmo do trigger rodar, com o erro genérico
-- "new row violates row-level security policy for table sales".
CREATE OR REPLACE FUNCTION public.can_edit_sale_stage(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.sales s
    where s.id = _sale_id
    and (
      public.has_any_role(_user, array['financeiro','admin','super_admin']::public.app_role[])
      or (s.corretor_id = _user and s.status::text = any(array['rascunho','devolvida_ajuste','contrato_conferencia_corretor']))
      or (public.has_role(_user,'gestor') and s.status::text = any(array[
            'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
            'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor']))
      or (public.has_role(_user,'juridico') and s.status::text = any(array['aprovada_gestor','em_elaboracao_contrato']))
    )
  );
$function$;
