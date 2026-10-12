-- Rollback de 20261012150000_sync_provisionar_org.sql (t_c0844acb).
-- Ordem: 1) update public.sync_config set provision_mode='off' (para na hora); 2) republicar a versão anterior da
-- função sync-satelites; 3) rodar este SQL. Nada é apagado nos satélites; orgs já ligadas continuam em
-- sync_org_map (o sync de pessoas segue igual). Linhas de log/conflito de org (adm_user_id nulo) são preservadas
-- em backup antes de voltar o NOT NULL.
drop trigger if exists trg_zz_sync_provisao on public.organizations;
drop function if exists public.sync_provisao_trg();
drop function if exists public.sync_provisao_pegar(integer);
drop function if exists public.sync_provisao_concluir(uuid, text, uuid, uuid, jsonb, text);
drop function if exists public.sync_provisao_enfileirar(uuid, text);
drop function if exists public.sync_provisao_ignorar(uuid, text);

create table if not exists public.sync_eventos_org_backup_t_c0844acb as
  select 'sync_log'::text origem, to_jsonb(l) linha from public.sync_log l where l.adm_user_id is null
  union all
  select 'sync_conflicts', to_jsonb(c) from public.sync_conflicts c where c.adm_user_id is null;
alter table public.sync_eventos_org_backup_t_c0844acb enable row level security;
revoke all on public.sync_eventos_org_backup_t_c0844acb from public, anon, authenticated;
delete from public.sync_log where adm_user_id is null;
delete from public.sync_conflicts where adm_user_id is null;
drop index if exists public.sync_conflicts_org_um_aberto;
alter table public.sync_conflicts alter column adm_user_id set not null;
alter table public.sync_conflicts drop column if exists adm_org_id;
alter table public.sync_log alter column adm_user_id set not null;
alter table public.sync_log drop column if exists adm_org_id;

drop table if exists public.sync_org_provision;
alter table public.sync_config drop constraint if exists sync_config_provision_mode_check;
alter table public.sync_config drop column if exists provision_mode;

-- sync_disparar original (20261011120000_sync_satelites.sql)
create or replace function public.sync_disparar(p_acao text default 'processar')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  if p_acao not in ('processar', 'reconciliar') then return 'acao_invalida'; end if;
  if p_acao = 'processar' then
    if coalesce((select mode from public.sync_config where id), 'off') = 'off' then return 'off'; end if;
    if not exists (select 1 from public.sync_outbox where status = 'pendente' and proxima_tentativa_em <= now()) then
      return 'sem_pendencia';
    end if;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sync_satelites_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sync_internal_secret';
  if v_url is null or v_secret is null then return 'sem_configuracao'; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-internal', v_secret),
    body := jsonb_build_object('acao', p_acao),
    timeout_milliseconds := 55000
  );
  return 'disparado';
end $$;
revoke all on function public.sync_disparar(text) from public, anon, authenticated;
grant execute on function public.sync_disparar(text) to service_role;
