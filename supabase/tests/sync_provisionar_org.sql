-- Teste da migration 20261012150000_sync_provisionar_org (t_c0844acb). Só HOMOLOG (ou ensaio em produção dentro de
-- transação desfeita). Rodar DEPOIS da migration; termina SEMPRE com exceção ("RESULTADO OK" ou "FALHA"),
-- então nada fica gravado. Uso: supabase/tests/run-sync-provisionar-org.sh
do $t$
declare
  o1 uuid; o2 uuid; o3 uuid; n int; st text; r record; v_prox timestamptz;
begin
  -- 1) provision_mode off: criar org não anota nada
  update public.sync_config set provision_mode = 'off';
  insert into public.organizations (slug, nome) values ('zz-ensaio-prov-1', 'ZZ Ensaio Prov 1') returning id into o1;
  if exists (select 1 from public.sync_org_provision where adm_org_id = o1) then raise exception 'FALHA 1: anotou com off'; end if;

  -- 2) live: anota pendente com 2 min de folga
  update public.sync_config set provision_mode = 'live', mode = 'live';
  insert into public.organizations (slug, nome, cidade, uf) values ('zz-ensaio-prov-2', 'ZZ Ensaio Prov 2', 'Sorocaba', 'SP') returning id into o2;
  select status, proxima_tentativa_em into st, v_prox from public.sync_org_provision where adm_org_id = o2;
  if st is distinct from 'pendente' or v_prox < now() + interval '100 seconds' then raise exception 'FALHA 2: % %', st, v_prox; end if;

  -- 3) pegar respeita a folga; depois devolve os dados mínimos
  if exists (select 1 from public.sync_provisao_pegar(20) p where p.adm_org_id = o2) then raise exception 'FALHA 3a: pegou antes da folga'; end if;
  update public.sync_org_provision set proxima_tentativa_em = now() where adm_org_id = o2;
  select * into r from public.sync_provisao_pegar(20) p where p.adm_org_id = o2;
  if r.adm_org_id is null or r.slug <> 'zz-ensaio-prov-2' or r.cidade <> 'Sorocaba' or r.status_org <> 'ativa'
     or r.ja_mapeada or r.tentativas <> 1 then raise exception 'FALHA 3b: %', row_to_json(r); end if;
  if (select status from public.sync_org_provision where adm_org_id = o2) <> 'processando' then raise exception 'FALHA 3c'; end if;

  -- 4) erro = volta pendente com espera; ok sem os 2 ids = exceção
  st := public.sync_provisao_concluir(o2, 'erro', 'aaaaaaaa-0000-4000-8000-000000000001', null, null, 'visita: http_500');
  if st <> 'pendente' then raise exception 'FALHA 4a: %', st; end if;
  if (select estudo_org_id from public.sync_org_provision where adm_org_id = o2) is null then raise exception 'FALHA 4b: perdeu id parcial'; end if;
  if (select proxima_tentativa_em from public.sync_org_provision where adm_org_id = o2) < now() + interval '50 seconds' then raise exception 'FALHA 4c: sem espera'; end if;
  begin perform public.sync_provisao_concluir(o2, 'ok', null, null); raise exception 'FALHA 4d';
  exception when others then if sqlerrm like 'FALHA%' then raise; end if; end;

  -- 5) ok = grava sync_org_map live com Estudo e Visita ligados
  st := public.sync_provisao_concluir(o2, 'ok', 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002');
  if st <> 'ok' then raise exception 'FALHA 5a: %', st; end if;
  if not exists (select 1 from public.sync_org_map where adm_org_id = o2 and mode = 'live' and estudo_enabled and visita_enabled
                 and estudo_org_id = 'aaaaaaaa-0000-4000-8000-000000000001' and visita_imobiliaria_id = 'bbbbbbbb-0000-4000-8000-000000000002') then
    raise exception 'FALHA 5b: mapa';
  end if;
  -- reenfileirar org já ok/mapeada não mexe
  if public.sync_provisao_enfileirar(o2) <> 'ja_mapeada' then raise exception 'FALHA 5c'; end if;

  -- 6) ignorar (org de teste) e reenviar manual
  insert into public.organizations (slug, nome) values ('zz-ensaio-prov-3', 'ZZ Ensaio Prov 3') returning id into o3;
  if public.sync_provisao_ignorar(o3, 'org de teste') <> 'ignorado' then raise exception 'FALHA 6a'; end if;
  if exists (select 1 from public.sync_provisao_pegar(20) p where p.adm_org_id = o3) then raise exception 'FALHA 6b: pegou ignorada'; end if;
  if public.sync_provisao_enfileirar(o3, 'teste') <> 'pendente' then raise exception 'FALHA 6c'; end if;
  if not exists (select 1 from public.sync_provisao_pegar(20) p where p.adm_org_id = o3) then raise exception 'FALHA 6d'; end if;
  -- mapa criado à mão no meio do caminho: ok não sobrescreve, vai para humano
  insert into public.sync_org_map (adm_org_id, mode) values (o3, 'off');
  st := public.sync_provisao_concluir(o3, 'ok', 'aaaaaaaa-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000003');
  if st <> 'aguardando_humano' or (select mode from public.sync_org_map where adm_org_id = o3) <> 'off' then raise exception 'FALHA 6e: %', st; end if;

  -- 7) log e conflito de ORG (sem pessoa); conflito aberto igual não duplica
  insert into public.sync_log (adm_user_id, adm_org_id, satelite, acao, modo, resultado) values (null, o2, 'visita', 'provisionar_org', 'live', 'ok');
  insert into public.sync_conflicts (adm_user_id, adm_org_id, satelite, tipo) values (null, o1, 'estudo', 'org_parecida_no_satelite');
  begin
    insert into public.sync_conflicts (adm_user_id, adm_org_id, satelite, tipo) values (null, o1, 'estudo', 'org_parecida_no_satelite');
    raise exception 'FALHA 7: duplicou conflito';
  exception when unique_violation then null; end;

  -- 8) disparo do cron enxerga org pendente mesmo sem pessoa na fila
  delete from public.sync_outbox where status = 'pendente';
  update public.sync_org_provision set status = 'pendente', proxima_tentativa_em = now() where adm_org_id = o3;
  if public.sync_disparar('processar') = 'sem_pendencia' then raise exception 'FALHA 8a'; end if;
  update public.sync_config set provision_mode = 'off';
  if public.sync_disparar('processar') <> 'sem_pendencia' then raise exception 'FALHA 8b'; end if;

  -- 9) permissões: só service_role
  if has_function_privilege('authenticated', 'public.sync_provisao_concluir(uuid,text,uuid,uuid,jsonb,text)', 'execute')
     or has_function_privilege('anon', 'public.sync_provisao_pegar(integer)', 'execute')
     or has_table_privilege('authenticated', 'public.sync_org_provision', 'select') then
    raise exception 'FALHA 9';
  end if;
  raise exception 'RESULTADO OK 9/9 (transação desfeita)';
end $t$;
