-- Teste de integração da sincronização (só HOMOLOG). Roda inteiro em transação e termina em ROLLBACK.
-- Uso: psql ... -v ON_ERROR_STOP=1 -f supabase/tests/sync_satelites.sql   (falha = exceção)
begin;
do $$
declare
  u uuid; u2 uuid; t uuid; n int; r text; o public.sync_outbox;
begin
  select p.id into u from public.profiles p join public.organization_members om on om.user_id = p.id
   where om.organization_id = '00000000-0000-4000-8000-000000000001' order by p.created_at limit 1;
  select p.id into u2 from public.profiles p join public.organization_members om on om.user_id = p.id
   where om.organization_id = '00000000-0000-4000-8000-000000000001' and p.id <> u order by p.created_at limit 1;
  if u is null or u2 is null then raise exception 'homolog sem perfis de teste'; end if;
  delete from public.sync_outbox;

  -- 1) modo geral off: gatilho não enfileira
  update public.sync_config set mode = 'off';
  update public.profiles set nome = nome || ' x' where id = u;
  if (select count(*) from public.sync_outbox) <> 0 then raise exception '1: enfileirou com mode=off'; end if;

  -- 2) dry_run: várias mudanças da mesma pessoa = 1 linha pendente
  update public.sync_config set mode = 'dry_run';
  update public.profiles set nome = nome || ' y' where id = u;
  -- (ativo não é alterado aqui: o gatilho enforce_profiles_ativo_lock exige admin logado)
  update public.profiles set telefone = '15900000001' where id = u;
  update public.profiles set nome = nome || ' w' where id = u;
  select count(*) into n from public.sync_outbox where adm_user_id = u and status = 'pendente';
  if n <> 1 then raise exception '2: esperava 1 pendente, veio %', n; end if;

  -- 3) mudança irrelevante (updated_at/avatar) não enfileira outra pessoa
  update public.profiles set avatar_url = avatar_url where id = u2;
  if exists (select 1 from public.sync_outbox where adm_user_id = u2) then raise exception '3: campo irrelevante enfileirou'; end if;

  -- 4) troca de papel enfileira (user_roles)
  insert into public.user_roles (user_id, role, organization_id)
    values (u2, 'staff', '00000000-0000-4000-8000-000000000001') on conflict do nothing;
  if not exists (select 1 from public.sync_outbox where adm_user_id = u2 and motivo like 'user_roles:%') then
    raise exception '4: user_roles não enfileirou';
  end if;

  -- 5) estado desejado traz e-mail, roles e ativo calculado
  select count(*) into n from public.sync_estado_desejado(array[u, u2], null) e where e.email like '%@%' and array_length(e.roles, 1) >= 1;
  if n <> 2 then raise exception '5: estado desejado incompleto (%)', n; end if;
  if (select count(*) from public.sync_estado_desejado(null, '00000000-0000-4000-8000-000000000001')) < 2 then
    raise exception '5b: estado por org vazio';
  end if;

  -- 6) pegar: marca processando e incrementa tentativas; não devolve de novo
  select count(*) into n from public.sync_outbox_pegar(50);
  if n <> 2 then raise exception '6: pegar devolveu %', n; end if;
  if exists (select 1 from public.sync_outbox_pegar(50)) then raise exception '6b: pegou de novo'; end if;

  -- 7) nova mudança enquanto processa = nova linha pendente (não perde evento)
  update public.profiles set nome = nome || ' z' where id = u;
  if (select count(*) from public.sync_outbox where adm_user_id = u) <> 2 then raise exception '7: perdeu evento durante processamento'; end if;

  -- 8) concluir com erro quando já há pendente mais novo = substituido
  select * into o from public.sync_outbox where adm_user_id = u and status = 'processando';
  r := public.sync_outbox_concluir(o.id, 'erro', 'falha simulada');
  if r <> 'substituido' then raise exception '8: esperava substituido, veio %', r; end if;

  -- 9) erro sem pendente mais novo = nova tentativa com espera (backoff)
  select * into o from public.sync_outbox where adm_user_id = u2 and status = 'processando';
  r := public.sync_outbox_concluir(o.id, 'erro', 'falha simulada');
  if r <> 'pendente' then raise exception '9: esperava pendente, veio %', r; end if;
  if (select proxima_tentativa_em from public.sync_outbox where id = o.id) <= now() then raise exception '9b: sem backoff'; end if;

  -- 10) 6ª falha = falhou; reprocessar devolve para a fila
  update public.sync_outbox set tentativas = 6, status = 'processando' where id = o.id;
  r := public.sync_outbox_concluir(o.id, 'erro', 'falha simulada');
  if r <> 'falhou' then raise exception '10: esperava falhou, veio %', r; end if;
  if public.sync_reprocessar(array[o.id]) <> 1 then raise exception '10b: reprocessar não devolveu'; end if;
  if (select status from public.sync_outbox where id = o.id) <> 'pendente' then raise exception '10c'; end if;

  -- 11) disparo: sem segredos no Vault não chama ninguém; com mode off devolve off
  r := public.sync_disparar('processar');
  if r not in ('sem_configuracao', 'disparado') then raise exception '11: disparo inesperado %', r; end if;
  update public.sync_config set mode = 'off';
  if public.sync_disparar('processar') <> 'off' then raise exception '11b: disparou com off'; end if;

  -- 12) RLS: authenticated/anon não leem as tabelas da sincronização
  if has_table_privilege('authenticated', 'public.sync_outbox', 'SELECT')
     or has_table_privilege('anon', 'public.sync_log', 'SELECT')
     or has_function_privilege('authenticated', 'public.sync_estado_desejado(uuid[], uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sync_disparar(text)', 'EXECUTE') then
    raise exception '12: permissão indevida';
  end if;

  -- 13) a Única/Agência A nasce mapeada e em off
  if (select mode from public.sync_org_map where adm_org_id = '00000000-0000-4000-8000-000000000001') <> 'off' then
    raise exception '13: mapa não está em off';
  end if;

  raise notice 'SYNC_TESTES_OK (13 blocos)';
end $$;
rollback;
