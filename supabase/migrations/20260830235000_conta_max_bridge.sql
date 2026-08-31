create table if not exists public.conta_max_identity_links (
  id uuid primary key default gen_random_uuid(),
  workos_user_id text not null unique,
  adm_user_id uuid not null unique references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.conta_max_ticket_uses (
  jti text primary key,
  expires_at timestamptz not null,
  used_at timestamptz not null default now()
);

alter table public.conta_max_identity_links enable row level security;
alter table public.conta_max_ticket_uses enable row level security;
revoke all on public.conta_max_identity_links from anon, authenticated;
revoke all on public.conta_max_ticket_uses from anon, authenticated;

create index if not exists conta_max_ticket_uses_expiry_idx on public.conta_max_ticket_uses (expires_at);

create or replace function public.link_conta_max_identity_by_email(p_workos_user_id text, p_email text)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_user_id uuid; v_count integer;
begin
  if nullif(trim(p_workos_user_id), '') is null or nullif(trim(p_email), '') is null then return null; end if;
  select count(*), min(id) into v_count, v_user_id from auth.users
    where lower(trim(email)) = lower(trim(p_email)) and email_confirmed_at is not null;
  if v_count <> 1 then return null; end if;
  insert into public.conta_max_identity_links (workos_user_id, adm_user_id, active)
  values (p_workos_user_id, v_user_id, true)
  on conflict (workos_user_id) do update set active = true, revoked_at = null
    where conta_max_identity_links.adm_user_id = excluded.adm_user_id;
  if not found then return null; end if;
  return v_user_id;
end; $$;

revoke all on function public.link_conta_max_identity_by_email(text, text) from public, anon, authenticated;
grant execute on function public.link_conta_max_identity_by_email(text, text) to service_role;
