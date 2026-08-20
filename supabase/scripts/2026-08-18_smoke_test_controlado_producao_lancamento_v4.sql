-- ============================================================================
-- SMOKE TEST CONTROLADO — Lançamento (4 migrations do PR #5) — PRODUÇÃO — v4
-- Transacional, self-contained, termina SEMPRE em ROLLBACK — nada persiste,
-- nem em caso de sucesso. Seguro rodar mais de uma vez se precisar (não deixa
-- resíduo).
--
-- MUDANÇAS DESTA VERSÃO (v4) EM RELAÇÃO À v3:
--   A auditoria de efeito externo (pg_notify/pg_net/http/webhook) virou uma
--   TRAVA PREVENTIVA DE VERDADE, não só uma consulta informativa — roda como
--   passo 0, ANTES de qualquer escrita de teste, e reprova o veredito
--   agregado se achar algo suspeito ou alguma função esperada não localizada.
--
-- CORREÇÃO ESTRUTURAL (encontrada por mim ao revisar a v4 antes de entregar,
-- não foi pedido por você): a v1/v2/v3 e o primeiro rascunho da v4 rodavam
-- TODOS os ~30 passos dentro de UM ÚNICO bloco `do $$ ... exception ... end
-- $$;`. Descobri (e confirmei com um teste isolado, descartável, fora deste
-- arquivo) que isso é um bug real do Postgres/PL-pgSQL: quando um bloco com
-- cláusula EXCEPTION captura um erro, ele desfaz TODAS as alterações de
-- estado feitas desde a entrada do bloco — inclusive os INSERTs de log dos
-- passos anteriores que já tinham funcionado. Na prática, se o passo 20
-- falhasse, você veria só a linha de erro do passo 20 no _smoke_log, sem
-- nenhum rastro dos passos 1 a 19 que passaram — o oposto do que o roteiro
-- promete ("você vê exatamente em qual passo parou").
--
-- A correção: cada passo agora é a sua PRÓPRIA instrução `do $$ ... $$;` no
-- nível mais alto do script (não aninhada dentro de outra). Cada uma começa
-- checando se já existe alguma falha registrada (se sim, grava "PULADO" e
-- sai sem tentar nada) e termina com seu próprio `exception when others`
-- que grava o erro e NÃO relança — então nenhuma exceção nunca escapa de
-- nenhum bloco, a transação nunca aborta, e o log de cada passo já concluído
-- fica permanentemente visível independente do que aconteça depois. Estado
-- que precisa atravessar passos (IDs de usuário, IDs das vendas de teste,
-- arrays de IDs capturados antes da limpeza) fica numa tabela temporária
-- chave/valor (_smoke_state) em vez de variáveis PL/pgSQL locais, já que
-- variáveis locais não sobrevivem entre instruções top-level separadas.
--
-- Toda a lógica de negócio (valores, esperados, ordem, checagens) é
-- EXATAMENTE a mesma da v3/v4 original — nada de novo foi adicionado ou
-- removido além dessa reestruturação.
--
-- Como usar: colar o arquivo inteiro no SQL Editor do Supabase (produção) e
-- rodar uma única vez. Vão aparecer 4 resultados em sequência:
--   1) tabela de evidência linha a linha (_smoke_log, inclui a auditoria);
--   2) veredito agregado (já reflete falha de auditoria, se houver);
--   3) consulta detalhada da auditoria (evidência complementar);
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

create temp table _smoke_state (
  key text primary key,
  value text
) on commit drop;

