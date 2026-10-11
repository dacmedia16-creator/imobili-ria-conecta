-- Teste da 20261011140000_cadastro_gestor_team_leader.sql — HOMOLOGAÇÃO, tudo em transação
-- desfeita (ROLLBACK no final; nada fica gravado). Rodar com:
--   bash supabase/tests/run-cadastro-gestor-team-leader.sh
-- Fixtures fictícias (@example.test) nas agências de homologação A (legada) e B.
begin;

\ir ../migrations/20261011140000_cadastro_gestor_team_leader.sql

create temp table _r (n int, caso text, esperado text, obtido text, ok boolean) on commit drop;
grant all on _r to authenticated, service_role;

-- Liga a fila do sincronizador só dentro desta transação, para provar que o cadastro enfileira.
update public.sync_config set mode = 'live';

do $$
declare
  a uuid := '00000000-0000-4000-8000-000000000001';
  b uuid := '2a000000-0000-4000-8000-0000000000b0';
  k text;
begin
  foreach k in array array['adm','ges','tl','tl2','cor','gesb','tlsem'] loop
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                            email_confirmed_at, created_at, updated_at)
    values (md5('cgtl-' || k)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'cgtl-' || k || '@example.test',
            jsonb_build_object('organization_id', case when k = 'gesb' then b else a end),
            jsonb_build_object('nome', 'Teste ' || k), now(), now(), now());
  end loop;
  -- papéis (handle_new_user já deu 'corretor')
  delete from public.user_roles where user_id in (md5('cgtl-adm')::uuid, md5('cgtl-ges')::uuid,
    md5('cgtl-tl')::uuid, md5('cgtl-tl2')::uuid, md5('cgtl-gesb')::uuid, md5('cgtl-tlsem')::uuid);
  insert into public.user_roles (organization_id, user_id, role) values
    (a, md5('cgtl-adm')::uuid, 'admin'),
    (a, md5('cgtl-ges')::uuid, 'gestor'),
    (a, md5('cgtl-tl')::uuid, 'team_leader'),
    (a, md5('cgtl-tl2')::uuid, 'team_leader'),
    (b, md5('cgtl-gesb')::uuid, 'gestor'),
    (a, md5('cgtl-tlsem')::uuid, 'team_leader');
  insert into public.teams (id, organization_id, lider_id, nome) values
    (md5('cgtl-team-tl')::uuid, a, md5('cgtl-tl')::uuid, 'Equipe TL teste'),
    (md5('cgtl-team-tl2')::uuid, a, md5('cgtl-tl2')::uuid, 'Equipe TL2 teste'),
    (md5('cgtl-team-ges')::uuid, a, md5('cgtl-ges')::uuid, 'Equipe Gestor teste');
  -- subequipe da equipe do TL, liderada por outro: o corretor novo NÃO vai para ela
  insert into public.teams (id, organization_id, lider_id, nome, parent_team_id) values
    (md5('cgtl-team-sub')::uuid, a, md5('cgtl-tl2')::uuid, 'Sub teste', md5('cgtl-team-tl')::uuid);
end $$;

-- Helper de caso: chama a função como service_role (o mesmo papel do servidor do ADM).
create or replace function pg_temp.caso(_n int, _caso text, _esperado text, _actor text, _org uuid, _role public.app_role)
returns void language plpgsql as $$
declare r uuid; obt text;
begin
  begin
    execute 'set local role service_role';
    r := public.cadastro_equipe_destino(md5('cgtl-' || _actor)::uuid, _org, _role);
    obt := 'ok:' || coalesce((select nome from public.teams where id = r), 'sem-equipe');
  exception when others then
    obt := 'bloqueado:' || sqlerrm;
  end;
  execute 'reset role';
  insert into _r values (_n, _caso, _esperado, obt, obt like _esperado || '%');
end $$;

