-- Cadastro único: sincronização ADM MAX -> Estudo de Mercado e Visita Prova (etapa 1, cartão t_41bcad66).
-- Aprovado por Denis em 11/10/2026: caixa de saída + robô a cada minuto; pg_cron e pg_net no ADM.
-- Esta migration NÃO agenda o cron e nasce com tudo em 'off' (geral e por imobiliária). Nada é enviado
-- até que: (1) sync_config.mode <> 'off'; (2) a imobiliária esteja em sync_org_map com mode <> 'off';
-- (3) o cron seja agendado por supabase/scripts/sync_cron_ligar.sql; (4) o satélite também esteja ligado.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------- Configuração ----------
create table if not exists public.sync_config (
  id boolean primary key default true check (id),
  mode text not null default 'off' check (mode in ('off','dry_run','live')),
  allow_deactivate boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.sync_config (id) values (true) on conflict do nothing;

create table if not exists public.sync_org_map (
  adm_org_id uuid primary key references public.organizations(id) on delete cascade,
  estudo_org_id uuid,
  visita_imobiliaria_id uuid,
  mode text not null default 'off' check (mode in ('off','dry_run','live')),
  estudo_enabled boolean not null default false,
  visita_enabled boolean not null default false,
  observacao text,
  updated_at timestamptz not null default now()
);

-- ---------- Caixa de saída (1 linha pendente por pessoa) ----------
create table if not exists public.sync_outbox (
  id bigserial primary key,
  adm_user_id uuid not null,
  motivo text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  tentativas integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  status text not null default 'pendente'
    check (status in ('pendente','processando','ok','falhou','aguardando_humano','substituido')),
  ultimo_erro text
);
create unique index if not exists sync_outbox_um_pendente_por_pessoa
  on public.sync_outbox (adm_user_id) where status = 'pendente';
create index if not exists sync_outbox_fila_idx on public.sync_outbox (status, proxima_tentativa_em);

-- ---------- Registro de tentativas ----------
create table if not exists public.sync_log (
  id bigserial primary key,
  outbox_id bigint,
  adm_user_id uuid not null,
  satelite text not null check (satelite in ('estudo','visita')),
  acao text not null,
  modo text not null,
  resultado text not null check (resultado in ('ok','erro','simulado','conflito','nada_a_fazer')),
  detalhe jsonb,
  erro text,
  criado_em timestamptz not null default now()
);
create index if not exists sync_log_user_idx on public.sync_log (adm_user_id, criado_em desc);
create index if not exists sync_log_criado_idx on public.sync_log (criado_em);

-- ---------- Fila de decisão humana ----------
create table if not exists public.sync_conflicts (
  id bigserial primary key,
  adm_user_id uuid not null,
  satelite text not null check (satelite in ('estudo','visita')),
  tipo text not null,
  candidatos jsonb,
  status text not null default 'aberto' check (status in ('aberto','resolvido','ignorado')),
  decisao text,
  resolvido_por uuid,
  resolvido_em timestamptz,
  criado_em timestamptz not null default now()
);
create unique index if not exists sync_conflicts_um_aberto
  on public.sync_conflicts (adm_user_id, satelite, tipo) where status = 'aberto';

-- ---------- Reconciliação sob demanda ----------
create table if not exists public.sync_reconcile_runs (
  id bigserial primary key,
  criado_em timestamptz not null default now(),
  adm_org_id uuid,
  resumo jsonb not null,
  detalhe jsonb
);

-- ---------- RLS: só service_role ----------
do $$
declare t text;
begin
  foreach t in array array['sync_config','sync_org_map','sync_outbox','sync_log','sync_conflicts','sync_reconcile_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;

-- ---------- Enfileirar ----------
create or replace function public.sync_enfileirar(p_user uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  if coalesce((select mode from public.sync_config where id), 'off') = 'off' then return; end if;
  insert into public.sync_outbox (adm_user_id, motivo)
  values (p_user, left(p_motivo, 60))
  on conflict (adm_user_id) where status = 'pendente' do nothing;
end $$;
revoke all on function public.sync_enfileirar(uuid, text) from public, anon, authenticated;
grant execute on function public.sync_enfileirar(uuid, text) to service_role;

-- Gatilho genérico. Só anota; nunca chama a internet e NUNCA faz o cadastro falhar.
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

drop trigger if exists trg_zz_sync_profiles on public.profiles;
create trigger trg_zz_sync_profiles after insert or update or delete on public.profiles
  for each row execute function public.sync_enfileirar_trg();
drop trigger if exists trg_zz_sync_user_roles on public.user_roles;
create trigger trg_zz_sync_user_roles after insert or update or delete on public.user_roles
  for each row execute function public.sync_enfileirar_trg();
drop trigger if exists trg_zz_sync_org_members on public.organization_members;
create trigger trg_zz_sync_org_members after insert or update or delete on public.organization_members
  for each row execute function public.sync_enfileirar_trg();
drop trigger if exists trg_zz_sync_team_members on public.team_members;
create trigger trg_zz_sync_team_members after insert or update or delete on public.team_members
  for each row execute function public.sync_enfileirar_trg();
drop trigger if exists trg_zz_sync_teams on public.teams;
create trigger trg_zz_sync_teams after update of lider_id on public.teams
  for each row execute function public.sync_enfileirar_trg();

-- ---------- Estado desejado (o que o robô envia: só campos mínimos) ----------
create or replace function public.sync_estado_desejado(p_user_ids uuid[] default null, p_org uuid default null)
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

-- ---------- Fila: pegar / concluir / reprocessar ----------
create or replace function public.sync_outbox_pegar(p_limite integer default 50)
returns setof public.sync_outbox language plpgsql security definer set search_path = '' as $$
begin
  -- item travado em 'processando' há mais de 10 min volta para a fila (ou é substituído)
  update public.sync_outbox o set status = 'substituido', atualizado_em = now()
   where o.status = 'processando' and o.atualizado_em < now() - interval '10 minutes'
     and exists (select 1 from public.sync_outbox x where x.adm_user_id = o.adm_user_id and x.status = 'pendente');
  update public.sync_outbox set status = 'pendente', atualizado_em = now()
   where status = 'processando' and atualizado_em < now() - interval '10 minutes';
  return query
  update public.sync_outbox o
     set status = 'processando', tentativas = o.tentativas + 1, atualizado_em = now()
   where o.id in (select id from public.sync_outbox
                   where status = 'pendente' and proxima_tentativa_em <= now()
                   order by id for update skip locked limit greatest(1, least(p_limite, 200)))
  returning o.*;
end $$;

-- p_resultado: ok | erro | aguardando_humano. Erro: nova tentativa em 1, 5, 15, 60 e 360 min; na 6ª falha, 'falhou'.
create or replace function public.sync_outbox_concluir(p_id bigint, p_resultado text, p_erro text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  o public.sync_outbox;
  espera integer[] := array[1, 5, 15, 60, 360];
  novo text;
begin
  select * into o from public.sync_outbox where id = p_id for update;
  if not found then return 'nao_encontrado'; end if;
  if p_resultado = 'ok' then novo := 'ok';
  elsif p_resultado = 'aguardando_humano' then novo := 'aguardando_humano';
  elsif o.tentativas >= 6 then novo := 'falhou';
  elsif exists (select 1 from public.sync_outbox where adm_user_id = o.adm_user_id and status = 'pendente' and id <> o.id) then
    novo := 'substituido'; -- já existe pedido mais novo para a mesma pessoa
  else novo := 'pendente';
  end if;
  update public.sync_outbox
     set status = novo,
         ultimo_erro = case when p_resultado = 'ok' then null else left(p_erro, 500) end,
         proxima_tentativa_em = case when novo = 'pendente'
           then now() + make_interval(mins => espera[least(greatest(o.tentativas, 1), 5)]) else proxima_tentativa_em end,
         atualizado_em = now()
   where id = p_id;
  return novo;
end $$;

-- Reprocessar: volta itens 'falhou'/'aguardando_humano' para a fila (todos, ou só os ids informados).
create or replace function public.sync_reprocessar(p_ids bigint[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.sync_outbox o
     set status = 'pendente', tentativas = 0, proxima_tentativa_em = now(), atualizado_em = now()
   where o.status in ('falhou', 'aguardando_humano')
     and (p_ids is null or o.id = any (p_ids))
     and not exists (select 1 from public.sync_outbox x where x.adm_user_id = o.adm_user_id and x.status = 'pendente');
  get diagnostics n = row_count;
  return n;
end $$;

-- Enfileira todas as pessoas de uma imobiliária (carga/reenvio manual).
create or replace function public.sync_enfileirar_org(p_org uuid, p_motivo text default 'manual')
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.sync_outbox (adm_user_id, motivo)
  select e.adm_user_id, left(p_motivo, 60) from public.sync_estado_desejado(null, p_org) e
  on conflict (adm_user_id) where status = 'pendente' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
declare f text;
begin
  foreach f in array array['sync_outbox_pegar(integer)','sync_outbox_concluir(bigint,text,text)','sync_reprocessar(bigint[])','sync_enfileirar_org(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------- Disparo pelo cron (só chama a função se houver pendência) ----------
-- Segredos no Vault (criados à parte, nunca em migration): 'sync_satelites_url' e 'sync_internal_secret'.
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

-- ---------- Primeira imobiliária mapeada (Única), em 'off' ----------
insert into public.sync_org_map (adm_org_id, estudo_org_id, visita_imobiliaria_id, mode, estudo_enabled, visita_enabled, observacao)
select '00000000-0000-4000-8000-000000000001', '13cf09f4-d695-476c-ac71-f24c727e6fd3', 'c90ca237-1e02-4225-864e-b8fb7574c354',
       'off', true, true, 'RE/MAX Única Escolha (aprovado por Denis em 11/10/2026)'
where exists (select 1 from public.organizations where id = '00000000-0000-4000-8000-000000000001')
on conflict (adm_org_id) do nothing;
