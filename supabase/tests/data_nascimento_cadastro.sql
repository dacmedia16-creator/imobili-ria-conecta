-- Teste da 20261022120000_data_nascimento_cadastro.sql (t_dff88e75) — HOMOLOGAÇÃO, tudo em
-- transação desfeita (ROLLBACK no final; nada fica gravado). Rodar com:
--   bash supabase/tests/run-data-nascimento-cadastro.sh
-- Fixtures fictícias (@example.test) nas agências de homologação A (legada) e B.
begin;

\ir ../migrations/20261022120000_data_nascimento_cadastro.sql

create temp table _r (n int, caso text, esperado text, obtido text, ok boolean) on commit drop;
grant all on _r to authenticated, service_role;

do $$
declare
  a uuid := '00000000-0000-4000-8000-000000000001';
  b uuid := '2a000000-0000-4000-8000-0000000000b0';
  k text;
  t uuid;
begin
  -- A: pa = administrador principal; adm = admin; ges = gestor; tl = team leader (lidera cor);
  --    cor = corretor da equipe do tl; cor2 = corretor fora da equipe; plat = plataforma.
  -- B: gesb = gestor de B; corb = corretor de B.
  foreach k in array array['pa','adm','ges','tl','cor','cor2','plat','gesb','corb'] loop
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                            email_confirmed_at, created_at, updated_at)
    values (md5('dnas-' || k)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'dnas-' || k || '@example.test',
            jsonb_build_object('organization_id', case when k in ('gesb','corb') then b else a end),
            jsonb_build_object('nome', 'Teste ' || k), now(), now(), now());
  end loop;
  delete from public.user_roles where user_id in (select md5('dnas-' || x)::uuid
    from unnest(array['pa','adm','ges','tl','gesb']) x) and role = 'corretor';
  insert into public.user_roles (organization_id, user_id, role) values
    (a, md5('dnas-pa')::uuid, 'super_admin'),
    (a, md5('dnas-adm')::uuid, 'admin'),
    (a, md5('dnas-ges')::uuid, 'gestor'),
    (a, md5('dnas-tl')::uuid, 'team_leader'),
    (b, md5('dnas-gesb')::uuid, 'gestor');
  insert into public.platform_admins (user_id) values (md5('dnas-plat')::uuid);
  insert into public.teams (organization_id, lider_id, nome) values (a, md5('dnas-tl')::uuid, 'Equipe teste dnas')
    returning id into t;
  insert into public.team_members (organization_id, team_id, membro_id) values (a, t, md5('dnas-cor')::uuid);
end $$;

