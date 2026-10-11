-- Cadastro de corretores por gestor (própria imobiliária) e team leader (própria equipe).
-- Decisão de Denis, 11/10/2026 (tópico 6238, opção 3; cartão t_d8d3ada2).
--
-- O cadastro acontece no servidor do ADM (server fn createUser → createAgencyUser), que usa a
-- service_role e por isso não passa pela RLS. Esta função leva a regra para o banco: o servidor a
-- chama ANTES de criar o login, e ela decide (ou recusa) a equipe de destino. Nenhuma policy foi
-- afrouxada: gestor/team leader continuam sem gravar profiles/user_roles de terceiros pelo cliente.
--
-- Regra:
--   super_admin / admin  → como antes (admin não cria admin/super_admin); devolve NULL (sem equipe);
--   gestor               → só 'corretor'; devolve a equipe que ele lidera como titular
--                          (nível 1 primeiro) ou NULL (o servidor cria "Equipe de <nome>", legado);
--   team_leader          → só 'corretor'; devolve a equipe que ele lidera como titular
--                          (teams.lider_id = ele, nível 1 primeiro); sem equipe → recusa;
--   demais papéis        → recusa.
-- Ator precisa estar ativo e com vínculo ativo na imobiliária informada (outra imobiliária → recusa).
-- Rollback: supabase/rollback/20261011140000_cadastro_gestor_team_leader.sql

create or replace function public.cadastro_equipe_destino(
  _actor uuid,
  _org uuid,
  _role public.app_role
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _roles public.app_role[];
  _team uuid;
begin
  if _actor is null or _org is null or _role is null then
    raise exception using errcode = '42501', message = 'cadastro_sem_agencia';
  end if;

  if not exists (
    select 1
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = _actor and m.organization_id = _org and m.ativo and o.status = 'ativa'
  ) or not exists (
    select 1 from public.profiles p
    where p.id = _actor and p.organization_id = _org and p.ativo is true
  ) then
    raise exception using errcode = '42501', message = 'cadastro_sem_agencia';
  end if;

  select coalesce(array_agg(ur.role), '{}') into _roles
  from public.user_roles ur
  where ur.user_id = _actor and ur.organization_id = _org;

  if 'super_admin' = any(_roles) then
    return null;
  end if;

  if 'admin' = any(_roles) then
    if _role in ('admin', 'super_admin') then
      raise exception using errcode = '42501', message = 'cadastro_admin_nao_cria_admin';
    end if;
    return null;
  end if;

  if not (_roles && array['gestor', 'team_leader']::public.app_role[]) then
    raise exception using errcode = '42501', message = 'cadastro_sem_permissao';
  end if;

  if _role <> 'corretor' then
    raise exception using errcode = '42501', message = 'cadastro_lider_so_corretor';
  end if;

  select t.id into _team
  from public.teams t
  where t.organization_id = _org and t.lider_id = _actor
  order by (t.parent_team_id is not null), t.created_at, t.id
  limit 1;

  if _team is null and not ('gestor' = any(_roles)) then
    raise exception using errcode = '42501', message = 'cadastro_lider_sem_equipe';
  end if;

  return _team;
end
$$;

revoke all on function public.cadastro_equipe_destino(uuid, uuid, public.app_role)
  from public, anon, authenticated;
grant execute on function public.cadastro_equipe_destino(uuid, uuid, public.app_role)
  to service_role;

comment on function public.cadastro_equipe_destino(uuid, uuid, public.app_role) is
  'Cadastro de usuário no ADM: valida papel do ator × papel pedido × imobiliária e devolve a equipe de destino (gestor/team leader). Só service_role. Decisão Denis 11/10/2026 (t_d8d3ada2).';
