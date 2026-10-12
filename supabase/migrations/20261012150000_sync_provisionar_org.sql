-- Cadastro único: imobiliária criada no ADM MAX é criada automaticamente no Estudo e no Visita (cartão t_c0844acb,
-- aprovado por Denis em 12/10/2026). Rollback: supabase/rollback/20261012150000_sync_provisionar_org.sql
--
-- Como funciona:
-- 1. Gatilho AFTER INSERT em organizations só anota a org em sync_org_provision (pendente, com 2 min de folga
--    para o cadastro gravar CNPJ/cidade/admin). Nunca chama a internet e nunca faz o cadastro falhar.
--    Não anota se sync_config.provision_mode='off' ou se a org já está em sync_org_map (as 4 ligadas à mão).
-- 2. O robô sync-satelites (pg_cron, a cada minuto) pega as pendentes, faz a PRÉVIA nos 2 satélites e, só se os
--    2 aceitarem sem conflito, cria nos 2 (ação assinada 'provisionar_org'). Org parecida em qualquer satélite =
--    sync_conflicts (decisão humana) e NADA é criado.
-- 3. Com os 2 ids em mãos, sync_provisao_concluir grava sync_org_map (live, Estudo e Visita ligados) e enfileira
--    as pessoas da org; daí em diante o sync de pessoas já existente cuida de tudo.
-- Trava geral: provision_mode nasce 'off'. Valores: off | dry_run (só prévia) | live.
-- Excluir uma org (ex.: teste): select public.sync_provisao_ignorar('<org>', 'motivo'); ou criar antes a linha em
-- sync_org_map com mode='off'.

alter table public.sync_config add column if not exists provision_mode text not null default 'off';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sync_config_provision_mode_check') then
    alter table public.sync_config add constraint sync_config_provision_mode_check check (provision_mode in ('off', 'dry_run', 'live'));
  end if;
end $$;

-- ---------- Fila de provisionamento (1 linha por org) ----------
create table if not exists public.sync_org_provision (
  adm_org_id uuid primary key references public.organizations(id) on delete cascade,
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'ok', 'simulado', 'falhou', 'aguardando_humano', 'ignorado')),
  motivo text,
  tentativas integer not null default 0,
  proxima_tentativa_em timestamptz not null default now() + interval '2 minutes',
  estudo_org_id uuid,
  visita_imobiliaria_id uuid,
  detalhe jsonb,
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists sync_org_provision_fila_idx on public.sync_org_provision (status, proxima_tentativa_em);
alter table public.sync_org_provision enable row level security;
revoke all on public.sync_org_provision from public, anon, authenticated;
grant select, insert, update, delete on public.sync_org_provision to service_role;

-- ---------- sync_log e sync_conflicts também registram eventos de ORG (sem pessoa) ----------
alter table public.sync_log add column if not exists adm_org_id uuid;
alter table public.sync_log alter column adm_user_id drop not null;
alter table public.sync_conflicts add column if not exists adm_org_id uuid;
alter table public.sync_conflicts alter column adm_user_id drop not null;
create unique index if not exists sync_conflicts_org_um_aberto
  on public.sync_conflicts (adm_org_id, satelite, tipo) where status = 'aberto' and adm_user_id is null;

-- ---------- Gatilho: só anota ----------
create or replace function public.sync_provisao_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if coalesce((select provision_mode from public.sync_config where id), 'off') <> 'off'
       and not exists (select 1 from public.sync_org_map m where m.adm_org_id = new.id) then
      insert into public.sync_org_provision (adm_org_id, motivo) values (new.id, 'organizations:insert')
      on conflict (adm_org_id) do nothing;
    end if;
  exception when others then
    raise warning 'sync_provisao_trg falhou: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.sync_provisao_trg() from public, anon, authenticated;
drop trigger if exists trg_zz_sync_provisao on public.organizations;
create trigger trg_zz_sync_provisao after insert on public.organizations
  for each row execute function public.sync_provisao_trg();

-- ---------- Pegar: marca 'processando' e devolve os dados mínimos da org ----------
-- email_contato = e-mail do admin da org no ADM (se houver); vira o e-mail da imobiliária no Visita.
create or replace function public.sync_provisao_pegar(p_limite integer default 5)
returns table (adm_org_id uuid, nome text, slug text, cnpj text, cidade text, uf text, email_contato text,
               status_org text, ja_mapeada boolean, tentativas integer)
language plpgsql security definer set search_path = '' as $$
begin
  update public.sync_org_provision set status = 'pendente', atualizado_em = now()
   where status = 'processando' and atualizado_em < now() - interval '10 minutes';
  return query
  with alvo as (
    update public.sync_org_provision s
       set status = 'processando', tentativas = s.tentativas + 1, atualizado_em = now()
     where s.adm_org_id in (select x.adm_org_id from public.sync_org_provision x
                             where x.status = 'pendente' and x.proxima_tentativa_em <= now()
                             order by x.criado_em for update skip locked
                             limit greatest(1, least(p_limite, 20)))
    returning s.adm_org_id, s.tentativas
  )
  select o.id, o.nome, o.slug, o.cnpj, o.cidade, o.uf,
         (select lower(trim(coalesce(nullif(trim(p.email), ''), u.email::text)))
            from public.user_roles ur
            join public.profiles p on p.id = ur.user_id
            left join auth.users u on u.id = p.id
           where ur.role::text = 'admin' and coalesce(ur.organization_id, p.organization_id) = o.id and p.ativo
           order by p.created_at limit 1),
         o.status,
         exists (select 1 from public.sync_org_map m where m.adm_org_id = o.id),
         a.tentativas
    from alvo a join public.organizations o on o.id = a.adm_org_id;
