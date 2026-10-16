-- Rollback da migration 20261016180000_sessenta_participa.sql (t_2ea96382).
-- Rodar só DEPOIS de reverter o robô sync-satelites (a versão nova lê participa_sessenta).
-- Atenção: apagar a coluna perde as marcações feitas pelos gestores. Antes, se quiser guardar:
--   create table public._bkp_participa_sessenta as
--     select user_id, organization_id from public.organization_members where participa_sessenta;
BEGIN;
drop function if exists public.sync_estado_desejado(uuid[], uuid);
create function public.sync_estado_desejado(p_user_ids uuid[] default null, p_org uuid default null)
returns table (adm_user_id uuid, org_id uuid, email text, nome text, telefone text, ativo boolean, roles text[], lider_email text)
language sql stable security definer set search_path = '' as $$
  select p.id,
         coalesce(om.organization_id, p.organization_id),
         lower(trim(coalesce(nullif(trim(p.email), ''), u.email::text))),
         p.nome,
         p.telefone,
         (p.ativo and coalesce(om.ativo, false)),
         coalesce((select array_agg(ur.role::text order by ur.role::text) from public.user_roles ur where ur.user_id = p.id), '{}'),
         (select lower(trim(coalesce(nullif(trim(lp.email), ''), lu.email::text)))
            from public.team_members tm
            join public.teams t on t.id = tm.team_id
            join public.profiles lp on lp.id = t.lider_id
            left join auth.users lu on lu.id = lp.id
           where tm.membro_id = p.id and t.lider_id <> p.id
           limit 1)
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.organization_members om on om.user_id = p.id
   where (p_user_ids is null or p.id = any (p_user_ids))
     and (p_org is null or coalesce(om.organization_id, p.organization_id) = p_org)
$$;
revoke all on function public.sync_estado_desejado(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.sync_estado_desejado(uuid[], uuid) to service_role;
alter table public.organization_members drop column if exists participa_sessenta;
COMMIT;
