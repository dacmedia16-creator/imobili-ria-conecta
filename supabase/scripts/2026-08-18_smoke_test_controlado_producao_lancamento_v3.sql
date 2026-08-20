-- ============================================================================
-- SMOKE TEST CONTROLADO — Lançamento (4 migrations do PR #5) — PRODUÇÃO — v3
-- Transacional, self-contained, termina SEMPRE em ROLLBACK — nada persiste,
-- nem em caso de sucesso. Qualquer erro é capturado e registrado no log em
-- vez de abortar a transação silenciosamente, pra você ver exatamente onde
-- parou. Seguro rodar mais de uma vez se precisar (não deixa resíduo).
--
-- MUDANÇAS DESTA VERSÃO (v3) EM RELAÇÃO À v2:
--   1) Os IDs de TODAS as linhas de teste (occurrences, occurrence_commissions,
--      sale_commission_extras, sale_status_history, activity_logs,
--      sale_parties) são capturados em arrays ANTES da limpeza (passo 17a).
--   2) A limpeza (passo 17b) deleta por esses IDs capturados diretamente —
--      não por sale_id/occurrence_id re-derivado depois do fato.
--   3) A verificação de resíduo (passos 18a-18g) também é por esses IDs
--      capturados, direto — nenhum JOIN/EXISTS contra tabela já esvaziada
--      (na v2 o check de occurrence_commissions usava EXISTS contra
--      occurrences/sale_commission_extras DEPOIS de já terem sido apagadas —
--      isso deixava a checagem incapaz de detectar residuo de verdade, já
--      que a condição do EXISTS nunca bateria em nada de qualquer jeito).
--   4) As 7 tabelas pedidas são verificadas uma a uma, todas por ID direto.
--   5) A auditoria de efeito externo (pg_notify/pg_net/http/webhook) agora é
--      uma CONSULTA REAL incluída no script (seção "AUDITORIA..." antes do
--      ROLLBACK) — não uma alegação no comentário. Ela descobre os triggers
--      das 7 tabelas DINAMICAMENTE (não por nome fixo), então também cobre
--      trigger que tenha sido adicionado depois desta revisão.
--
-- Como usar: colar o arquivo inteiro no SQL Editor do Supabase (produção) e
-- rodar uma única vez. Vão aparecer 4 resultados em sequência:
--   1) tabela de evidência linha a linha (_smoke_log);
--   2) veredito agregado (total de checks, quantos OK, quantos FALHA);
--   3) auditoria de efeito externo (funções/triggers x pg_notify/pg_net/http/webhook);
--   4) verificação independente de resíduo por padrão de nome.
-- Se o veredito (2) disser "HA FALHA" — parar, não rodar de novo, levar o
-- resultado exatamente como veio de volta para revisão.
-- ============================================================================
begin;

create temp table _smoke_log (
  seq serial primary key,
  step text not null,
  expected text,
  actual text,
  status text not null
) on commit drop;

do $$
declare
  v_current_step text := 'inicio';
  v_lancamento_user_id uuid;
  v_lancamento_count integer;
  v_financeiro_user_id uuid;
  v_sale_a uuid;
  v_sale_b uuid;
  v_dist jsonb;
  v_comissao_bruta numeric;
  v_bypass_bloqueado boolean;
  v_row record;
  v_row_count integer;
  v_venda_normal_count integer;
  -- IDs de teste capturados ANTES da limpeza (requisito 1) — usados tanto pra
  -- deletar (requisito 2) quanto pra verificar residuo depois (requisito 3).
  v_occ_ids uuid[];
  v_occ_comm_ids uuid[];
  v_sce_ids uuid[];
  v_ssh_ids uuid[];
  v_al_ids uuid[];
  v_sp_ids uuid[];