end $$;

-- ---------- Concluir ----------
-- p_resultado: ok (grava o mapa e enfileira as pessoas) | simulado | aguardando_humano | ignorado | erro
-- (erro: nova tentativa em 1, 5, 15, 60 e 360 min; na 6ª falha, 'falhou').
create or replace function public.sync_provisao_concluir(
  p_org uuid, p_resultado text, p_estudo uuid default null, p_visita uuid default null,
  p_detalhe jsonb default null, p_erro text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.sync_org_provision;
  espera integer[] := array[1, 5, 15, 60, 360];
  novo text;
begin
  select * into s from public.sync_org_provision where adm_org_id = p_org for update;
  if not found then return 'nao_encontrado'; end if;
  if p_resultado = 'ok' then
    if p_estudo is null or p_visita is null then raise exception 'ok exige os 2 ids'; end if;
    insert into public.sync_org_map (adm_org_id, estudo_org_id, visita_imobiliaria_id, mode, estudo_enabled, visita_enabled, observacao)
    values (p_org, p_estudo, p_visita, 'live', true, true, 'Provisionada automaticamente pelo ADM (t_c0844acb)')
    on conflict (adm_org_id) do nothing;
    if not found then
      -- Já havia mapa (alguém ligou à mão no meio do caminho): não sobrescreve.
      novo := 'aguardando_humano';
      p_erro := 'sync_org_map_ja_existia';
    else
      novo := 'ok';
      perform public.sync_enfileirar_org(p_org, 'provisionada_t_c0844acb');
    end if;
  elsif p_resultado in ('simulado', 'aguardando_humano', 'ignorado') then novo := p_resultado;
  elsif s.tentativas >= 6 then novo := 'falhou';
  else novo := 'pendente';
  end if;
  update public.sync_org_provision
     set status = novo,
         estudo_org_id = coalesce(p_estudo, estudo_org_id),
         visita_imobiliaria_id = coalesce(p_visita, visita_imobiliaria_id),
         detalhe = coalesce(p_detalhe, detalhe),
         ultimo_erro = case when novo = 'ok' then null else left(p_erro, 500) end,
         proxima_tentativa_em = case when novo = 'pendente'
           then now() + make_interval(mins => espera[least(greatest(s.tentativas, 1), 5)]) else proxima_tentativa_em end,
         atualizado_em = now()
   where adm_org_id = p_org;
  return novo;
end $$;

-- ---------- Operação manual ----------
-- (Re)enviar uma org: volta para a fila agora (não mexe em org já 'ok' nem em org já mapeada).
create or replace function public.sync_provisao_enfileirar(p_org uuid, p_motivo text default 'manual')
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations where id = p_org) then return 'org_nao_existe'; end if;
  if exists (select 1 from public.sync_org_map where adm_org_id = p_org) then return 'ja_mapeada'; end if;
  insert into public.sync_org_provision (adm_org_id, motivo, proxima_tentativa_em)
  values (p_org, left(p_motivo, 60), now())
  on conflict (adm_org_id) do update
     set status = 'pendente', motivo = excluded.motivo, tentativas = 0, proxima_tentativa_em = now(), atualizado_em = now()
   where public.sync_org_provision.status <> 'ok';
  return coalesce((select status from public.sync_org_provision where adm_org_id = p_org), 'nao_enfileirada');
end $$;

-- Excluir uma org do provisionamento (ex.: org de teste).
create or replace function public.sync_provisao_ignorar(p_org uuid, p_motivo text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sync_org_provision (adm_org_id, status, motivo)
  values (p_org, 'ignorado', left(p_motivo, 120))
  on conflict (adm_org_id) do update
     set status = 'ignorado', motivo = excluded.motivo, atualizado_em = now()
   where public.sync_org_provision.status <> 'ok';
  return (select status from public.sync_org_provision where adm_org_id = p_org);
end $$;

do $$
declare f text;
begin
  foreach f in array array['sync_provisao_pegar(integer)', 'sync_provisao_concluir(uuid,text,uuid,uuid,jsonb,text)',
                           'sync_provisao_enfileirar(uuid,text)', 'sync_provisao_ignorar(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------- Disparo: o cron também chama a função quando há org pendente ----------
create or replace function public.sync_disparar(p_acao text default 'processar')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  if p_acao not in ('processar', 'reconciliar') then return 'acao_invalida'; end if;
  if p_acao = 'processar' then
    if coalesce((select mode from public.sync_config where id), 'off') = 'off' then return 'off'; end if;
    if not exists (select 1 from public.sync_outbox where status = 'pendente' and proxima_tentativa_em <= now())
       and not (coalesce((select provision_mode from public.sync_config where id), 'off') <> 'off'
                and exists (select 1 from public.sync_org_provision where status = 'pendente' and proxima_tentativa_em <= now())) then
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
