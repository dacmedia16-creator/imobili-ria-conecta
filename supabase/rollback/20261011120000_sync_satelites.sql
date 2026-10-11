-- Reversão da 20261011120000_sync_satelites.sql.
-- Parada instantânea (sem remover nada): update public.sync_config set mode = 'off';
-- Parar o robô: rode supabase/scripts/sync_cron_desligar.sql.
-- Este script remove a estrutura. As extensões pg_cron/pg_net ficam (sem efeito sozinhas);
-- para removê-las também, descomente as duas últimas linhas (só se nenhum outro job usar).
select cron.unschedule(jobname) from cron.job where jobname in ('sync-satelites', 'sync-reconciliar');

drop trigger if exists trg_zz_sync_profiles on public.profiles;
drop trigger if exists trg_zz_sync_user_roles on public.user_roles;
drop trigger if exists trg_zz_sync_org_members on public.organization_members;
drop trigger if exists trg_zz_sync_team_members on public.team_members;
drop trigger if exists trg_zz_sync_teams on public.teams;

drop function if exists public.sync_disparar(text);
drop function if exists public.sync_enfileirar_org(uuid, text);
drop function if exists public.sync_reprocessar(bigint[]);
drop function if exists public.sync_outbox_concluir(bigint, text, text);
drop function if exists public.sync_outbox_pegar(integer);
drop function if exists public.sync_estado_desejado(uuid[], uuid);
drop function if exists public.sync_enfileirar_trg();
drop function if exists public.sync_enfileirar(uuid, text);

drop table if exists public.sync_reconcile_runs;
drop table if exists public.sync_conflicts;
drop table if exists public.sync_log;
drop table if exists public.sync_outbox;
drop table if exists public.sync_org_map;
drop table if exists public.sync_config;

-- drop extension if exists pg_cron;
-- drop extension if exists pg_net;