-- ============================================================================
-- 0a) AUDITORIA — localiza funções chamadas pelo roteiro e triggers das 7
--     tabelas envolvidas, guarda o resultado bruto pra 0b/0c analisarem.
-- ============================================================================
do $$
declare
  v_current_step text := '0a. Auditoria — localizando funcoes chamadas e triggers das 7 tabelas';
  v_funcoes_esperadas text[] := array[
    'criar_lancamento','salvar_divisao_comissao_lancamento','criar_ocorrencia_lancamento',
    'concluir_lancamento','calcular_distribuicao_venda','validar_distribuicao_antes_concluir_lancamento',
    'validate_sale_status_transition','can_view_sale','can_edit_sale_comissao','has_role','has_any_role',
    'set_updated_at'
  ];
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  create temp table _auditoria_funcoes (proname text, origem text, tem_padrao_suspeito boolean) on commit drop;

  insert into _auditoria_funcoes
  select proname, string_agg(distinct origem, '; '), bool_or(suspeito)
  from (
    select p.proname, 'chamada pelo roteiro' as origem,
      (p.prosrc ~* 'pg_notify|pg_net|net\.http|http_post|http_get|extensions\.http|supabase_functions|webhook') as suspeito
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(v_funcoes_esperadas)
    union all
    select p.proname, 'trigger em ' || c.relname as origem,
      (p.prosrc ~* 'pg_notify|pg_net|net\.http|http_post|http_get|extensions\.http|supabase_functions|webhook')
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and n.nspname = 'public'
      and c.relname in ('sales','sale_parties','sale_commission_extras','occurrences','occurrence_commissions','sale_status_history','activity_logs')
  ) x
  group by proname;

  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'tabela de auditoria populada', 'ok', 'OK'
  );
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- 0b) TRAVA — todas as funções obrigatórias precisam ter sido localizadas.
-- ============================================================================
do $$
declare
  v_current_step text := '0b. Auditoria — todas as funcoes obrigatorias foram localizadas?';
  v_funcoes_esperadas text[] := array[
    'criar_lancamento','salvar_divisao_comissao_lancamento','criar_ocorrencia_lancamento',
    'concluir_lancamento','calcular_distribuicao_venda','validar_distribuicao_antes_concluir_lancamento',
    'validate_sale_status_transition','can_view_sale','can_edit_sale_comissao','has_role','has_any_role',
    'set_updated_at'
  ];
  v_funcoes_esperadas_count integer;
  v_funcoes_encontradas_count integer;
  v_funcoes_faltando text[];
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  v_funcoes_esperadas_count := array_length(v_funcoes_esperadas, 1);

  select array_agg(f) into v_funcoes_faltando
  from unnest(v_funcoes_esperadas) f
  where f not in (select proname from _auditoria_funcoes);

  select count(*) into v_funcoes_encontradas_count
  from _auditoria_funcoes where proname = any(v_funcoes_esperadas);

  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step,
    v_funcoes_esperadas_count::text || ' funcoes obrigatorias localizadas',
    v_funcoes_encontradas_count::text || ' localizadas'
      || case when v_funcoes_faltando is not null then '; FALTANDO: ' || array_to_string(v_funcoes_faltando, ', ') else '' end,
    case when v_funcoes_faltando is null then 'OK' else 'FALHA CRITICA' end
  );
  if v_funcoes_faltando is not null then
    raise exception 'CRITICO: funcao(oes) obrigatoria(s) nao localizada(s) no banco (pode indicar renomeacao/remocao inesperada): % — abortando ANTES de qualquer escrita de teste',
      array_to_string(v_funcoes_faltando, ', ');
  end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- 0c) TRAVA — nenhuma função/trigger auditada pode ter padrão de efeito
