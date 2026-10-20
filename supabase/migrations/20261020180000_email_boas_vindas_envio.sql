-- E-mail de boas-vindas do MAX HUB (t_30cf354f): caixa de saída no banco + robô (Edge Function
-- send-email-boas-vindas). Mesmo padrão do sync_outbox (20261011120000_sync_satelites).
-- NÃO APLICADA: aguarda aprovação do Denis. Rollback: supabase/rollback/20261020180000_email_boas_vindas_envio.sql
--
-- Regras:
--  * Chave geral email_config.boas_vindas_mode nasce 'off' (nada é anotado nem enviado).
--  * Idempotência: unique (user_id, tipo) => no máximo 1 e-mail de boas-vindas por usuário.
--  * O gatilho em profiles só ANOTA e engole qualquer erro: nunca derruba o cadastro.
--  * Sem backfill: só entra quem for criado depois de boas_vindas_desde (preenchido ao ligar).
--  * Modo teste: com a chave 'off', a função só envia por chamada manual para e-mails da allowlist.
--  * LGPD: a fila guarda ids, status e erro mascarado. Nome e e-mail são lidos na hora do envio.
begin;

-- ---------- Chave on/off ----------
create table if not exists public.email_config (
  id boolean primary key default true check (id),
  boas_vindas_mode text not null default 'off' check (boas_vindas_mode in ('off', 'dry_run', 'live')),
  boas_vindas_desde timestamptz,
  allowlist text[] not null default array['dacmedia16@gmail.com']::text[],
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.email_config (id) values (true) on conflict (id) do nothing;

-- ---------- Caixa de saída + log de envios ----------
create table if not exists public.email_outbox (
  id bigserial primary key,
  user_id uuid references auth.users (id) on delete cascade,
  tipo text not null check (tipo in ('boas_vindas', 'teste')),
  organization_id uuid,
  destino_teste text,                       -- só tipo='teste' (e-mail da allowlist)
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'enviado', 'simulado', 'falhou', 'cancelado')),
  tentativas int not null default 0,
  proxima_tentativa_em timestamptz not null default now() + interval '2 minutes',
  provider_message_id text,
  ultimo_erro text,
  origem text not null default 'cadastro',  -- cadastro | teste_manual | reenvio_manual
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  enviado_em timestamptz,
  constraint email_outbox_user_tipo_key unique (user_id, tipo),
  constraint email_outbox_user_ou_teste check (
    (tipo = 'boas_vindas' and user_id is not null and destino_teste is null)
    or (tipo = 'teste' and destino_teste is not null))
);
create index if not exists email_outbox_pendente_idx on public.email_outbox (proxima_tentativa_em)
  where status = 'pendente';

alter table public.email_config enable row level security;
alter table public.email_outbox enable row level security;
revoke all on public.email_config, public.email_outbox from public, anon, authenticated;
grant all on public.email_config, public.email_outbox to service_role;
grant usage, select on sequence public.email_outbox_id_seq to service_role;

-- ---------- Gatilho: só anota (nunca chama a internet, nunca lança erro) ----------
create or replace function public.email_enfileirar_boas_vindas_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.email_config;
begin
  begin
    select * into c from public.email_config where id;
    if c.boas_vindas_mode is null or c.boas_vindas_mode = 'off' then return null; end if;
    if c.boas_vindas_desde is null or now() < c.boas_vindas_desde then return null; end if;
    insert into public.email_outbox (user_id, tipo, organization_id)
    values (new.id, 'boas_vindas', new.organization_id)
    on conflict (user_id, tipo) do nothing;  -- perfil recriado (mt_2a) não gera 2º e-mail
  exception when others then
    raise warning 'email_enfileirar_boas_vindas_trg falhou: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.email_enfileirar_boas_vindas_trg() from public, anon, authenticated;

drop trigger if exists trg_zz_email_boas_vindas on public.profiles;
create trigger trg_zz_email_boas_vindas after insert on public.profiles
  for each row execute function public.email_enfileirar_boas_vindas_trg();

-- ---------- Robô: pegar / dados / concluir ----------
-- Linha 'processando' travada há mais de 15 min vira 'falhou' (revisão humana), NÃO volta para a fila:
-- o SMTP não tem chave de idempotência, então é melhor perder 1 e-mail do que mandar 2.
create or replace function public.email_outbox_pegar(p_limite integer default 20)
returns setof public.email_outbox language plpgsql security definer set search_path = '' as $$
begin
  update public.email_outbox set status = 'falhou', ultimo_erro = 'travado_em_processando', atualizado_em = now()
   where status = 'processando' and atualizado_em < now() - interval '15 minutes';
  return query
  update public.email_outbox o
     set status = 'processando', tentativas = o.tentativas + 1, atualizado_em = now()
   where o.id in (select id from public.email_outbox
                   where status = 'pendente' and tipo = 'boas_vindas' and proxima_tentativa_em <= now()
                   order by id for update skip locked limit greatest(1, least(p_limite, 50)))
  returning o.*;
end $$;