begin
  -- ============ 1) papel lancamento = exatamente 1, sem alterar nada ============
  v_current_step := '1. Papel lancamento (contagem, antes)';
  select count(*) into v_lancamento_count from public.user_roles where role = 'lancamento';
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '1', v_lancamento_count::text,
    case when v_lancamento_count = 1 then 'OK' else 'FALHA' end
  );
  if v_lancamento_count <> 1 then
    raise exception 'Esperado exatamente 1 usuario com papel lancamento, encontrado %', v_lancamento_count;
  end if;

  -- Escolha determinística (ORDER BY explícito) — não altera papéis, só lê.
  select p.id into v_lancamento_user_id
  from public.profiles p join public.user_roles ur on ur.user_id = p.id
  where ur.role = 'lancamento' and p.ativo = true
  order by p.id asc limit 1;

  select p.id into v_financeiro_user_id
  from public.profiles p join public.user_roles ur on ur.user_id = p.id
  where ur.role = 'financeiro' and p.ativo = true
  order by p.id asc limit 1;

  if v_lancamento_user_id is null or v_financeiro_user_id is null then
    raise exception 'Usuario ativo com papel lancamento ou financeiro nao encontrado';
  end if;

  v_current_step := '1b. Usuario lancamento escolhido (deterministico, UUID apenas)';
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, 'uuid valido', v_lancamento_user_id::text, 'OK');

  v_current_step := '1c. Usuario financeiro escolhido (deterministico, UUID apenas)';
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, 'uuid valido', v_financeiro_user_id::text, 'OK');

  -- ============ snapshot ANTES das 3 Vendas Normais reais mais recentes ============
  v_current_step := '2. Snapshot Venda Normal (antes) — exige exatamente 3';
  create temp table _venda_normal_antes (id uuid, comissao_bruta numeric, calculo_valido boolean) on commit drop;
  insert into _venda_normal_antes
  select s.id,
    (calcular_distribuicao_venda(s.id)->>'comissao_bruta')::numeric,
    (calcular_distribuicao_venda(s.id)->>'calculo_valido')::boolean
  from public.sales s
  where s.modalidade = 'padrao' and s.status not in ('rascunho', 'enviada_revisao')
  order by s.updated_at desc limit 3;

  select count(*) into v_venda_normal_count from _venda_normal_antes;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '3 vendas', v_venda_normal_count::text,
    case when v_venda_normal_count = 3 then 'OK' else 'FALHA' end
  );
  if v_venda_normal_count <> 3 then
    raise exception 'Esperado exatamente 3 Vendas Normais no snapshot, encontrado %', v_venda_normal_count;
  end if;

  for v_row in select * from _venda_normal_antes loop
    insert into _smoke_log(step, expected, actual, status) values (
      v_current_step || ' — ' || v_row.id, 'calculo_valido=true',
      'comissao_bruta=' || v_row.comissao_bruta || ' valido=' || v_row.calculo_valido,
      case when v_row.calculo_valido then 'OK' else 'FALHA' end
    );
  end loop;
  if exists (select 1 from _venda_normal_antes where not calculo_valido) then
    raise exception 'Venda Normal com calculo_valido=false ANTES do teste (nao deveria estar assim)';
  end if;

  -- ============ SALE A: comissao bruta R$6.000, distribui R$4.000 -> saldo POSITIVO R$2.000 ============
  v_current_step := '3. Sale A — criar_lancamento (percentual, saldo positivo esperado)';
  perform set_config('request.jwt.claims', json_build_object('sub', v_lancamento_user_id::text, 'role', 'authenticated')::text, true);
  v_sale_a := public.criar_lancamento('ZZ-SMOKE-DEPLOY-TEST-A-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), 'Construtora Smoke Test', '00.000.000/0001-00');
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'uuid nao nulo', coalesce(v_sale_a::text, 'NULL'), case when v_sale_a is not null then 'OK' else 'FALHA' end
  );
  if v_sale_a is null then raise exception 'criar_lancamento (Sale A) nao retornou id'; end if;

  v_current_step := '4. Sale A — preencher Resumo (negociado 100000, percentual 6% => bruta 6000)';
  update public.sales set valor_negociado = 100000, percentual_comissao = 6, data_assinatura = current_date, midia = 'Portal'
  where id = v_sale_a;
  get diagnostics v_row_count = row_count;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '1 linha atualizada', v_row_count::text, case when v_row_count = 1 then 'OK' else 'FALHA' end
  );
  if v_row_count <> 1 then raise exception 'Sale A: UPDATE do Resumo deveria afetar exatamente 1 linha, afetou %', v_row_count; end if;

  v_current_step := '5. Sale A — salvar_divisao_comissao_lancamento (1 linha, R$4000 de R$6000 => saldo R$2000)';
  v_dist := public.salvar_divisao_comissao_lancamento(v_sale_a, jsonb_build_array(
    jsonb_build_object('id', null, 'papel', 'corretor_vendedor', 'user_id', v_lancamento_user_id, 'valor', 4000, 'sem_cadastro_confirmado', false)
  ));
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'saldo_imobiliaria=2000.00', 'saldo=' || (v_dist->>'saldo_imobiliaria'),
    case when (v_dist->>'saldo_imobiliaria')::numeric = 2000 then 'OK' else 'FALHA' end
  );
  if (v_dist->>'saldo_imobiliaria')::numeric <> 2000 then
    raise exception 'Sale A: saldo pos-divisao deveria ser 2000 (retorno do calculo), veio %', v_dist->>'saldo_imobiliaria';
  end if;

  v_current_step := '6. Sale A — criar_ocorrencia_lancamento (SO PERCENTUAL, sem valor_total_comissao)';
  v_dist := public.criar_ocorrencia_lancamento(v_sale_a);
  v_comissao_bruta := (v_dist->>'comissao_bruta')::numeric;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'comissao_bruta=6000.00 (6% de 100000)', 'comissao_bruta=' || v_comissao_bruta,
    case when v_comissao_bruta = 6000 then 'OK' else 'FALHA' end
  );
  if v_comissao_bruta <> 6000 then raise exception 'Sale A: comissao_bruta esperado 6000, veio %', v_comissao_bruta; end if;

  v_current_step := '7. Sale A — occurrences.valor_comissao (derivado do percentual)';
  select valor_comissao into v_comissao_bruta from public.occurrences where sale_id = v_sale_a;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '6000.00', coalesce(v_comissao_bruta::text, 'NULL'),
    case when v_comissao_bruta = 6000 then 'OK' else 'FALHA' end
  );
  if v_comissao_bruta <> 6000 then raise exception 'Sale A: occurrences.valor_comissao esperado 6000, veio %', v_comissao_bruta; end if;

  v_current_step := '8. Sale A — bloqueio de bypass (UPDATE direto p/ concluida, SEM confirmacao)';
  begin
    update public.sales set status = 'ocorrencia_concluida' where id = v_sale_a;
    v_bypass_bloqueado := false;
  exception when others then
    v_bypass_bloqueado := true;
  end;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'rejeitado (excecao)',
    case when v_bypass_bloqueado then 'rejeitado (excecao) — protecao funcionou' else 'NAO REJEITADO — CONCLUIU SEM CONFIRMACAO' end,
    case when v_bypass_bloqueado then 'OK' else 'FALHA CRITICA' end
  );
  if not v_bypass_bloqueado then
    raise exception 'CRITICO: bypass de conclusao sem confirmacao NAO foi bloqueado (Sale A)';
  end if;

  v_current_step := '9. Sale A — concluir_lancamento (financeiro, saldo confirmado = 2000.00 EXATO)';
  perform set_config('request.jwt.claims', json_build_object('sub', v_financeiro_user_id::text, 'role', 'authenticated')::text, true);
  v_dist := public.concluir_lancamento(v_sale_a, 2000);
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'saldo_imobiliaria=2000.00 (retorno da RPC)', 'saldo=' || (v_dist->>'saldo_imobiliaria'),
    case when (v_dist->>'saldo_imobiliaria')::numeric = 2000 then 'OK' else 'FALHA' end
  );
  if (v_dist->>'saldo_imobiliaria')::numeric <> 2000 then
    raise exception 'Sale A: concluir_lancamento deveria retornar saldo_imobiliaria=2000, veio %', v_dist->>'saldo_imobiliaria';
  end if;

  v_current_step := '10. Sale A — snapshot pos-conclusao (status/saldo=2000/confirmado_em/confirmado_por)';
  select status::text, lancamento_saldo_imobiliaria, lancamento_saldo_confirmado_em is not null, lancamento_saldo_confirmado_por is not null
    into v_row from public.sales where id = v_sale_a;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'concluida, saldo=2000.00, confirmado_em/por preenchidos',
    row(v_row)::text,
    case when v_row.status = 'ocorrencia_concluida' and v_row.lancamento_saldo_imobiliaria = 2000 then 'OK' else 'FALHA' end
  );
  if not exists (
    select 1 from public.sales where id = v_sale_a and status::text = 'ocorrencia_concluida'
      and lancamento_saldo_imobiliaria = 2000 and lancamento_saldo_confirmado_em is not null and lancamento_saldo_confirmado_por is not null
  ) then
    raise exception 'Sale A nao ficou no estado esperado apos conclusao (status=ocorrencia_concluida, saldo=2000, confirmado_em/por preenchidos)';
  end if;

  v_current_step := '11. Sale A — historico de status (sale_status_history)';
  select count(*) into v_row_count from public.sale_status_history where sale_id = v_sale_a;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '>= 2 linhas', v_row_count::text, case when v_row_count >= 2 then 'OK' else 'FALHA' end
  );
  if v_row_count < 2 then raise exception 'Sale A: historico de status deveria ter >= 2 linhas, tem %', v_row_count; end if;

  -- ============ SALE B: valor_total_comissao explicito R$5.000, distribui os R$5.000 -> saldo ZERO ============
  v_current_step := '12. Sale B — criar_lancamento (valor explicito, saldo zero esperado)';
  perform set_config('request.jwt.claims', json_build_object('sub', v_lancamento_user_id::text, 'role', 'authenticated')::text, true);
  v_sale_b := public.criar_lancamento('ZZ-SMOKE-DEPLOY-TEST-B-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), 'Construtora Smoke Test', '00.000.000/0001-00');
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'uuid nao nulo', coalesce(v_sale_b::text, 'NULL'), case when v_sale_b is not null then 'OK' else 'FALHA' end
  );
  if v_sale_b is null then raise exception 'criar_lancamento (Sale B) nao retornou id'; end if;

  v_current_step := '13. Sale B — preencher Resumo (negociado 100000, valor_total_comissao=5000, sem percentual)';
  update public.sales set valor_negociado = 100000, valor_total_comissao = 5000, data_assinatura = current_date, midia = 'Portal'
  where id = v_sale_b;
  get diagnostics v_row_count = row_count;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '1 linha atualizada', v_row_count::text, case when v_row_count = 1 then 'OK' else 'FALHA' end
  );
  if v_row_count <> 1 then raise exception 'Sale B: UPDATE do Resumo deveria afetar exatamente 1 linha, afetou %', v_row_count; end if;

  v_current_step := '13b. Sale B — salvar_divisao_comissao_lancamento (1 linha, R$5000 de R$5000 => saldo 0)';
  v_dist := public.salvar_divisao_comissao_lancamento(v_sale_b, jsonb_build_array(
    jsonb_build_object('id', null, 'papel', 'corretor_vendedor', 'user_id', v_lancamento_user_id, 'valor', 5000, 'sem_cadastro_confirmado', false)
  ));
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'saldo_imobiliaria=0.00', 'saldo=' || (v_dist->>'saldo_imobiliaria'),
    case when (v_dist->>'saldo_imobiliaria')::numeric = 0 then 'OK' else 'FALHA' end
  );
  if (v_dist->>'saldo_imobiliaria')::numeric <> 0 then
    raise exception 'Sale B: saldo pos-divisao deveria ser 0, veio %', v_dist->>'saldo_imobiliaria';
  end if;

  v_current_step := '14. Sale B — criar_ocorrencia_lancamento (SO valor_total_comissao, sem percentual)';
  v_dist := public.criar_ocorrencia_lancamento(v_sale_b);
  v_comissao_bruta := (v_dist->>'comissao_bruta')::numeric;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'comissao_bruta=5000.00', 'comissao_bruta=' || v_comissao_bruta,
    case when v_comissao_bruta = 5000 then 'OK' else 'FALHA' end
  );
  if v_comissao_bruta <> 5000 then raise exception 'Sale B: comissao_bruta esperado 5000, veio %', v_comissao_bruta; end if;

  v_current_step := '15. Sale B — concluir_lancamento (financeiro, saldo confirmado = 0.00 EXATO)';
  perform set_config('request.jwt.claims', json_build_object('sub', v_financeiro_user_id::text, 'role', 'authenticated')::text, true);
  v_dist := public.concluir_lancamento(v_sale_b, 0);
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'saldo_imobiliaria=0.00 (retorno da RPC)', 'saldo=' || (v_dist->>'saldo_imobiliaria'),
    case when (v_dist->>'saldo_imobiliaria')::numeric = 0 then 'OK' else 'FALHA' end
  );
  if (v_dist->>'saldo_imobiliaria')::numeric <> 0 then
    raise exception 'Sale B: concluir_lancamento deveria retornar saldo_imobiliaria=0, veio %', v_dist->>'saldo_imobiliaria';
  end if;

  v_current_step := '15b. Sale B — historico de status (sale_status_history)';
  select count(*) into v_row_count from public.sale_status_history where sale_id = v_sale_b;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '>= 2 linhas', v_row_count::text, case when v_row_count >= 2 then 'OK' else 'FALHA' end
  );
  if v_row_count < 2 then raise exception 'Sale B: historico de status deveria ter >= 2 linhas, tem %', v_row_count; end if;

  if not exists (
    select 1 from public.sales where id = v_sale_b and status::text = 'ocorrencia_concluida' and lancamento_saldo_imobiliaria = 0
      and lancamento_saldo_confirmado_em is not null and lancamento_saldo_confirmado_por is not null
  ) then
    raise exception 'Sale B nao ficou no estado esperado apos conclusao (status=ocorrencia_concluida, saldo=0, confirmado_em/por preenchidos)';
  end if;

  -- ============ Venda Normal: reconfirmar intacta ============
  v_current_step := '16. Venda Normal (depois) — comparar com snapshot de antes';
  for v_row in
    select a.id, a.comissao_bruta as antes, d.comissao_bruta as depois, a.calculo_valido as valido_antes, d.calculo_valido as valido_depois
    from _venda_normal_antes a
    join lateral (
      select
        (calcular_distribuicao_venda(a.id)->>'comissao_bruta')::numeric as comissao_bruta,
        (calcular_distribuicao_venda(a.id)->>'calculo_valido')::boolean as calculo_valido
    ) d on true
  loop
    insert into _smoke_log(step, expected, actual, status) values (
      v_current_step || ' — ' || v_row.id, 'antes = depois',
      'antes=' || v_row.antes || ' depois=' || v_row.depois,
      case when v_row.antes = v_row.depois and v_row.valido_antes = v_row.valido_depois then 'OK' else 'FALHA CRITICA' end
    );
    if v_row.antes <> v_row.depois or v_row.valido_antes <> v_row.valido_depois then
      raise exception 'CRITICO: Venda Normal % mudou de resultado apos os testes de Lancamento', v_row.id;
    end if;
  end loop;

  -- ============ 17a) CAPTURA de IDs de teste ANTES da limpeza (requisito 1) ============
  v_current_step := '17a. Captura de IDs de teste (antes da limpeza)';
  select array_agg(id) into v_occ_ids from public.occurrences where sale_id in (v_sale_a, v_sale_b);
  select array_agg(id) into v_occ_comm_ids from public.occurrence_commissions
    where occurrence_id = any(coalesce(v_occ_ids, array[]::uuid[]));
  select array_agg(id) into v_sce_ids from public.sale_commission_extras where sale_id in (v_sale_a, v_sale_b);
  select array_agg(id) into v_ssh_ids from public.sale_status_history where sale_id in (v_sale_a, v_sale_b);
  select array_agg(id) into v_al_ids from public.activity_logs where sale_id in (v_sale_a, v_sale_b);
  select array_agg(id) into v_sp_ids from public.sale_parties where sale_id in (v_sale_a, v_sale_b);
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'arrays de id capturados (>0 onde aplicavel)',
    'occurrences=' || coalesce(array_length(v_occ_ids,1),0)
      || ' occurrence_commissions=' || coalesce(array_length(v_occ_comm_ids,1),0)
      || ' sale_commission_extras=' || coalesce(array_length(v_sce_ids,1),0)
      || ' sale_status_history=' || coalesce(array_length(v_ssh_ids,1),0)
      || ' activity_logs=' || coalesce(array_length(v_al_ids,1),0)
      || ' sale_parties=' || coalesce(array_length(v_sp_ids,1),0),
    'OK'
  );
  -- Esperado, com as 2 vendas concluidas: 2 occurrences, 2 occurrence_commissions (1 por venda),
  -- 2 sale_commission_extras, >=4 sale_status_history (>=2 por venda), >=6 activity_logs,
  -- 2 sale_parties (so vendedor_1/construtora — comprador_1 nao chega a ser preenchido no teste).
  if coalesce(array_length(v_occ_ids,1),0) <> 2 or coalesce(array_length(v_occ_comm_ids,1),0) <> 2
     or coalesce(array_length(v_sce_ids,1),0) <> 2 then
    raise exception 'CRITICO: contagem de IDs capturados fora do esperado (occurrences=%, occurrence_commissions=%, sale_commission_extras=%) — abortando antes da limpeza',
      coalesce(array_length(v_occ_ids,1),0), coalesce(array_length(v_occ_comm_ids,1),0), coalesce(array_length(v_sce_ids,1),0);
  end if;

  -- ============ 17b) LIMPEZA por ID capturado (requisito 2) — ordem respeita FKs ============
  v_current_step := '17b. Limpeza dos dados de teste (por ID capturado)';
  delete from public.occurrence_commissions where id = any(coalesce(v_occ_comm_ids, array[]::uuid[]));
  delete from public.occurrences where id = any(coalesce(v_occ_ids, array[]::uuid[]));
  delete from public.sale_status_history where id = any(coalesce(v_ssh_ids, array[]::uuid[]));
  delete from public.activity_logs where id = any(coalesce(v_al_ids, array[]::uuid[]));
  delete from public.sale_commission_extras where id = any(coalesce(v_sce_ids, array[]::uuid[]));
  delete from public.sale_parties where id = any(coalesce(v_sp_ids, array[]::uuid[]));
  delete from public.sales where id in (v_sale_a, v_sale_b);
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, 'DELETE por ID em 7 tabelas', 'executado', 'OK');

  -- ============ Verificação de resíduo — as 7 tabelas, direto pelos IDs capturados (requisito 3/4) ============
  -- Nenhum destes checks usa JOIN/EXISTS contra outra tabela ja apagada — cada um compara contra o
  -- ID (ou array de IDs) capturado no passo 17a, antes de qualquer DELETE acontecer.
  v_current_step := '18a. Residuo — sales (por ID direto: v_sale_a, v_sale_b)';
  select count(*) into v_row_count from public.sales where id in (v_sale_a, v_sale_b);
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em sales apos limpeza'; end if;

  v_current_step := '18b. Residuo — occurrences (por IDs capturados em 17a)';
  select count(*) into v_row_count from public.occurrences where id = any(coalesce(v_occ_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em occurrences apos limpeza'; end if;

  v_current_step := '18c. Residuo — occurrence_commissions (por IDs capturados em 17a)';
  select count(*) into v_row_count from public.occurrence_commissions where id = any(coalesce(v_occ_comm_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em occurrence_commissions apos limpeza'; end if;

  v_current_step := '18d. Residuo — sale_status_history (por IDs capturados em 17a)';
  select count(*) into v_row_count from public.sale_status_history where id = any(coalesce(v_ssh_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em sale_status_history apos limpeza'; end if;

  v_current_step := '18e. Residuo — activity_logs (por IDs capturados em 17a)';
  select count(*) into v_row_count from public.activity_logs where id = any(coalesce(v_al_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em activity_logs apos limpeza'; end if;

  v_current_step := '18f. Residuo — sale_commission_extras (por IDs capturados em 17a)';
  select count(*) into v_row_count from public.sale_commission_extras where id = any(coalesce(v_sce_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em sale_commission_extras apos limpeza'; end if;

  v_current_step := '18g. Residuo — sale_parties (por IDs capturados em 17a)';
  select count(*) into v_row_count from public.sale_parties where id = any(coalesce(v_sp_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em sale_parties apos limpeza'; end if;

  v_current_step := '19. Papel lancamento (contagem, depois — precisa continuar 1)';
  select count(*) into v_lancamento_count from public.user_roles where role = 'lancamento';
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '1', v_lancamento_count::text, case when v_lancamento_count = 1 then 'OK' else 'FALHA CRITICA' end
  );
  if v_lancamento_count <> 1 then raise exception 'CRITICO: contagem de papel lancamento mudou durante o teste'; end if;

  v_current_step := 'FIM — todos os checks concluidos';
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'OK');

exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- EVIDÊNCIA (ainda dentro da transação, antes do ROLLBACK)
-- ============================================================================
select seq, step, expected, actual, status from _smoke_log order by seq;

select
  count(*) as total_checks,
  count(*) filter (where status = 'OK') as checks_ok,
  count(*) filter (where status like 'FALHA%') as checks_falha,
  case
    when count(*) filter (where status like 'FALHA%') = 0 and count(*) > 0
      then 'TODOS OS CHECKS APROVADOS — NENHUM DADO PERSISTE (ROLLBACK a seguir)'
    else 'HA FALHA — NAO PROSSEGUIR — NENHUM DADO PERSISTE (ROLLBACK a seguir)'
  end as veredito
from _smoke_log;

-- ============================================================================
-- AUDITORIA DE EFEITO EXTERNO — consulta real, somente leitura (pg_catalog),
-- roda agora e mostra o resultado abaixo. Cobre (a) as funções que este
-- roteiro chama, listadas pelo nome, e (b) TODO trigger efetivamente
-- instalado nas 7 tabelas tocadas, descoberto dinamicamente via pg_trigger
-- (não por nome fixo) — então também pega trigger adicionado depois desta
-- revisão. "tem_padrao_suspeito=true" pediria parar e investigar antes de
-- prosseguir; não é uma alegação deste comentário, é o resultado da query.
-- ============================================================================
with funcoes_chamadas as (
  select unnest(array[
    'criar_lancamento','salvar_divisao_comissao_lancamento','criar_ocorrencia_lancamento',
    'concluir_lancamento','calcular_distribuicao_venda','validar_distribuicao_antes_concluir_lancamento',
    'validate_sale_status_transition','can_view_sale','can_edit_sale_comissao','has_role','has_any_role',
    'set_updated_at'
  ]) as proname
),
funcoes_via_nome as (
  select p.oid, p.proname, p.prosrc, 'chamada pelo roteiro'::text as origem
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (select proname from funcoes_chamadas)
),
funcoes_via_trigger as (
  select p.oid, p.proname, p.prosrc, 'trigger em ' || c.relname as origem
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal and n.nspname = 'public'
    and c.relname in ('sales','sale_parties','sale_commission_extras','occurrences','occurrence_commissions','sale_status_history','activity_logs')
)
select proname as funcao, string_agg(distinct origem, '; ') as origem,
  bool_or(prosrc ~* 'pg_notify|pg_net|net\.http|http_post|http_get|extensions\.http|supabase_functions|webhook') as tem_padrao_suspeito
from (select * from funcoes_via_nome union all select * from funcoes_via_trigger) todas
group by proname
order by tem_padrao_suspeito desc, proname;

-- verificação independente de resíduo por padrão de nome (não depende de variável nenhuma)
select 'residual sales por padrao de nome (ZZ-SMOKE-DEPLOY-TEST-%)' as verificacao, count(*) as linhas
from public.sales where imovel_id like 'ZZ-SMOKE-DEPLOY-TEST-%';

rollback;
