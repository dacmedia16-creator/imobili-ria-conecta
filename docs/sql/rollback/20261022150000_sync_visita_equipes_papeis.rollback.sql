-- Rollback de 20261022150000_sync_visita_equipes_papeis.sql (t_cbc7cc69).
-- ANTES: desligar as chaves (update sync_org_map set visita_tl_lider=false, visita_equipes=false) e deixar o robô
-- rodar uma vez, para o Visita devolver o papel antigo aos TLs e tirar a trava das equipes. Depois, rodar isto.
-- Não apaga nada do Visita; equipes do ADM ficam lá como estão (o rollback do Visita restaura as manuais).
BEGIN;

drop trigger if exists trg_sync_org_map_chaves on public.sync_org_map;
drop function if exists public.sync_org_map_chaves_trg();
drop function if exists public.sync_equipes_da_org(uuid);
drop trigger if exists trg_zz_sync_team_co_leaders on public.team_co_leaders;

-- Gatilho e função de volta à versão de 20261011120000.
create or replace function public.sync_enfileirar_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  m text := tg_table_name || ':' || lower(tg_op);
  u uuid;
begin
  begin
    if tg_table_name = 'profiles' then
      if tg_op = 'UPDATE' and (r->>'nome', r->>'email', r->>'telefone', r->>'ativo', r->>'organization_id')
         is not distinct from (o->>'nome', o->>'email', o->>'telefone', o->>'ativo', o->>'organization_id') then
        return null;
      end if;
      perform public.sync_enfileirar((r->>'id')::uuid, m);
    elsif tg_table_name = 'team_members' then
      perform public.sync_enfileirar((r->>'membro_id')::uuid, m);
      if tg_op = 'UPDATE' and (o->>'membro_id') is distinct from (r->>'membro_id') then
        perform public.sync_enfileirar((o->>'membro_id')::uuid, m);
      end if;
    elsif tg_table_name = 'teams' then
      for u in select tm.membro_id from public.team_members tm where tm.team_id = (r->>'id')::uuid loop
        perform public.sync_enfileirar(u, m);
      end loop;
    else -- user_roles, organization_members
      perform public.sync_enfileirar((r->>'user_id')::uuid, m);
      if tg_op = 'UPDATE' and (o->>'user_id') is distinct from (r->>'user_id') then
        perform public.sync_enfileirar((o->>'user_id')::uuid, m);
      end if;
    end if;
  exception when others then
    raise warning 'sync_enfileirar_trg falhou (%): %', m, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.sync_enfileirar_trg() from public, anon, authenticated;

drop trigger if exists trg_zz_sync_teams on public.teams;
create trigger trg_zz_sync_teams after update of lider_id on public.teams
  for each row execute function public.sync_enfileirar_trg();

alter table public.sync_org_map
  drop column if exists visita_equipes_desligar_pendente,
  drop column if exists visita_tl_lider,
  drop column if exists visita_equipes;

COMMIT;