-- Dados lidos na hora do envio + conferência (usuário, perfil, vínculo e agência ativos).
create or replace function public.email_boas_vindas_dados(p_user uuid)
returns table (email text, nome text, imobiliaria text, apto boolean)
language sql stable security definer set search_path = '' as $$
  select lower(trim(coalesce(u.email, p.email))),
         p.nome,
         o.nome,
         (coalesce(p.ativo, true) and coalesce(om.ativo, true) and coalesce(o.status, 'ativa') = 'ativa'
          and coalesce(u.email, p.email) is not null)
    from auth.users u
    join public.profiles p on p.id = u.id
    left join public.organization_members om on om.user_id = u.id
    left join public.organizations o on o.id = coalesce(om.organization_id, p.organization_id)
   where u.id = p_user
$$;

-- p_resultado: enviado | simulado | cancelado | erro. Erro: nova tentativa em 1, 5 e 30 min; na 5ª, 'falhou'.
create or replace function public.email_outbox_concluir(
  p_id bigint, p_resultado text, p_erro text default null, p_message_id text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  o public.email_outbox;
  espera integer[] := array[1, 5, 30, 30];
  novo text;
begin
  select * into o from public.email_outbox where id = p_id for update;
  if not found then return 'nao_encontrado'; end if;
  if p_resultado in ('enviado', 'simulado', 'cancelado') then novo := p_resultado;
  elsif o.tipo = 'teste' or o.tentativas >= 5 then novo := 'falhou';
  else novo := 'pendente';
  end if;
  update public.email_outbox
     set status = novo,
         ultimo_erro = case when p_resultado in ('enviado', 'simulado') then null else left(p_erro, 300) end,
         provider_message_id = coalesce(left(p_message_id, 300), provider_message_id),
         enviado_em = case when novo = 'enviado' then now() else enviado_em end,
         proxima_tentativa_em = case when novo = 'pendente'
           then now() + make_interval(mins => espera[least(greatest(o.tentativas, 1), 4)]) else proxima_tentativa_em end,
         atualizado_em = now()
   where id = p_id;
  return novo;
end $$;

-- Teste manual (funciona com a chave 'off'): reserva o envio para um usuário cujo e-mail está na allowlist.
-- Retorna o id reservado, ou null se já houve envio/reserva para esse usuário (idempotência).
create or replace function public.email_teste_reservar(p_user uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_org uuid;
  v_id bigint;
begin
  select lower(trim(coalesce(u.email, p.email))), p.organization_id into v_email, v_org
    from auth.users u left join public.profiles p on p.id = u.id where u.id = p_user;
  if v_email is null or not (v_email = any (select lower(trim(x)) from public.email_config c, unnest(c.allowlist) x where c.id)) then
    raise exception 'fora_da_allowlist';
  end if;
  insert into public.email_outbox (user_id, tipo, organization_id, status, tentativas, origem, proxima_tentativa_em)
  values (p_user, 'boas_vindas', v_org, 'processando', 1, 'teste_manual', now())
  on conflict (user_id, tipo) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Teste manual com dados fictícios (sem usuário): só para destino da allowlist; cada chamada = 1 envio.
create or replace function public.email_teste_ficticio_reservar(p_destino text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v text := lower(trim(p_destino));
  v_id bigint;
begin
  if v is null or not (v = any (select lower(trim(x)) from public.email_config c, unnest(c.allowlist) x where c.id)) then
    raise exception 'fora_da_allowlist';
  end if;
  insert into public.email_outbox (tipo, destino_teste, status, tentativas, origem, proxima_tentativa_em)
  values ('teste', v, 'processando', 1, 'teste_manual', now())
  returning id into v_id;
  return v_id;
end $$;

-- Reenvio manual (decisão humana): volta 1 usuário para a fila, inclusive se já foi enviado.
create or replace function public.email_reenviar_boas_vindas(p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.email_outbox
     set status = 'pendente', tentativas = 0, proxima_tentativa_em = now(), ultimo_erro = null,
         origem = 'reenvio_manual', atualizado_em = now()
   where user_id = p_user and tipo = 'boas_vindas' and status <> 'processando';
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.email_outbox (user_id, tipo, organization_id, origem, proxima_tentativa_em)
    select p.id, 'boas_vindas', p.organization_id, 'reenvio_manual', now() from public.profiles p where p.id = p_user
    on conflict (user_id, tipo) do nothing;
    get diagnostics n = row_count;
  end if;
  return case when n > 0 then 'na_fila' else 'nao_encontrado_ou_processando' end;
end $$;

-- ---------- Disparo pelo cron (só chama a função se houver pendência e a chave não estiver 'off') ----------
-- Segredos no Vault (criados à parte, nunca em migration): 'email_boas_vindas_url' e 'email_internal_secret'.
create or replace function public.email_disparar()
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  if coalesce((select boas_vindas_mode from public.email_config where id), 'off') = 'off' then return 'off'; end if;
  if not exists (select 1 from public.email_outbox where status = 'pendente' and proxima_tentativa_em <= now()) then
    return 'sem_pendencia';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'email_boas_vindas_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'email_internal_secret';
  if v_url is null or v_secret is null then return 'sem_configuracao'; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-internal', v_secret),
    body := jsonb_build_object('acao', 'processar'),
    timeout_milliseconds := 55000
  );
  return 'disparado';
end $$;

do $$
declare f text;
begin
  foreach f in array array['email_outbox_pegar(integer)', 'email_boas_vindas_dados(uuid)',
    'email_outbox_concluir(bigint,text,text,text)', 'email_teste_reservar(uuid)',
    'email_teste_ficticio_reservar(text)', 'email_reenviar_boas_vindas(uuid)', 'email_disparar()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