--     externo (pg_notify/pg_net/http/webhook).
-- ============================================================================
do $$
declare
  v_current_step text := '0c. Auditoria — padrao suspeito de efeito externo (pg_notify/pg_net/http/webhook)';
  v_total_funcoes_auditadas integer;
  v_tem_padrao_suspeito boolean;
  v_funcoes_suspeitas text[];
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select count(*), bool_or(tem_padrao_suspeito), array_agg(proname) filter (where tem_padrao_suspeito)
    into v_total_funcoes_auditadas, v_tem_padrao_suspeito, v_funcoes_suspeitas
  from _auditoria_funcoes;

  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step,
    'nenhuma funcao/trigger com padrao suspeito (de ' || v_total_funcoes_auditadas || ' auditadas)',
    case when v_tem_padrao_suspeito then 'SUSPEITO EM: ' || array_to_string(v_funcoes_suspeitas, ', ') else 'nenhum padrao suspeito encontrado' end,
    case when v_tem_padrao_suspeito then 'FALHA CRITICA' else 'OK' end
  );
  if v_tem_padrao_suspeito then
    raise exception 'CRITICO: funcao(oes)/trigger(s) com padrao de efeito externo (pg_notify/pg_net/http/webhook) encontrada(s): % — abortando ANTES de qualquer escrita de teste',
      array_to_string(v_funcoes_suspeitas, ', ');
  end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- 1) Papel lancamento = exatamente 1, sem alterar nada; seleciona (leitura
--    determinística) o usuário lancamento e o usuário financeiro a usar.
-- ============================================================================
do $$
declare
  v_current_step text := '1. Papel lancamento (contagem, antes)';
  v_lancamento_count integer;
  v_lancamento_user_id uuid;
  v_financeiro_user_id uuid;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select count(*) into v_lancamento_count from public.user_roles where role = 'lancamento';
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '1', v_lancamento_count::text,
    case when v_lancamento_count = 1 then 'OK' else 'FALHA' end
  );
  if v_lancamento_count <> 1 then
    raise exception 'Esperado exatamente 1 usuario com papel lancamento, encontrado %', v_lancamento_count;
  end if;

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

  insert into _smoke_state(key, value) values ('lancamento_user_id', v_lancamento_user_id::text)
    on conflict (key) do update set value = excluded.value;
  insert into _smoke_state(key, value) values ('financeiro_user_id', v_financeiro_user_id::text)
    on conflict (key) do update set value = excluded.value;

  insert into _smoke_log(step, expected, actual, status) values ('1b. Usuario lancamento escolhido (deterministico, UUID apenas)', 'uuid valido', v_lancamento_user_id::text, 'OK');
  insert into _smoke_log(step, expected, actual, status) values ('1c. Usuario financeiro escolhido (deterministico, UUID apenas)', 'uuid valido', v_financeiro_user_id::text, 'OK');
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- 2) Snapshot ANTES das 3 Vendas Normais reais mais recentes.
-- ============================================================================
do $$
declare
  v_current_step text := '2. Snapshot Venda Normal (antes) — exige exatamente 3';
  v_venda_normal_count integer;
  v_row record;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

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
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- SALE A: comissão bruta R$6.000, distribui R$4.000 -> saldo POSITIVO R$2.000
-- ============================================================================
do $$
declare
  v_current_step text := '3. Sale A — criar_lancamento (percentual, saldo positivo esperado)';
  v_lancamento_user_id uuid;
  v_sale_a uuid;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_lancamento_user_id from _smoke_state where key = 'lancamento_user_id';

  perform set_config('request.jwt.claims', json_build_object('sub', v_lancamento_user_id::text, 'role', 'authenticated')::text, true);
  v_sale_a := public.criar_lancamento('ZZ-SMOKE-DEPLOY-TEST-A-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), 'Construtora Smoke Test', '00.000.000/0001-00');
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'uuid nao nulo', coalesce(v_sale_a::text, 'NULL'), case when v_sale_a is not null then 'OK' else 'FALHA' end
  );
  if v_sale_a is null then raise exception 'criar_lancamento (Sale A) nao retornou id'; end if;

  insert into _smoke_state(key, value) values ('sale_a', v_sale_a::text)
    on conflict (key) do update set value = excluded.value;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '4. Sale A — preencher Resumo (negociado 100000, percentual 6% => bruta 6000)';
  v_sale_a uuid;
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';

  update public.sales set valor_negociado = 100000, percentual_comissao = 6, data_assinatura = current_date, midia = 'Portal'
  where id = v_sale_a;
  get diagnostics v_row_count = row_count;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '1 linha atualizada', v_row_count::text, case when v_row_count = 1 then 'OK' else 'FALHA' end
  );
  if v_row_count <> 1 then raise exception 'Sale A: UPDATE do Resumo deveria afetar exatamente 1 linha, afetou %', v_row_count; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '5. Sale A — salvar_divisao_comissao_lancamento (1 linha, R$4000 de R$6000 => saldo R$2000)';
  v_sale_a uuid;
  v_lancamento_user_id uuid;
  v_dist jsonb;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';
  select value::uuid into v_lancamento_user_id from _smoke_state where key = 'lancamento_user_id';

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
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '6. Sale A — criar_ocorrencia_lancamento (SO PERCENTUAL, sem valor_total_comissao)';
  v_sale_a uuid;
  v_dist jsonb;
  v_comissao_bruta numeric;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';

  v_dist := public.criar_ocorrencia_lancamento(v_sale_a);
  v_comissao_bruta := (v_dist->>'comissao_bruta')::numeric;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'comissao_bruta=6000.00 (6% de 100000)', 'comissao_bruta=' || v_comissao_bruta,
    case when v_comissao_bruta = 6000 then 'OK' else 'FALHA' end
  );
  if v_comissao_bruta <> 6000 then raise exception 'Sale A: comissao_bruta esperado 6000, veio %', v_comissao_bruta; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '7. Sale A — occurrences.valor_comissao (derivado do percentual)';
  v_sale_a uuid;
  v_comissao_bruta numeric;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';

  select valor_comissao into v_comissao_bruta from public.occurrences where sale_id = v_sale_a;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '6000.00', coalesce(v_comissao_bruta::text, 'NULL'),
    case when v_comissao_bruta = 6000 then 'OK' else 'FALHA' end
  );
  if v_comissao_bruta <> 6000 then raise exception 'Sale A: occurrences.valor_comissao esperado 6000, veio %', v_comissao_bruta; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '8. Sale A — bloqueio de bypass (UPDATE direto p/ concluida, SEM confirmacao)';
  v_sale_a uuid;
  v_bypass_bloqueado boolean;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';

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
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '9. Sale A — concluir_lancamento (financeiro, saldo confirmado = 2000.00 EXATO)';
  v_sale_a uuid;
  v_financeiro_user_id uuid;
  v_dist jsonb;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';
  select value::uuid into v_financeiro_user_id from _smoke_state where key = 'financeiro_user_id';

  perform set_config('request.jwt.claims', json_build_object('sub', v_financeiro_user_id::text, 'role', 'authenticated')::text, true);
  v_dist := public.concluir_lancamento(v_sale_a, 2000);
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'saldo_imobiliaria=2000.00 (retorno da RPC)', 'saldo=' || (v_dist->>'saldo_imobiliaria'),
    case when (v_dist->>'saldo_imobiliaria')::numeric = 2000 then 'OK' else 'FALHA' end
  );
  if (v_dist->>'saldo_imobiliaria')::numeric <> 2000 then
    raise exception 'Sale A: concluir_lancamento deveria retornar saldo_imobiliaria=2000, veio %', v_dist->>'saldo_imobiliaria';
  end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '10. Sale A — snapshot pos-conclusao (status/saldo=2000/confirmado_em/confirmado_por)';
  v_sale_a uuid;
  v_row record;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';

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
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '11. Sale A — historico de status (sale_status_history)';
  v_sale_a uuid;
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';

  select count(*) into v_row_count from public.sale_status_history where sale_id = v_sale_a;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '>= 2 linhas', v_row_count::text, case when v_row_count >= 2 then 'OK' else 'FALHA' end
  );
  if v_row_count < 2 then raise exception 'Sale A: historico de status deveria ter >= 2 linhas, tem %', v_row_count; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- SALE B: valor_total_comissao explícito R$5.000, distribui os R$5.000 ->