create or replace function pg_temp.como(_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', md5('dnas-' || _who)::uuid, 'role', 'authenticated')::text, true);
  perform set_config('mt.ctx', '', true);
  execute 'set local role authenticated';
end $$;

-- Executa um comando SQL como _who e registra 'ok:<retorno>' ou 'bloqueado:<sqlstate>'.
create or replace function pg_temp.roda(_n int, _caso text, _esperado text, _who text, _sql text)
returns void language plpgsql as $$
declare obt text; v text;
begin
  begin
    perform pg_temp.como(_who);
    execute _sql into v;
    obt := 'ok:' || coalesce(v, 'null');
  exception when others then
    obt := 'bloqueado:' || sqlstate;
  end;
  execute 'reset role';
  insert into _r values (_n, _caso, _esperado, obt, obt like _esperado || '%');
end $$;

\o /dev/null
-- Própria pessoa (profile_set_birthdate) + validação.
select pg_temp.roda(1, 'corretor grava a própria data válida', 'ok:1990-05-07', 'cor', $q$select public.profile_set_birthdate('1990-05-07')::text$q$);
select pg_temp.roda(2, 'idade menor que 16 anos é recusada', 'bloqueado:22023', 'cor', $q$select public.profile_set_birthdate(((now() at time zone 'America/Sao_Paulo')::date - interval '15 years')::date)::text$q$);
select pg_temp.roda(3, 'data antes de 1900 é recusada', 'bloqueado:22023', 'cor', $q$select public.profile_set_birthdate('1899-12-31')::text$q$);
select pg_temp.roda(4, 'data no futuro é recusada', 'bloqueado:22023', 'cor', $q$select public.profile_set_birthdate(((now() at time zone 'America/Sao_Paulo')::date + 1))::text$q$);
select pg_temp.roda(5, 'exatamente 16 anos hoje é aceito', 'ok:', 'cor2', $q$select public.profile_set_birthdate(((now() at time zone 'America/Sao_Paulo')::date - interval '16 years')::date)::text$q$);

-- Corretor NÃO mexe na data de outro.
select pg_temp.roda(6, 'corretor NÃO grava data de outro corretor', 'bloqueado:42501', 'cor', $q$select public.profile_birthdate_set_for_user(md5('dnas-cor2')::uuid, '1985-01-01')::text$q$);
select pg_temp.roda(7, 'corretor NÃO lê data completa de outro (RPC)', 'bloqueado:42501', 'cor2', $q$select public.profile_birthdate_get_for_user(md5('dnas-cor')::uuid)::text$q$);
select pg_temp.roda(8, 'corretor NÃO lê data de outro direto na tabela (0 linhas)', 'ok:0', 'cor2', $q$select count(*)::text from public.profile_birthdates where user_id = md5('dnas-cor')::uuid$q$);
select pg_temp.roda(9, 'corretor lê a própria data na tabela', 'ok:1', 'cor', $q$select count(*)::text from public.profile_birthdates where user_id = md5('dnas-cor')::uuid$q$);

-- Gestor / team leader / admin da mesma imobiliária.
select pg_temp.roda(10, 'gestor de A lê data do corretor de A', 'ok:1990-05-07', 'ges', $q$select public.profile_birthdate_get_for_user(md5('dnas-cor')::uuid)::text$q$);
select pg_temp.roda(11, 'gestor de A grava data do corretor de A', 'ok:1988-03-15', 'ges', $q$select public.profile_birthdate_set_for_user(md5('dnas-cor')::uuid, '1988-03-15')::text$q$);
select pg_temp.roda(12, 'gestor grava data < 16 anos é recusado', 'bloqueado:22023', 'ges', $q$select public.profile_birthdate_set_for_user(md5('dnas-cor')::uuid, ((now() at time zone 'America/Sao_Paulo')::date - interval '10 years')::date)::text$q$);
select pg_temp.roda(13, 'gestor NÃO grava data de admin (só corretor)', 'bloqueado:42501', 'ges', $q$select public.profile_birthdate_set_for_user(md5('dnas-adm')::uuid, '1980-01-01')::text$q$);
select pg_temp.roda(14, 'team leader grava data de corretor da própria equipe', 'ok:1991-02-02', 'tl', $q$select public.profile_birthdate_set_for_user(md5('dnas-cor')::uuid, '1991-02-02')::text$q$);
select pg_temp.roda(15, 'team leader NÃO grava data de corretor fora da equipe', 'bloqueado:42501', 'tl', $q$select public.profile_birthdate_set_for_user(md5('dnas-cor2')::uuid, '1991-02-02')::text$q$);
select pg_temp.roda(16, 'admin grava data do gestor', 'ok:1975-06-30', 'adm', $q$select public.profile_birthdate_set_for_user(md5('dnas-ges')::uuid, '1975-06-30')::text$q$);
select pg_temp.roda(17, 'admin comum NÃO grava data do administrador principal', 'bloqueado:42501', 'adm', $q$select public.profile_birthdate_set_for_user(md5('dnas-pa')::uuid, '1970-01-01')::text$q$);
select pg_temp.roda(18, 'ninguém usa a RPC de gestão na própria conta', 'bloqueado:42501', 'adm', $q$select public.profile_birthdate_set_for_user(md5('dnas-adm')::uuid, '1970-01-01')::text$q$);
select pg_temp.roda(19, 'admin principal NÃO grava data da conta da plataforma', 'bloqueado:42501', 'pa', $q$select public.profile_birthdate_set_for_user(md5('dnas-plat')::uuid, '1970-01-01')::text$q$);

-- Outra imobiliária.
select pg_temp.roda(20, 'gestor de B NÃO grava data de corretor de A', 'bloqueado:42501', 'gesb', $q$select public.profile_birthdate_set_for_user(md5('dnas-cor')::uuid, '1980-01-01')::text$q$);
select pg_temp.roda(21, 'gestor de B NÃO lê data de corretor de A', 'bloqueado:42501', 'gesb', $q$select public.profile_birthdate_get_for_user(md5('dnas-cor')::uuid)::text$q$);
select pg_temp.roda(22, 'admin principal de A NÃO grava data de corretor de B', 'bloqueado:42501', 'pa', $q$select public.profile_birthdate_set_for_user(md5('dnas-corb')::uuid, '1980-01-01')::text$q$);
select pg_temp.roda(23, 'gestor de B grava data de corretor de B', 'ok:1982-08-08', 'gesb', $q$select public.profile_birthdate_set_for_user(md5('dnas-corb')::uuid, '1982-08-08')::text$q$);

-- Apagar, auditoria sem a data e anônimo.
select pg_temp.roda(24, 'gestor apaga a data (NULL) do corretor', 'ok:null', 'ges', $q$select public.profile_birthdate_set_for_user(md5('dnas-cor2')::uuid, null)::text$q$);
\o

insert into _r select 25, 'auditoria grava sem a data (só target_user/removida)', 'sem_data',
  case when bool_and(not (payload::text ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}')) and count(*) >= 5 then 'sem_data' else 'com_data:' || count(*) end,
  bool_and(not (payload::text ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}')) and count(*) >= 5
from public.activity_logs where acao = 'user_birthdate_set'
  and payload->>'target_user' in (select md5('dnas-' || x)::uuid::text from unnest(array['cor','cor2','ges','corb']) x);
insert into _r select 26, 'anon não executa as RPCs', 'false',
  (has_function_privilege('anon', 'public.profile_birthdate_set_for_user(uuid,date)', 'EXECUTE')
   or has_function_privilege('anon', 'public.profile_birthdate_get_for_user(uuid)', 'EXECUTE')
   or has_function_privilege('anon', 'public.profile_set_birthdate(date)', 'EXECUTE'))::text,
  not (has_function_privilege('anon', 'public.profile_birthdate_set_for_user(uuid,date)', 'EXECUTE')
   or has_function_privilege('anon', 'public.profile_birthdate_get_for_user(uuid)', 'EXECUTE')
   or has_function_privilege('anon', 'public.profile_set_birthdate(date)', 'EXECUTE'));
insert into _r select 27, 'política da tabela continua "só o dono lê"', 'profile_birthdates_self',
  string_agg(policyname, ','), string_agg(policyname, ',') = 'profile_birthdates_self'
from pg_policies where schemaname = 'public' and tablename = 'profile_birthdates';

select n, case when ok then 'PASSOU' else 'FALHOU' end as resultado, caso, esperado, obtido from _r order by n;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _r;

rollback;

-- Prova de que nada ficou.
select 'pos_rollback' as etapa,
  (select count(*) from auth.users where email like 'dnas-%@example.test') as fixtures_restantes,
  to_regprocedure('public.profile_birthdate_set_for_user(uuid,date)') as rpc_gestao_restante;
