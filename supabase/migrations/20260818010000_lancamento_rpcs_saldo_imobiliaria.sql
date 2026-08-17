-- Duas RPCs novas + 1 trigger, todas restritas a modalidade = 'lancamento' — nenhuma toca no fluxo
-- da Venda Normal (nenhuma delas roda pra modalidade = 'padrao', e nenhuma migration anterior foi
-- alterada além da anterior a esta, que só adicionou um branch isolado).
--
-- 1) salvar_divisao_comissao_lancamento(): substitui as 3 chamadas separadas que o front fazia direto
--    em sale_commission_extras (delete/update/insert em loop, sem transação) por UMA operação
--    atômica — evita o falso-positivo de bloquear um estado intermediário válido (ex.: tirar R$500 de
--    uma linha e somar R$500 em outra, se validado passo a passo, poderia rejeitar um instante que
--    nunca existiu de fato). Bloqueia (ROLLBACK) só quando o resultado FINAL ultrapassa a comissão
--    bruta em mais de R$0,01 — rascunho incompleto (bruto ainda não definido, ou pessoas somando
--    menos que o bruto) sempre passa.
--
-- 2) concluir_lancamento(): substitui o change_sale_status genérico usado hoje pelo botão "Concluir
--    ocorrência" do Lançamento. Exige o saldo da imobiliária/construtora confirmado explicitamente
--    pelo financeiro (protege contra tela desatualizada — se o valor não bater com o recalculado no
--    servidor, rejeita) e grava esse valor nas 3 colunas novas de sales, além do sale_status_history/
--    activity_logs de sempre.
--
-- 3) trg_validar_distribuicao_concluir_lancamento: a proteção "de verdade" no banco, igual ao padrão
--    já usado pra Venda Normal (trg_validar_distribuicao_aprovar_gestor/trg_validar_distribuicao_occ_critica)
--    — bloqueia a transição sales.status -> 'ocorrencia_concluida' pra modalidade = 'lancamento' mesmo
--    que alguém tente contornar concluir_lancamento() com um UPDATE direto. Só dispara na TRANSIÇÃO
--    (OLD.status distinct from NEW.status), então os 5 lançamentos já concluídos hoje não são
--    revalidados por essa trigger — só se alguém reabrir e tentar concluir de novo.