-- saldo ZERO
-- ============================================================================
do $$
declare
  v_current_step text := '12. Sale B — criar_lancamento (valor explicito, saldo zero esperado)';
  v_lancamento_user_id uuid;
  v_sale_b uuid;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_lancamento_user_id from _smoke_state where key = 'lancamento_user_id';

  perform set_config('request.jwt.claims', json_build_object('sub', v_lancamento_user_id::text, 'role', 'authenticated')::text, true);
  v_sale_b := public.criar_lancamento('ZZ-SMOKE-DEPLOY-TEST-B-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), 'Construtora Smoke Test', '00.000.000/0001-00');
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'uuid nao nulo', coalesce(v_sale_b::text, 'NULL'), case when v_sale_b is not null then 'OK' else 'FALHA' end
  );
  if v_sale_b is null then raise exception 'criar_lancamento (Sale B) nao retornou id'; end if;

  insert into _smoke_state(key, value) values ('sale_b', v_sale_b::text)
    on conflict (key) do update set value = excluded.value;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '13. Sale B — preencher Resumo (negociado 100000, valor_total_comissao=5000, sem percentual)';
  v_sale_b uuid;
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_b from _smoke_state where key = 'sale_b';

  update public.sales set valor_negociado = 100000, valor_total_comissao = 5000, data_assinatura = current_date, midia = 'Portal'
  where id = v_sale_b;
  get diagnostics v_row_count = row_count;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '1 linha atualizada', v_row_count::text, case when v_row_count = 1 then 'OK' else 'FALHA' end
  );
  if v_row_count <> 1 then raise exception 'Sale B: UPDATE do Resumo deveria afetar exatamente 1 linha, afetou %', v_row_count; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '13b. Sale B — salvar_divisao_comissao_lancamento (1 linha, R$5000 de R$5000 => saldo 0)';
  v_sale_b uuid;
  v_lancamento_user_id uuid;
  v_dist jsonb;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_b from _smoke_state where key = 'sale_b';
  select value::uuid into v_lancamento_user_id from _smoke_state where key = 'lancamento_user_id';

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
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '14. Sale B — criar_ocorrencia_lancamento (SO valor_total_comissao, sem percentual)';
  v_sale_b uuid;
  v_dist jsonb;
  v_comissao_bruta numeric;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_b from _smoke_state where key = 'sale_b';

  v_dist := public.criar_ocorrencia_lancamento(v_sale_b);
  v_comissao_bruta := (v_dist->>'comissao_bruta')::numeric;
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'comissao_bruta=5000.00', 'comissao_bruta=' || v_comissao_bruta,
    case when v_comissao_bruta = 5000 then 'OK' else 'FALHA' end
  );
  if v_comissao_bruta <> 5000 then raise exception 'Sale B: comissao_bruta esperado 5000, veio %', v_comissao_bruta; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '15. Sale B — concluir_lancamento (financeiro, saldo confirmado = 0.00 EXATO)';
  v_sale_b uuid;
  v_financeiro_user_id uuid;
  v_dist jsonb;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_b from _smoke_state where key = 'sale_b';
  select value::uuid into v_financeiro_user_id from _smoke_state where key = 'financeiro_user_id';

  perform set_config('request.jwt.claims', json_build_object('sub', v_financeiro_user_id::text, 'role', 'authenticated')::text, true);
  v_dist := public.concluir_lancamento(v_sale_b, 0);
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, 'saldo_imobiliaria=0.00 (retorno da RPC)', 'saldo=' || (v_dist->>'saldo_imobiliaria'),
    case when (v_dist->>'saldo_imobiliaria')::numeric = 0 then 'OK' else 'FALHA' end
  );
  if (v_dist->>'saldo_imobiliaria')::numeric <> 0 then
    raise exception 'Sale B: concluir_lancamento deveria retornar saldo_imobiliaria=0, veio %', v_dist->>'saldo_imobiliaria';
  end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '15b. Sale B — historico de status + estado final pos-conclusao';
  v_sale_b uuid;
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_b from _smoke_state where key = 'sale_b';

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
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- Venda Normal: reconfirmar intacta
-- ============================================================================
do $$
declare
  v_current_step text := '16. Venda Normal (depois) — comparar com snapshot de antes';
  v_row record;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

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
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- 17a) CAPTURA de IDs de teste ANTES da limpeza
-- ============================================================================
do $$
declare
  v_current_step text := '17a. Captura de IDs de teste (antes da limpeza)';
  v_sale_a uuid;
  v_sale_b uuid;
  v_occ_ids uuid[];
  v_occ_comm_ids uuid[];
  v_sce_ids uuid[];
  v_ssh_ids uuid[];
  v_al_ids uuid[];
  v_sp_ids uuid[];
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';
  select value::uuid into v_sale_b from _smoke_state where key = 'sale_b';

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
  if coalesce(array_length(v_occ_ids,1),0) <> 2 or coalesce(array_length(v_occ_comm_ids,1),0) <> 2
     or coalesce(array_length(v_sce_ids,1),0) <> 2 then
    raise exception 'CRITICO: contagem de IDs capturados fora do esperado (occurrences=%, occurrence_commissions=%, sale_commission_extras=%) — abortando antes da limpeza',
      coalesce(array_length(v_occ_ids,1),0), coalesce(array_length(v_occ_comm_ids,1),0), coalesce(array_length(v_sce_ids,1),0);
  end if;

  insert into _smoke_state(key, value) values ('occ_ids', v_occ_ids::text) on conflict (key) do update set value = excluded.value;
  insert into _smoke_state(key, value) values ('occ_comm_ids', v_occ_comm_ids::text) on conflict (key) do update set value = excluded.value;
  insert into _smoke_state(key, value) values ('sce_ids', v_sce_ids::text) on conflict (key) do update set value = excluded.value;
  insert into _smoke_state(key, value) values ('ssh_ids', v_ssh_ids::text) on conflict (key) do update set value = excluded.value;
  insert into _smoke_state(key, value) values ('al_ids', v_al_ids::text) on conflict (key) do update set value = excluded.value;
  insert into _smoke_state(key, value) values ('sp_ids', v_sp_ids::text) on conflict (key) do update set value = excluded.value;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- 17b) LIMPEZA por ID capturado — ordem respeita FKs
