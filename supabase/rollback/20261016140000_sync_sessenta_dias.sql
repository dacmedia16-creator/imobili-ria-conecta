-- Rollback da migration 20261016140000_sync_sessenta_dias.sql (60 Dias MAX no sync, t_46bd77c2).
-- Desligar rápido, sem mexer em estrutura: update public.sync_org_map set sessenta_enabled = false;
-- Este arquivo só deve rodar DEPOIS de reverter o robô (a function anterior não lê as colunas novas).
-- Não apaga linhas: as travas antigas voltam como NOT VALID, para não falhar se já houver registros
-- "sessenta" no log (o histórico é preservado; só novas linhas passam a ser checadas).
BEGIN;
alter table public.sync_org_map drop column if exists sessenta_enabled, drop column if exists sessenta_org_id;

alter table public.sync_log drop constraint if exists sync_log_satelite_check;
alter table public.sync_log add constraint sync_log_satelite_check
  check (satelite in ('estudo', 'visita')) not valid;
alter table public.sync_conflicts drop constraint if exists sync_conflicts_satelite_check;
alter table public.sync_conflicts add constraint sync_conflicts_satelite_check
  check (satelite in ('estudo', 'visita')) not valid;
alter table public.sync_exclusoes drop constraint if exists sync_exclusoes_satelite_check;
alter table public.sync_exclusoes add constraint sync_exclusoes_satelite_check
  check (satelite in ('estudo', 'visita')) not valid;
COMMIT;