\o /dev/null
select pg_temp.caso(1, 'gestor cria corretor na própria imobiliária', 'ok:Equipe Gestor teste', 'ges', '00000000-0000-4000-8000-000000000001', 'corretor');
select pg_temp.caso(2, 'gestor cria gestor', 'bloqueado:cadastro_lider_so_corretor', 'ges', '00000000-0000-4000-8000-000000000001', 'gestor');
select pg_temp.caso(3, 'gestor cria admin', 'bloqueado:cadastro_lider_so_corretor', 'ges', '00000000-0000-4000-8000-000000000001', 'admin');
select pg_temp.caso(4, 'gestor cria team_leader/financeiro/juridico/staff', 'bloqueado:cadastro_lider_so_corretor', 'ges', '00000000-0000-4000-8000-000000000001', 'staff');
select pg_temp.caso(5, 'gestor de A cadastra na imobiliária B', 'bloqueado:cadastro_sem_agencia', 'ges', '2a000000-0000-4000-8000-0000000000b0', 'corretor');
select pg_temp.caso(6, 'gestor de B cadastra na imobiliária A', 'bloqueado:cadastro_sem_agencia', 'gesb', '00000000-0000-4000-8000-000000000001', 'corretor');
select pg_temp.caso(7, 'gestor de B sem equipe cria corretor em B (legado: servidor cria equipe dele)', 'ok:sem-equipe', 'gesb', '2a000000-0000-4000-8000-0000000000b0', 'corretor');
select pg_temp.caso(8, 'TL cria corretor → vai para a equipe que ele lidera (não a subequipe)', 'ok:Equipe TL teste', 'tl', '00000000-0000-4000-8000-000000000001', 'corretor');
select pg_temp.caso(9, 'TL2 cria corretor → vai para a equipe dele (nível 1), nunca a do TL', 'ok:Equipe TL2 teste', 'tl2', '00000000-0000-4000-8000-000000000001', 'corretor');
select pg_temp.caso(10, 'TL cria gestor', 'bloqueado:cadastro_lider_so_corretor', 'tl', '00000000-0000-4000-8000-000000000001', 'gestor');
select pg_temp.caso(11, 'TL cria team_leader', 'bloqueado:cadastro_lider_so_corretor', 'tl', '00000000-0000-4000-8000-000000000001', 'team_leader');
select pg_temp.caso(12, 'TL sem equipe cria corretor', 'bloqueado:cadastro_lider_sem_equipe', 'tlsem', '00000000-0000-4000-8000-000000000001', 'corretor');
select pg_temp.caso(13, 'TL em outra imobiliária', 'bloqueado:cadastro_sem_agencia', 'tl', '2a000000-0000-4000-8000-0000000000b0', 'corretor');
select pg_temp.caso(14, 'corretor cria corretor', 'bloqueado:cadastro_sem_permissao', 'cor', '00000000-0000-4000-8000-000000000001', 'corretor');
select pg_temp.caso(15, 'admin cria gestor (continua)', 'ok:sem-equipe', 'adm', '00000000-0000-4000-8000-000000000001', 'gestor');
select pg_temp.caso(16, 'admin cria corretor (continua)', 'ok:sem-equipe', 'adm', '00000000-0000-4000-8000-000000000001', 'corretor');
select pg_temp.caso(17, 'admin cria admin (continua bloqueado)', 'bloqueado:cadastro_admin_nao_cria_admin', 'adm', '00000000-0000-4000-8000-000000000001', 'admin');

-- 18. Gestor com vínculo inativo na imobiliária não cadastra.
update public.organization_members set ativo = false where user_id = md5('cgtl-gesb')::uuid;
select pg_temp.caso(18, 'gestor com vínculo inativo', 'bloqueado:cadastro_sem_agencia', 'gesb', '2a000000-0000-4000-8000-0000000000b0', 'corretor');
update public.organization_members set ativo = true where user_id = md5('cgtl-gesb')::uuid;
\o

-- 19-21. Permissões da função: só service_role executa.
insert into _r select 19, 'anon não executa a função', 'false',
  has_function_privilege('anon', 'public.cadastro_equipe_destino(uuid,uuid,public.app_role)', 'execute')::text,
  not has_function_privilege('anon', 'public.cadastro_equipe_destino(uuid,uuid,public.app_role)', 'execute');
insert into _r select 20, 'authenticated não executa a função', 'false',
  has_function_privilege('authenticated', 'public.cadastro_equipe_destino(uuid,uuid,public.app_role)', 'execute')::text,
  not has_function_privilege('authenticated', 'public.cadastro_equipe_destino(uuid,uuid,public.app_role)', 'execute');
insert into _r select 21, 'service_role executa a função', 'true',
  has_function_privilege('service_role', 'public.cadastro_equipe_destino(uuid,uuid,public.app_role)', 'execute')::text,
  has_function_privilege('service_role', 'public.cadastro_equipe_destino(uuid,uuid,public.app_role)', 'execute');