-- ============================================================================
do $$
declare
  v_current_step text := '17b. Limpeza dos dados de teste (por ID capturado)';
  v_sale_a uuid;
  v_sale_b uuid;
  v_occ_ids uuid[];
  v_occ_comm_ids uuid[];
  v_sce_ids uuid[];
  v_ssh_ids uuid[];
  v_al_ids uuid[];
  v_sp_ids uuid[];
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;

  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';
  select value::uuid into v_sale_b from _smoke_state where key = 'sale_b';
  select value::uuid[] into v_occ_ids from _smoke_state where key = 'occ_ids';
  select value::uuid[] into v_occ_comm_ids from _smoke_state where key = 'occ_comm_ids';
  select value::uuid[] into v_sce_ids from _smoke_state where key = 'sce_ids';
  select value::uuid[] into v_ssh_ids from _smoke_state where key = 'ssh_ids';
  select value::uuid[] into v_al_ids from _smoke_state where key = 'al_ids';
  select value::uuid[] into v_sp_ids from _smoke_state where key = 'sp_ids';

  delete from public.occurrence_commissions where id = any(coalesce(v_occ_comm_ids, array[]::uuid[]));
  delete from public.occurrences where id = any(coalesce(v_occ_ids, array[]::uuid[]));
  delete from public.sale_status_history where id = any(coalesce(v_ssh_ids, array[]::uuid[]));
  delete from public.activity_logs where id = any(coalesce(v_al_ids, array[]::uuid[]));
  delete from public.sale_commission_extras where id = any(coalesce(v_sce_ids, array[]::uuid[]));
  delete from public.sale_parties where id = any(coalesce(v_sp_ids, array[]::uuid[]));
  delete from public.sales where id in (v_sale_a, v_sale_b);
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, 'DELETE por ID em 7 tabelas', 'executado', 'OK');
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

