-- Teste da 20261022010000_administrador_principal_plataforma.sql (t_44d957b1) — HOMOLOGAÇÃO, tudo
-- em transação desfeita (ROLLBACK no final; nada fica gravado). Rodar com:
--   bash supabase/tests/run-administrador-principal-plataforma.sh
-- Fixtures fictícias (@example.test) nas agências de homologação A (legada) e B.
begin;

\ir ../migrations/20261022010000_administrador_principal_plataforma.sql

create temp table _r (n int, caso text, esperado text, obtido text, ok boolean) on commit drop;
grant all on _r to authenticated, service_role;

do $$
declare
  a uuid := '00000000-0000-4000-8000-000000000001';
  b uuid := '2a000000-0000-4000-8000-0000000000b0';
  k text;
begin
  -- pa = Administrador principal de A; pa2 = outro principal de A; adm = admin comum de A;
  -- cor/cor2 = corretores de A; pab = principal de B; corb = corretor de B; plat = plataforma.
  foreach k in array array['pa','pa2','adm','cor','cor2','pab','corb','plat'] loop
    insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                            email_confirmed_at, created_at, updated_at)
    values (md5('apri-' || k)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'apri-' || k || '@example.test',
            jsonb_build_object('organization_id', case when k in ('pab','corb') then b else a end),
            jsonb_build_object('nome', 'Teste ' || k), now(), now(), now());
  end loop;
  insert into public.user_roles (organization_id, user_id, role) values
    (a, md5('apri-pa')::uuid, 'super_admin'), (a, md5('apri-pa')::uuid, 'admin'),
    (a, md5('apri-pa2')::uuid, 'super_admin'),
    (a, md5('apri-adm')::uuid, 'admin'),
    (b, md5('apri-pab')::uuid, 'super_admin');
  insert into public.platform_admins (user_id) values (md5('apri-plat')::uuid);
end $$;