create or replace function public.salvar_divisao_comissao_lancamento(p_sale_id uuid, p_linhas jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sale sales%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_dist jsonb;
  v_linha jsonb;
  v_ids_mantidos uuid[] := '{}';
  v_id uuid;
begin
  -- FOR UPDATE: trava a linha de sales pelo resto desta transação — serializa contra
  -- concluir_lancamento() rodando em paralelo pra mesma venda (que também trava com FOR UPDATE).
  -- Sem isso, uma edição de comissão e uma conclusão concorrentes poderiam intercalar: a conclusão
  -- lê o saldo ANTES da edição terminar de gravar, confirma um snapshot que já nasce desatualizado
  -- assim que a edição commita.
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.modalidade <> 'lancamento' then
    raise exception 'Esta venda não é uma venda de Lançamento.' using errcode = '23514';
  end if;

  if not public.can_edit_sale_comissao(auth.uid(), p_sale_id) then
    raise exception 'Sem permissão para editar a divisão de comissão desta venda.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'papel', papel, 'nome', nome, 'user_id', user_id,
      'percentual', percentual, 'valor', valor, 'sem_cadastro_confirmado', sem_cadastro_confirmado
    ) order by created_at), '[]'::jsonb)
    into v_before
  from sale_commission_extras where sale_id = p_sale_id;

  for v_linha in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb))
  loop
    v_id := nullif(v_linha->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from sale_commission_extras where id = v_id and sale_id = p_sale_id) then
      update sale_commission_extras set
        papel = v_linha->>'papel',
        nome = nullif(v_linha->>'nome', ''),
        user_id = nullif(v_linha->>'user_id', '')::uuid,
        percentual = (v_linha->>'percentual')::numeric,
        valor = (v_linha->>'valor')::numeric,
        sem_cadastro_confirmado = coalesce((v_linha->>'sem_cadastro_confirmado')::boolean, false)
      where id = v_id;
    else
      insert into sale_commission_extras (sale_id, papel, nome, user_id, percentual, valor, sem_cadastro_confirmado)
      values (
        p_sale_id, v_linha->>'papel', nullif(v_linha->>'nome', ''), nullif(v_linha->>'user_id', '')::uuid,
        (v_linha->>'percentual')::numeric, (v_linha->>'valor')::numeric,
        coalesce((v_linha->>'sem_cadastro_confirmado')::boolean, false)
      )
      returning id into v_id;
    end if;
    v_ids_mantidos := v_ids_mantidos || v_id;
  end loop;

  delete from sale_commission_extras
  where sale_id = p_sale_id and not (id = any(v_ids_mantidos));

  v_dist := public.calcular_distribuicao_venda(p_sale_id);

  -- Bloqueio imediato: só quando já existe uma comissão bruta definida E o resultado final
  -- ultrapassa em mais de R$0,01 — rascunho incompleto (sem valor_negociado/valor_total_comissao
  -- ainda, ou pessoas somando menos que o bruto) nunca é rejeitado aqui.
  if (v_dist->>'comissao_bruta')::numeric > 0 and (v_dist->>'saldo_imobiliaria')::numeric < -0.01 then
    raise exception 'A soma das comissões (R$ %) ultrapassa a comissão bruta (R$ %) em R$ %.',
      round((v_dist->>'total_pessoas')::numeric + (v_dist->>'parceria_externa')::numeric, 2),
      round((v_dist->>'comissao_bruta')::numeric, 2),
      round(abs((v_dist->>'saldo_imobiliaria')::numeric), 2)
      using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'papel', papel, 'nome', nome, 'user_id', user_id,
      'percentual', percentual, 'valor', valor, 'sem_cadastro_confirmado', sem_cadastro_confirmado
    ) order by created_at), '[]'::jsonb)
    into v_after
  from sale_commission_extras where sale_id = p_sale_id;

  if v_before is distinct from v_after then
    insert into activity_logs (autor_id, sale_id, acao, payload)
    values (auth.uid(), p_sale_id, 'lancamento_comissao_editada', jsonb_build_object('antes', v_before, 'depois', v_after));
  end if;

  -- 'linhas' (com os ids reais, inclusive das linhas recém-inseridas) vai junto no retorno pra o
  -- front-end resincronizar o estado local sem precisar de uma segunda consulta — troca os ids
  -- temporários (gerados no cliente pra novas linhas) pelos ids reais do banco.
  return v_dist || jsonb_build_object('linhas', v_after);
end;
$function$;

revoke execute on function public.salvar_divisao_comissao_lancamento(uuid, jsonb) from public;
revoke execute on function public.salvar_divisao_comissao_lancamento(uuid, jsonb) from anon;
grant execute on function public.salvar_divisao_comissao_lancamento(uuid, jsonb) to authenticated;

