create or replace function public.link_conta_max_identity_by_email(
  p_workos_user_id text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_count integer;
begin
  if nullif(trim(p_workos_user_id), '') is null
     or nullif(trim(p_email), '') is null then
    return null;
  end if;

  select count(*)
    into v_count
    from auth.users
   where lower(trim(email)) = lower(trim(p_email))
     and email_confirmed_at is not null;

  if v_count <> 1 then
    return null;
  end if;

  select id
    into v_user_id
    from auth.users
   where lower(trim(email)) = lower(trim(p_email))
     and email_confirmed_at is not null
   limit 1;

  insert into public.conta_max_identity_links (
    workos_user_id,
    adm_user_id,
    active
  )
  values (p_workos_user_id, v_user_id, true)
  on conflict (workos_user_id) do update
    set active = true,
        revoked_at = null
    where conta_max_identity_links.adm_user_id = excluded.adm_user_id;

  if not found then
    return null;
  end if;

  return v_user_id;
end;
$$;

revoke all on function public.link_conta_max_identity_by_email(text, text)
  from public, anon, authenticated;
grant execute on function public.link_conta_max_identity_by_email(text, text)
  to service_role;