-- Executa um INSERT/DELETE em user_roles como usuário autenticado (JWT real; RLS valendo).
create or replace function pg_temp.como(_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', md5('apri-' || _who)::uuid, 'role', 'authenticated')::text, true);
  perform set_config('mt.ctx', '', true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.grava(_n int, _caso text, _esperado text, _who text, _op text,
  _org uuid, _alvo text, _role public.app_role) returns void language plpgsql as $$
declare obt text; c int;
begin
  begin
    perform pg_temp.como(_who);
    if _op = 'ins' then
      insert into public.user_roles (organization_id, user_id, role) values (_org, md5('apri-' || _alvo)::uuid, _role);
      get diagnostics c = row_count;
    else
      delete from public.user_roles where user_id = md5('apri-' || _alvo)::uuid and role = _role;
      get diagnostics c = row_count;
    end if;
    obt := case when c > 0 then 'gravou' else 'bloqueado:0 linhas' end;
  exception when others then
    obt := 'bloqueado:' || sqlstate;
  end;
  execute 'reset role';
  insert into _r values (_n, _caso, _esperado, obt, obt like _esperado || '%');
end $$;

-- Cadastro (cadastro_equipe_destino) como service_role, igual ao servidor do ADM.
create or replace function pg_temp.cad(_n int, _caso text, _esperado text, _actor text, _org uuid, _role public.app_role)
returns void language plpgsql as $$
declare obt text;
begin
  begin
    execute 'set local role service_role';
    perform public.cadastro_equipe_destino(md5('apri-' || _actor)::uuid, _org, _role);
    obt := 'ok';
  exception when others then obt := 'bloqueado:' || sqlerrm;
  end;
  execute 'reset role';
  insert into _r values (_n, _caso, _esperado, obt, obt like _esperado || '%');
end $$;

\o /dev/null
-- Papéis direto no banco (policy user_roles_admin_write).
select pg_temp.grava(1, 'admin principal concede admin (mesma org)', 'gravou', 'pa', 'ins', '00000000-0000-4000-8000-000000000001', 'cor', 'admin');
select pg_temp.grava(2, 'admin principal retira admin (mesma org)', 'gravou', 'pa', 'del', null, 'cor', 'admin');
select pg_temp.grava(3, 'admin principal NÃO concede admin principal', 'bloqueado', 'pa', 'ins', '00000000-0000-4000-8000-000000000001', 'cor2', 'super_admin');
select pg_temp.grava(4, 'admin principal NÃO retira admin principal de outro', 'bloqueado', 'pa', 'del', null, 'pa2', 'super_admin');
select pg_temp.grava(5, 'admin comum NÃO concede admin', 'bloqueado', 'adm', 'ins', '00000000-0000-4000-8000-000000000001', 'cor2', 'admin');
select pg_temp.grava(6, 'admin comum NÃO concede admin principal', 'bloqueado', 'adm', 'ins', '00000000-0000-4000-8000-000000000001', 'cor2', 'super_admin');
select pg_temp.grava(7, 'admin comum concede gestor (continua igual)', 'gravou', 'adm', 'ins', '00000000-0000-4000-8000-000000000001', 'cor2', 'gestor');
select pg_temp.grava(8, 'admin principal de B NÃO concede admin em usuário de A', 'bloqueado', 'pab', 'ins', '00000000-0000-4000-8000-000000000001', 'cor2', 'admin');
select pg_temp.grava(9, 'admin principal de A NÃO concede admin em usuário de B', 'bloqueado', 'pa', 'ins', '2a000000-0000-4000-8000-0000000000b0', 'corb', 'admin');
select pg_temp.grava(10, 'admin principal de A NÃO retira papel de usuário de B', 'bloqueado', 'pa', 'del', null, 'pab', 'super_admin');
select pg_temp.grava(11, 'admin principal NÃO se dá papel', 'bloqueado', 'pa', 'ins', '00000000-0000-4000-8000-000000000001', 'pa', 'gestor');

-- Cadastro de usuário (o servidor chama esta função antes de criar o login).
select pg_temp.cad(12, 'admin principal cadastra admin', 'ok', 'pa', '00000000-0000-4000-8000-000000000001', 'admin');
select pg_temp.cad(13, 'admin principal NÃO cadastra admin principal', 'bloqueado:cadastro_principal_so_plataforma', 'pa', '00000000-0000-4000-8000-000000000001', 'super_admin');
select pg_temp.cad(14, 'admin comum NÃO cadastra admin (continua)', 'bloqueado:cadastro_admin_nao_cria_admin', 'adm', '00000000-0000-4000-8000-000000000001', 'admin');
select pg_temp.cad(15, 'admin principal de A NÃO cadastra em B', 'bloqueado:cadastro_sem_agencia', 'pa', '2a000000-0000-4000-8000-0000000000b0', 'corretor');
\o

-- 16-17. Impersonação: a tabela de sessões é fechada para authenticated (só o servidor grava).
insert into _r select 16, 'authenticated não lê/grava operational_impersonation_sessions', 'false',
  (has_table_privilege('authenticated', 'public.operational_impersonation_sessions', 'INSERT')
   or has_table_privilege('authenticated', 'public.operational_impersonation_sessions', 'SELECT'))::text,
  not (has_table_privilege('authenticated', 'public.operational_impersonation_sessions', 'INSERT')
   or has_table_privilege('authenticated', 'public.operational_impersonation_sessions', 'SELECT'));
-- 17-19. Regra do servidor "entrar como" = is_platform_super_admin: verdade só para a plataforma.
insert into _r select 17, 'is_platform_super_admin(admin principal) = false', 'false',
  public.is_platform_super_admin(md5('apri-pa')::uuid)::text, not public.is_platform_super_admin(md5('apri-pa')::uuid);
insert into _r select 18, 'is_platform_super_admin(admin principal de B) = false', 'false',
  public.is_platform_super_admin(md5('apri-pab')::uuid)::text, not public.is_platform_super_admin(md5('apri-pab')::uuid);
insert into _r select 19, 'is_platform_super_admin(plataforma) = true', 'true',
  public.is_platform_super_admin(md5('apri-plat')::uuid)::text, public.is_platform_super_admin(md5('apri-plat')::uuid);

-- 20-21. Visão executiva: bloco WhatsApp nulo para admin principal; resto do retorno preservado.
do $$
declare j jsonb;
begin
  perform pg_temp.como('pa');
  j := public.desempenho_contexto_periodo(current_date - 30, current_date);
  reset role;
  insert into _r values (20, 'visão executiva: admin principal NÃO recebe bloco WhatsApp', 'null',
    coalesce(j->>'whatsapp', 'null'), j is not null and j->'whatsapp' = 'null'::jsonb);
  insert into _r values (21, 'visão executiva: admin principal continua recebendo o resto', 'tempo+evolucao',
    case when j ? 'tempo_por_etapa' and j ? 'evolucao_mensal' then 'tempo+evolucao' else coalesce(j::text, 'null') end,
    j ? 'tempo_por_etapa' and j ? 'evolucao_mensal');
end $$;

select n, case when ok then 'PASSOU' else 'FALHOU' end as resultado, caso, esperado, obtido from _r order by n;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from _r;

rollback;

-- Prova de que nada ficou.
select 'pos_rollback' as etapa,
  (select count(*) from auth.users where email like 'apri-%@example.test') as fixtures_restantes,
  (select md5(coalesce(qual,'')||coalesce(with_check,'')) from pg_policies
     where schemaname='public' and tablename='user_roles' and policyname='user_roles_admin_write') as policy_md5;