create or replace function public.concluir_lancamento(p_sale_id uuid, p_saldo_confirmado numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sale sales%rowtype;
  v_dist jsonb;
  v_saldo numeric;
begin
  if not public.can_view_sale(auth.uid(), p_sale_id) then
    raise exception 'Sem permissão para acessar esta venda.' using errcode = '42501';
  end if;

  if not public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]) then
    raise exception 'Apenas o financeiro pode concluir a ocorrência.' using errcode = '42501';
  end if;

  -- FOR UPDATE: mesma trava de salvar_divisao_comissao_lancamento() — ver comentário lá.
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.modalidade <> 'lancamento' then
    raise exception 'Esta venda não é uma venda de Lançamento.' using errcode = '23514';
  end if;

  if v_sale.status::text <> 'ocorrencia_analise_financeiro' then
    raise exception 'Esta venda não está em análise do financeiro.' using errcode = '23505';
  end if;

  v_dist := public.calcular_distribuicao_venda(p_sale_id);
  if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível concluir este lançamento: %', (
      select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
    ) using errcode = '23514';
  end if;

  v_saldo := (v_dist->>'saldo_imobiliaria')::numeric;
  if p_saldo_confirmado is null or abs(p_saldo_confirmado - v_saldo) > 0.01 then
    raise exception 'O saldo confirmado (R$ %) não corresponde ao saldo calculado agora (R$ %) — recarregue a página e confirme novamente.',
      round(coalesce(p_saldo_confirmado, 0), 2), round(v_saldo, 2)
      using errcode = '23514';
  end if;

  update sales set
    status = 'ocorrencia_concluida',
    lancamento_saldo_imobiliaria = v_saldo,
    lancamento_saldo_confirmado_em = now(),
    lancamento_saldo_confirmado_por = auth.uid()
  where id = p_sale_id;

  insert into sale_status_history (sale_id, de, para, autor_id, motivo)
  values (p_sale_id, v_sale.status, 'ocorrencia_concluida'::sale_status, auth.uid(),
    'Saldo da imobiliária/construtora confirmado: R$ ' || round(v_saldo, 2));

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'status_change', jsonb_build_object('de', v_sale.status, 'para', 'ocorrencia_concluida'));

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'lancamento_concluido', jsonb_build_object(
    'comissao_bruta', v_dist->'comissao_bruta',
    'total_pessoas', v_dist->'total_pessoas',
    'parceria_externa', v_dist->'parceria_externa',
    'saldo_imobiliaria', v_saldo
  ));

  return public.calcular_distribuicao_venda(p_sale_id);
end;
$function$;

revoke execute on function public.concluir_lancamento(uuid, numeric) from public;
revoke execute on function public.concluir_lancamento(uuid, numeric) from anon;
grant execute on function public.concluir_lancamento(uuid, numeric) to authenticated;

-- Trigger de segurança no banco — independente das duas RPCs acima, bloqueia a transição mesmo se
-- alguém contornar concluir_lancamento() com um UPDATE direto em sales.
--
-- Exige as 4 condições SIMULTANEAMENTE (revisão pós-commit anterior: a versão original só checava
-- calculo_valido, então um UPDATE direto com valores matematicamente corretos mas sem passar pela
-- confirmação explícita do financeiro conseguia concluir mesmo assim — o snapshot de auditoria
-- ficava null, mas a venda concluía). Agora um UPDATE direto só passa se TAMBÉM preencher os 3
-- campos de confirmação com um valor que bate com o saldo recalculado — na prática, só
-- concluir_lancamento() consegue satisfazer isso de forma legítima, porque ele grava os 4 valores
-- (status + os 3 campos) numa única instrução, todos vindos do MESMO cálculo servidor.
create or replace function public.validar_distribuicao_antes_concluir_lancamento()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare
  v_dist jsonb;
  v_saldo_recalculado numeric;
begin
  if NEW.modalidade = 'lancamento' and NEW.status::text = 'ocorrencia_concluida' and OLD.status::text is distinct from NEW.status::text then
    v_dist := public.calcular_distribuicao_venda(NEW);

    if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
      raise exception 'Não é possível concluir este lançamento: %', (
        select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
      ) using errcode = '23514';
    end if;

    v_saldo_recalculado := (v_dist->>'saldo_imobiliaria')::numeric;
    if NEW.lancamento_saldo_imobiliaria is null or abs(NEW.lancamento_saldo_imobiliaria - v_saldo_recalculado) > 0.01 then
      raise exception 'Não é possível concluir este lançamento: o saldo da imobiliária/construtora não foi confirmado (ou está desatualizado) — use concluir_lancamento().' using errcode = '23514';
    end if;

    if NEW.lancamento_saldo_confirmado_em is null then
      raise exception 'Não é possível concluir este lançamento: falta a data/hora de confirmação do saldo — use concluir_lancamento().' using errcode = '23514';
    end if;

    if NEW.lancamento_saldo_confirmado_por is null then
      raise exception 'Não é possível concluir este lançamento: falta o responsável pela confirmação do saldo — use concluir_lancamento().' using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_validar_distribuicao_concluir_lancamento on public.sales;
create trigger trg_validar_distribuicao_concluir_lancamento
  before update on public.sales
  for each row
  execute function public.validar_distribuicao_antes_concluir_lancamento();
