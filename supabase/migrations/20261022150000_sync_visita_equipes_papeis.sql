-- t_cbc7cc69 (decisões de Denis, 22/10/2026): equipes do ADM no Visita Prova + TL do ADM vira "corretor líder"
-- no Visita. Aditiva e DESLIGADA por padrão: nenhuma imobiliária muda até alguém ligar as chaves dela.
--   etapa 1  sync_org_map.visita_equipes  = true -> o robô manda as equipes (nome, cor, pai, líder, co-líderes,
--            membros) da org para o Visita; lá as equipes feitas à mão são arquivadas (nunca apagadas) e travadas.
--   etapa 2  sync_org_map.visita_tl_lider = true -> quem é só team_leader (sem admin/gestor/coordenador) vai ao
--            Visita como "corretor" (vê só a própria equipe, como líder). Só vale com a etapa 1 ligada.
-- Gestor+TL continua imobiliaria_admin (decisão 1). Rollback: docs/sql/rollback/20261022150000_sync_visita_equipes_papeis.rollback.sql

alter table public.sync_org_map
  add column if not exists visita_equipes boolean not null default false,
  add column if not exists visita_tl_lider boolean not null default false,
  add column if not exists visita_equipes_desligar_pendente boolean not null default false,
  -- quando o Visita confirmou as equipes (etapa 1 aplicada); a etapa 2 só rebaixa o TL depois disso
  add column if not exists visita_equipes_ok_em timestamptz;

-- Gatilho genérico: times também avisam o líder (equipe sem membros mudou de nome/cor/pai) e o líder antigo.
-- team_co_leaders cai no ramo "else" (user_id), como user_roles. Só anota; nunca faz o cadastro falhar.
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
      perform public.sync_enfileirar((r->>'lider_id')::uuid, m);
      if tg_op = 'UPDATE' and (o->>'lider_id') is distinct from (r->>'lider_id') then
        perform public.sync_enfileirar((o->>'lider_id')::uuid, m);
      end if;
    else -- user_roles, organization_members, team_co_leaders
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
create trigger trg_zz_sync_teams after insert or delete or update of lider_id, nome, cor, parent_team_id
  on public.teams for each row execute function public.sync_enfileirar_trg();
drop trigger if exists trg_zz_sync_team_co_leaders on public.team_co_leaders;
create trigger trg_zz_sync_team_co_leaders after insert or update or delete on public.team_co_leaders
  for each row execute function public.sync_enfileirar_trg();

-- Ligar/desligar as chaves reenvia a org inteira; desligar a etapa 1 deixa "desligar pendente" para o robô
-- mandar ligado=false ao Visita uma vez (tira a trava lá; as equipes ficam como estão).
create or replace function public.sync_org_map_chaves_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visita_equipes is distinct from old.visita_equipes or new.visita_tl_lider is distinct from old.visita_tl_lider then
    if old.visita_equipes and not new.visita_equipes then
      new.visita_equipes_desligar_pendente := true;
      new.visita_equipes_ok_em := null; -- religar exige nova confirmação do Visita antes da etapa 2
    elsif new.visita_equipes then
      new.visita_equipes_desligar_pendente := false;
    end if;
    begin
      perform public.sync_enfileirar_org(new.adm_org_id, 'chave_visita_equipes');
    exception when others then
      raise warning 'sync_org_map_chaves_trg: %', sqlerrm;
    end;
  end if;
  return new;
end $$;
revoke all on function public.sync_org_map_chaves_trg() from public, anon, authenticated;
drop trigger if exists trg_sync_org_map_chaves on public.sync_org_map;
create trigger trg_sync_org_map_chaves before update of visita_equipes, visita_tl_lider on public.sync_org_map
  for each row execute function public.sync_org_map_chaves_trg();

-- Equipes da org no formato do Visita (só ids e nome/cor; nada de dado pessoal).
create or replace function public.sync_equipes_da_org(p_org uuid)
returns table (adm_team_id uuid, nome text, cor text, parent_adm_team_id uuid, lider_adm_user_id uuid,
               colideres_adm_user_ids uuid[], membros_adm_user_ids uuid[])
language sql stable security definer set search_path = '' as $$
  select t.id, t.nome, t.cor, t.parent_team_id, t.lider_id,
         coalesce((select array_agg(c.user_id order by c.user_id) from public.team_co_leaders c where c.team_id = t.id), '{}'),
         coalesce((select array_agg(tm.membro_id order by tm.membro_id) from public.team_members tm where tm.team_id = t.id), '{}')
    from public.teams t
   where t.organization_id = p_org
   order by t.parent_team_id nulls first, t.id
$$;
revoke all on function public.sync_equipes_da_org(uuid) from public, anon, authenticated;
grant execute on function public.sync_equipes_da_org(uuid) to service_role;