-- 22. Fluxo completo do servidor para o TL: função → cria login (auth.users) → entra na equipe.
--     Confirma que o sincronizador enfileira o novo corretor para Visita/Estudo.
do $$
declare t uuid; novo uuid := md5('cgtl-novo-tl')::uuid; a uuid := '00000000-0000-4000-8000-000000000001';
begin
  set local role service_role;
  t := public.cadastro_equipe_destino(md5('cgtl-tl')::uuid, a, 'corretor');
  reset role;
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (novo, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgtl-novo-tl@example.test',
          jsonb_build_object('organization_id', a), '{"nome":"Novo Corretor TL"}', now(), now(), now());
  insert into public.team_members (organization_id, team_id, membro_id) values (a, t, novo);
  insert into _r select 22, 'TL: corretor novo nasce em A, papel corretor, na equipe do TL, e entra na fila do sync',
    'A|corretor|Equipe TL teste|fila',
    concat_ws('|',
      (select case when organization_id = a then 'A' else 'outra' end from public.profiles where id = novo),
      (select string_agg(role::text, ',') from public.user_roles where user_id = novo),
      (select string_agg(tt.nome, ',') from public.team_members m join public.teams tt on tt.id = m.team_id where m.membro_id = novo),
      (select case when count(*) > 0 then 'fila' else 'sem-fila' end from public.sync_outbox where adm_user_id = novo and status = 'pendente')),
    false;
  update _r set ok = (obtido = esperado) where n = 22;
end $$;

-- 23-26. Banco com JWT real (RLS inalterada): gestor/TL não gravam papéis nem perfis de terceiros e
--        TL não coloca ninguém em equipe que não lidera.
create or replace function pg_temp.como(_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', md5('cgtl-' || _who)::uuid, 'role', 'authenticated')::text, true);
  perform set_config('mt.ctx', '', true);
  execute 'set local role authenticated';
end $$;

do $$
declare n int; a uuid := '00000000-0000-4000-8000-000000000001'; ok boolean;
begin
  -- 23: gestor tenta promover corretor a gestor direto no banco
  perform pg_temp.como('ges');
  begin
    insert into public.user_roles (organization_id, user_id, role) values (a, md5('cgtl-cor')::uuid, 'gestor');
    ok := false;
  exception when others then ok := true;
  end;
  reset role;
  insert into _r values (23, 'gestor promove corretor a gestor pelo banco', 'bloqueado', case when ok then 'bloqueado' else 'GRAVOU' end, ok);

  -- 24: TL tenta mudar o próprio papel
  perform pg_temp.como('tl');
  begin
    insert into public.user_roles (organization_id, user_id, role) values (a, md5('cgtl-tl')::uuid, 'admin');
    ok := false;
  exception when others then ok := true;
  end;
  reset role;
  insert into _r values (24, 'TL se promove a admin pelo banco', 'bloqueado', case when ok then 'bloqueado' else 'GRAVOU' end, ok);

  -- 25: TL tenta colocar corretor na equipe do TL2
  perform pg_temp.como('tl');
  begin
    insert into public.team_members (organization_id, team_id, membro_id) values (a, md5('cgtl-team-tl2')::uuid, md5('cgtl-cor')::uuid);
    ok := false;
  exception when others then ok := true;
  end;
  reset role;
  insert into _r values (25, 'TL coloca corretor em equipe de outro TL', 'bloqueado', case when ok then 'bloqueado' else 'GRAVOU' end, ok);

  -- 26: gestor tenta editar o perfil de um corretor direto no banco (edição passa só pelo servidor)
  perform pg_temp.como('ges');
  update public.profiles set nome = 'Hackeado' where id = md5('cgtl-cor')::uuid;
  get diagnostics n = row_count;
  reset role;
  insert into _r values (26, 'gestor edita perfil de terceiro direto no banco', '0 linhas', n || ' linhas', n = 0);
end $$;

select n, case when ok then 'PASSOU' else 'FALHOU' end as resultado, caso, esperado, obtido from _r order by n;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _r;

rollback;

-- Prova de que nada ficou: a função e as fixtures não existem após o rollback.
select 'pos_rollback' as etapa,
  to_regprocedure('public.cadastro_equipe_destino(uuid,uuid,public.app_role)') is null as funcao_ausente,
  (select count(*) from auth.users where email like 'cgtl-%@example.test') as fixtures_restantes,
  (select mode from public.sync_config limit 1) as sync_mode;
