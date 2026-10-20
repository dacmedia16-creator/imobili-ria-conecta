-- Teste SQL da migration 20261020180000_email_boas_vindas_envio (t_30cf354f). Dados 100% sintéticos.
-- Uso: supabase/tests/run-email-boas-vindas-envio.sh <container local>  (NUNCA produção). Termina em ROLLBACK.
-- Sucesso = "RESULTADO OK".
do $$
declare
  org uuid := (select id from public.organizations order by created_at limit 1);
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  u3 uuid := gen_random_uuid();
  ud uuid := gen_random_uuid();
  n int; r text; id1 bigint; id2 bigint;
begin
  if org is null then raise exception 'sem organizacao no banco local'; end if;

  -- 0) padrão: chave DESLIGADA, allowlist só com o Denis
  if (select boas_vindas_mode from public.email_config) <> 'off' then raise exception '0: chave nao nasceu off'; end if;
  if (select allowlist from public.email_config) <> array['dacmedia16@gmail.com'] then raise exception '0: allowlist'; end if;

  -- 1) chave off: cadastro não anota nada
  insert into auth.users (id, email, aud, role) values (u1, 't1-email@t.test', 'authenticated', 'authenticated');
  insert into public.profiles (id, nome, email, organization_id) values (u1, 'Teste Um', 't1-email@t.test', org) on conflict (id) do nothing;
  if exists (select 1 from public.email_outbox) then raise exception '1: anotou com chave off'; end if;

  -- 2) chave live, mas sem data de corte: não anota (proteção contra disparo em massa)
  update public.email_config set boas_vindas_mode = 'live';
  insert into auth.users (id, email, aud, role) values (u2, 't2-email@t.test', 'authenticated', 'authenticated');
  insert into public.profiles (id, nome, email, organization_id) values (u2, 'Teste Dois', 't2-email@t.test', org) on conflict (id) do nothing;
  if exists (select 1 from public.email_outbox) then raise exception '2: anotou sem boas_vindas_desde'; end if;

  -- 3) live + data de corte: anota 1; perfil recriado (mt_2a) NÃO duplica
  update public.email_config set boas_vindas_desde = now() - interval '1 minute';
  insert into auth.users (id, email, aud, role) values (u3, 't3-email@t.test', 'authenticated', 'authenticated');
  insert into public.profiles (id, nome, email, organization_id) values (u3, 'Teste Tres', 't3-email@t.test', org) on conflict (id) do nothing;
  delete from public.profiles where id = u3;
  insert into public.profiles (id, nome, email, organization_id) values (u3, 'Teste Tres', 't3-email@t.test', org);
  select count(*) into n from public.email_outbox where user_id = u3;
  if n <> 1 then raise exception '3: esperava 1 linha, veio %', n; end if;

  -- 4) robô: pegar -> erro SMTP simulado -> volta para pendente com erro; cadastro intacto
  update public.email_outbox set proxima_tentativa_em = now() where user_id = u3;
  select id into id1 from public.email_outbox_pegar(10) where user_id = u3;
  if id1 is null then raise exception '4: pegar nao devolveu'; end if;
  r := public.email_outbox_concluir(id1, 'erro', 'smtp_554: Access Restricted');
  if r <> 'pendente' then raise exception '4: falha deveria reagendar, veio %', r; end if;
  if not exists (select 1 from public.profiles where id = u3) then raise exception '4: cadastro sumiu'; end if;
  -- sucesso: enviado; 2ª rodada do robô não pega de novo (idempotência)
  update public.email_outbox set proxima_tentativa_em = now() where id = id1;
  perform public.email_outbox_pegar(10);
  r := public.email_outbox_concluir(id1, 'enviado', null, '<boas_vindas.x@somosmaxhub.com.br>');
  if r <> 'enviado' or (select enviado_em from public.email_outbox where id = id1) is null then raise exception '4: enviado'; end if;
  if exists (select 1 from public.email_outbox_pegar(10)) then raise exception '4: pegou item ja enviado'; end if;

  -- 5) gatilho quebrado (tabela da fila indisponível) NÃO derruba o cadastro
  alter table public.email_outbox rename to email_outbox_x;
  insert into auth.users (id, email, aud, role) values (ud, 'td-email@t.test', 'authenticated', 'authenticated');
  insert into public.profiles (id, nome, email, organization_id) values (ud, 'Teste D', 'td-email@t.test', org) on conflict (id) do nothing;
  alter table public.email_outbox_x rename to email_outbox;
  if not exists (select 1 from public.profiles where id = ud) then raise exception '5: cadastro falhou'; end if;

  -- 6) teste manual: fora da allowlist recusa; dentro, 1ª reserva ok e 2ª devolve null (não reenvia)
  update public.email_config set boas_vindas_mode = 'off';
  begin
    perform public.email_teste_reservar(u1);
    raise exception '6: aceitou fora da allowlist';
  exception when others then
    if sqlerrm not like '%fora_da_allowlist%' then raise; end if;
  end;
  update auth.users set email = 'DacMedia16@gmail.com' where id = u1;
  id1 := public.email_teste_reservar(u1);
  id2 := public.email_teste_reservar(u1);
  if id1 is null or id2 is not null then raise exception '6: idempotencia do teste (% / %)', id1, id2; end if;
  begin
    perform public.email_teste_ficticio_reservar('outro@t.test');
    raise exception '6: ficticio aceitou fora da allowlist';
  exception when others then
    if sqlerrm not like '%fora_da_allowlist%' then raise; end if;
  end;

  -- 7) chave off: disparo do cron não faz nada
  if public.email_disparar() <> 'off' then raise exception '7: disparar com chave off'; end if;

  -- 8) reenvio manual volta 1 usuário para a fila
  if public.email_reenviar_boas_vindas(u3) <> 'na_fila' then raise exception '8: reenvio'; end if;
  if (select status from public.email_outbox where user_id = u3) <> 'pendente' then raise exception '8: status'; end if;

  -- 9) anon/authenticated não leem a fila nem executam as funções
  if has_table_privilege('authenticated', 'public.email_outbox', 'select')
     or has_table_privilege('anon', 'public.email_config', 'select')
     or has_function_privilege('authenticated', 'public.email_teste_reservar(uuid)', 'execute') then
    raise exception '9: privilegio indevido';
  end if;

  raise notice 'RESULTADO OK';
end $$;
