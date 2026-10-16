-- 60 Dias MAX como 3º satélite do robô sync-satelites, OPCIONAL por imobiliária (cartão t_46bd77c2,
-- ESPEC_ADM_CONTA_MAX_60_DIAS seção 2.1). Aditiva: nenhuma imobiliária muda de comportamento
-- (sessenta_enabled = false por padrão). sync_provisao_concluir NÃO muda (continua exigindo só os 2 ids).

alter table public.sync_org_map
  add column if not exists sessenta_org_id uuid,
  add column if not exists sessenta_enabled boolean not null default false;

-- As travas de "satelite" só aceitavam estudo/visita. O robô grava o sync_log de todos os satélites
-- num único insert: sem ampliar a trava, um registro do 60 Dias derrubaria também o log do Estudo/Visita.
-- Ampliar a lista não altera nenhuma linha existente.
alter table public.sync_log drop constraint if exists sync_log_satelite_check;
alter table public.sync_log add constraint sync_log_satelite_check
  check (satelite in ('estudo', 'visita', 'sessenta'));

alter table public.sync_conflicts drop constraint if exists sync_conflicts_satelite_check;
alter table public.sync_conflicts add constraint sync_conflicts_satelite_check
  check (satelite in ('estudo', 'visita', 'sessenta'));

alter table public.sync_exclusoes drop constraint if exists sync_exclusoes_satelite_check;
alter table public.sync_exclusoes add constraint sync_exclusoes_satelite_check
  check (satelite in ('estudo', 'visita', 'sessenta'));
