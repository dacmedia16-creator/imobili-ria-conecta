-- Recuperado de supabase_migrations.schema_migrations (versão 20260720175640) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

create or replace function public.can_edit_sale_stage(_user uuid, _sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sales s
    where s.id = _sale_id
    and (
      public.has_any_role(_user, array['financeiro','admin','super_admin']::public.app_role[])
      or (s.corretor_id = _user and s.status::text = any(array['rascunho','devolvida_ajuste']))
      or (public.has_role(_user,'gestor') and s.status::text = any(array[
            'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
            'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor']))
      or (public.has_role(_user,'juridico') and s.status::text = any(array['aprovada_gestor','em_elaboracao_contrato']))
    )
  );
$$;
