-- Gestor e Team Leader podem editar o rascunho de venda cujo dono pertence à sua hierarquia.
-- A regra permanece restrita à própria equipe e a usuários ativos.

begin;

create or replace function public.can_edit_sale_stage(_user uuid, _sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_user(_user) and exists (
    select 1 from public.sales s
    where s.id = _sale_id
    and (
      public.has_any_role(_user, array['financeiro','admin','super_admin']::public.app_role[])
      or (s.corretor_id = _user and s.status::text = any(array['rascunho','devolvida_ajuste','contrato_conferencia_corretor']))
      or (
        public.has_any_role(_user, array['gestor','team_leader']::public.app_role[])
        and public.is_lead_of(_user, s.corretor_id)
        and s.status::text = 'rascunho'
      )
      or (public.has_any_role(_user, array['gestor','team_leader']::public.app_role[]) and s.status::text = any(array[
            'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
            'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor']))
      or (public.has_role(_user,'juridico') and s.status::text = any(array['aprovada_gestor','em_elaboracao_contrato']))
    )
  )
$$;

create or replace function public.can_edit_sale_comissao(_user uuid, _sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
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
            or (s.status::text = 'rascunho' and public.is_lead_of(_user, s.corretor_id))
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
          and s.corretor_id = _user
          and s.status::text = any(array['rascunho','devolvida_ajuste'])
        )
      )
    )
$$;

commit;
