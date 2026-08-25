-- Sessão operacional: o Super Admin troca para uma sessão Auth real do usuário alvo.
-- A identidade efetiva passa a ser a do alvo, então todas as RLS e funções existentes aplicam
-- exatamente as permissões dele. O session_id do JWT liga alterações à auditoria abaixo.

begin;

create table if not exists public.operational_impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id),
  target_user_id uuid not null references auth.users(id),
  auth_session_id uuid,
  status text not null default 'pending' check (status in ('pending', 'active', 'ended', 'failed')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create unique index if not exists operational_impersonation_active_session_idx
  on public.operational_impersonation_sessions(auth_session_id)
  where auth_session_id is not null and status = 'active';

alter table public.operational_impersonation_sessions enable row level security;
revoke all on table public.operational_impersonation_sessions from anon, authenticated;

create table if not exists public.operational_impersonation_actions (
  id bigint generated always as identity primary key,
  impersonation_session_id uuid not null references public.operational_impersonation_sessions(id),
  actor_user_id uuid not null references auth.users(id),
  target_user_id uuid not null references auth.users(id),
  table_name text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  record_id text,
  created_at timestamptz not null default now()
);

alter table public.operational_impersonation_actions enable row level security;
revoke all on table public.operational_impersonation_actions from anon, authenticated;

create or replace function public.audit_operational_impersonation_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operational_impersonation_sessions%rowtype;
  v_row jsonb;
begin
  select * into v_session
  from public.operational_impersonation_sessions
  where auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
    and target_user_id = auth.uid()
    and status = 'active';

  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.operational_impersonation_actions
    (impersonation_session_id, actor_user_id, target_user_id, table_name, operation, record_id)
  values
    (v_session.id, v_session.actor_user_id, v_session.target_user_id, tg_table_name, tg_op,
     coalesce(v_row ->> 'id', v_row ->> 'sale_id', v_row ->> 'user_id'));
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'clientes','metas','profiles','user_roles','teams','team_members','team_co_leaders',
    'sales','sale_parties','sale_payment','sale_bank_accounts','sale_comments',
    'sale_commission_extras','sale_documents','sale_status_history','occurrences',
    'occurrence_commissions','occurrence_partners','corretor_positioning_regions',
    'positioning_region_suggestions'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists audit_operational_impersonation on public.%I', v_table);
      execute format('create trigger audit_operational_impersonation after insert or update or delete on public.%I for each row execute function public.audit_operational_impersonation_action()', v_table);
    end if;
  end loop;
end $$;

commit;
