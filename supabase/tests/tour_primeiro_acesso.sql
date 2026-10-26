-- Teste da 20261026120000_tour_primeiro_acesso.sql (t_2e09bc40). HOMOLOGAÇÃO, tudo em transação desfeita
-- (o runner faz BEGIN … ROLLBACK; nada fica gravado). Uso: bash supabase/tests/run-tour-primeiro-acesso.sh
-- 2 usuários fictícios (@example.test) em 2 agências diferentes (A legada e B) + 1 colega de A.
create temp table _r (caso text, ok boolean, obs text) on commit drop;
grant all on _r to authenticated;

do $$
declare
  a uuid := '00000000-0000-4000-8000-000000000001';
  b uuid := '2a000000-0000-4000-8000-0000000000b0';
  k text;
begin
  foreach k in array array['ua','ub','ua2'] loop
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                            email_confirmed_at, created_at, updated_at)
    values (md5('tour-' || k)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'tour-' || k || '@example.test',
            jsonb_build_object('organization_id', case when k = 'ub' then b else a end),
            jsonb_build_object('nome', 'Teste ' || k), now(), now(), now());
  end loop;
end $$;

create or replace function pg_temp.como(_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('tour-' || _who)::uuid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Cada caso roda como o usuário, com RLS valendo; erro esperado vira "ok".
create or replace function pg_temp.caso(_nome text, _who text, _sql text, _espera text) returns void
language plpgsql as $$
declare n int; res text;
begin
  begin
    perform pg_temp.como(_who);
    execute _sql;
    get diagnostics n = row_count;
    res := 'linhas=' || n;
  exception when others then
    res := 'erro=' || sqlstate;
  end;
  execute 'reset role';
  insert into _r values (_nome, res = _espera, res || ' (esperado ' || _espera || ')');
end $$;

-- 1) cada um grava a própria escolha
select pg_temp.caso('ua grava a própria', 'ua',
  $q$insert into public.user_tour_estado (user_id, tour, status, passo) values (auth.uid(), 'adm_inicio', 'fechado', 2)$q$, 'linhas=1');
select pg_temp.caso('ub grava a própria', 'ub',
  $q$insert into public.user_tour_estado (user_id, tour, status, passo) values (auth.uid(), 'adm_inicio', 'concluido', 8)$q$, 'linhas=1');
-- 2) ninguém grava em nome de outro (mesma org ou outra)
select pg_temp.caso('ua não grava para ub (outra org)', 'ua',
  format($q$insert into public.user_tour_estado (user_id, tour, status) values (%L, 'outro', 'fechado')$q$, md5('tour-ub')::uuid), 'erro=42501');
select pg_temp.caso('ua2 não grava para ua (mesma org)', 'ua2',
  format($q$insert into public.user_tour_estado (user_id, tour, status) values (%L, 'outro', 'fechado')$q$, md5('tour-ua')::uuid), 'erro=42501');
-- 3) leitura só da própria linha
select pg_temp.caso('ua lê só 1 linha (a dela)', 'ua',
  $q$select 1 from public.user_tour_estado$q$, 'linhas=1');
select pg_temp.caso('ua2 (mesma org de ua) não lê nada', 'ua2',
  $q$select 1 from public.user_tour_estado$q$, 'linhas=0');
select pg_temp.caso('ub não lê a de ua', 'ub',
  format($q$select 1 from public.user_tour_estado where user_id = %L$q$, md5('tour-ua')::uuid), 'linhas=0');
-- 4) update só da própria; o de outro afeta 0 linhas; não dá para "doar" a linha a outro
select pg_temp.caso('ua atualiza a própria (upsert)', 'ua',
  $q$insert into public.user_tour_estado (user_id, tour, status, passo) values (auth.uid(), 'adm_inicio', 'concluido', 8)
     on conflict (user_id, tour) do update set status = excluded.status, passo = excluded.passo$q$, 'linhas=1');
select pg_temp.caso('ub não altera a de ua', 'ub',
  format($q$update public.user_tour_estado set status = 'fechado' where user_id = %L$q$, md5('tour-ua')::uuid), 'linhas=0');
select pg_temp.caso('ua não transfere a linha para ub', 'ua',
  format($q$update public.user_tour_estado set user_id = %L where user_id = auth.uid()$q$, md5('tour-ub')::uuid), 'erro=42501');
-- 5) sem DELETE para authenticated
select pg_temp.caso('ua não apaga', 'ua',
  $q$delete from public.user_tour_estado where user_id = auth.uid()$q$, 'erro=42501');
-- 6) valores inválidos barrados
select pg_temp.caso('status inválido barrado', 'ua2',
  $q$insert into public.user_tour_estado (user_id, tour, status) values (auth.uid(), 'adm_inicio', 'qualquer')$q$, 'erro=23514');
select pg_temp.caso('passo fora do limite barrado', 'ua2',
  $q$insert into public.user_tour_estado (user_id, tour, status, passo) values (auth.uid(), 'adm_inicio', 'fechado', 999)$q$, 'erro=23514');

-- 7) anon sem acesso
do $$
begin
  set local role anon;
  begin
    perform 1 from public.user_tour_estado;
    reset role;
    insert into _r values ('anon não lê', false, 'leu');
  exception when insufficient_privilege then
    reset role;
    insert into _r values ('anon não lê', true, 'erro=42501');
  end;
end $$;

-- 8) conferência final como superusuário: só as 2 linhas próprias, com o status certo
insert into _r
select 'estado final', count(*) = 2
  and bool_and((user_id = md5('tour-ua')::uuid and status = 'concluido' and passo = 8)
            or (user_id = md5('tour-ub')::uuid and status = 'concluido')),
  count(*)::text || ' linhas'
from public.user_tour_estado where user_id in (md5('tour-ua')::uuid, md5('tour-ub')::uuid, md5('tour-ua2')::uuid);

select case when ok then 'ok  ' else 'FALHA ' end || caso || ' — ' || obs from _r;
select 'TOTAL=' || count(*) || ' FALHAS=' || count(*) filter (where not ok) from _r;