-- ============================================================================
-- Verificação de resíduo — as 7 tabelas, direto pelos IDs capturados
-- ============================================================================
do $$
declare
  v_current_step text := '18a. Residuo — sales (por ID direto: v_sale_a, v_sale_b)';
  v_sale_a uuid;
  v_sale_b uuid;
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;
  select value::uuid into v_sale_a from _smoke_state where key = 'sale_a';
  select value::uuid into v_sale_b from _smoke_state where key = 'sale_b';
  select count(*) into v_row_count from public.sales where id in (v_sale_a, v_sale_b);
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em sales apos limpeza'; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '18b. Residuo — occurrences (por IDs capturados em 17a)';
  v_occ_ids uuid[];
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;
  select value::uuid[] into v_occ_ids from _smoke_state where key = 'occ_ids';
  select count(*) into v_row_count from public.occurrences where id = any(coalesce(v_occ_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em occurrences apos limpeza'; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '18c. Residuo — occurrence_commissions (por IDs capturados em 17a)';
  v_occ_comm_ids uuid[];
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;
  select value::uuid[] into v_occ_comm_ids from _smoke_state where key = 'occ_comm_ids';
  select count(*) into v_row_count from public.occurrence_commissions where id = any(coalesce(v_occ_comm_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em occurrence_commissions apos limpeza'; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '18d. Residuo — sale_status_history (por IDs capturados em 17a)';
  v_ssh_ids uuid[];
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;
  select value::uuid[] into v_ssh_ids from _smoke_state where key = 'ssh_ids';
  select count(*) into v_row_count from public.sale_status_history where id = any(coalesce(v_ssh_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em sale_status_history apos limpeza'; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '18e. Residuo — activity_logs (por IDs capturados em 17a)';
  v_al_ids uuid[];
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;
  select value::uuid[] into v_al_ids from _smoke_state where key = 'al_ids';
  select count(*) into v_row_count from public.activity_logs where id = any(coalesce(v_al_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em activity_logs apos limpeza'; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '18f. Residuo — sale_commission_extras (por IDs capturados em 17a)';
  v_sce_ids uuid[];
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;
  select value::uuid[] into v_sce_ids from _smoke_state where key = 'sce_ids';
  select count(*) into v_row_count from public.sale_commission_extras where id = any(coalesce(v_sce_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em sale_commission_extras apos limpeza'; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '18g. Residuo — sale_parties (por IDs capturados em 17a)';
  v_sp_ids uuid[];
  v_row_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;
  select value::uuid[] into v_sp_ids from _smoke_state where key = 'sp_ids';
  select count(*) into v_row_count from public.sale_parties where id = any(coalesce(v_sp_ids, array[]::uuid[]));
  insert into _smoke_log(step, expected, actual, status) values (v_current_step, '0 linhas', v_row_count::text, case when v_row_count = 0 then 'OK' else 'FALHA CRITICA' end);
  if v_row_count <> 0 then raise exception 'CRITICO: residuo de dados de teste em sale_parties apos limpeza'; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := '19. Papel lancamento (contagem, depois — precisa continuar 1)';
  v_lancamento_count integer;
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;
  select count(*) into v_lancamento_count from public.user_roles where role = 'lancamento';
  insert into _smoke_log(step, expected, actual, status) values (
    v_current_step, '1', v_lancamento_count::text, case when v_lancamento_count = 1 then 'OK' else 'FALHA CRITICA' end
  );
  if v_lancamento_count <> 1 then raise exception 'CRITICO: contagem de papel lancamento mudou durante o teste'; end if;
exception when others then
  insert into _smoke_log(step, expected, actual, status)
  values (v_current_step, 'sem erro', 'ERRO: ' || sqlerrm, 'FALHA — PAROU AQUI');
end $$;

do $$
declare
  v_current_step text := 'FIM — todos os checks concluidos';
begin
  if exists (select 1 from _smoke_log where status like 'FALHA%') then
    insert into _smoke_log(step, expected, actual, status) values (v_current_step, '-', '-', 'PULADO (falha anterior)');
    return;
  end if;
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
      then 'TODOS OS CHECKS APROVADOS (INCLUINDO A AUDITORIA DE EFEITO EXTERNO) — NENHUM DADO PERSISTE (ROLLBACK a seguir)'
    else 'HA FALHA — NAO PROSSEGUIR — NENHUM DADO PERSISTE (ROLLBACK a seguir)'
  end as veredito
from _smoke_log;

-- ============================================================================
-- AUDITORIA DE EFEITO EXTERNO — EVIDÊNCIA COMPLEMENTAR (a trava real já rodou
-- no passo 0, dentro da transação, e já reprovou o veredito acima se algo
-- estivesse errado). Esta consulta só existe pra você ver o detalhe função a
-- função — não é ela quem decide se o script para.
-- ============================================================================
select proname as funcao, origem, tem_padrao_suspeito
from _auditoria_funcoes
order by tem_padrao_suspeito desc, proname;

-- verificação independente de resíduo por padrão de nome (não depende de variável nenhuma)
select 'residual sales por padrao de nome (ZZ-SMOKE-DEPLOY-TEST-%)' as verificacao, count(*) as linhas
from public.sales where imovel_id like 'ZZ-SMOKE-DEPLOY-TEST-%';

rollback;
