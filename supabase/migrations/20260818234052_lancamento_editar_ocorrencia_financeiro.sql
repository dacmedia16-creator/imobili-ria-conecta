-- Pedido do usuário: financeiro precisa de um botão "Editar" na ocorrência de Lançamento, em vez de
-- só "Devolver" (manda de volta pro corretor/coordenador) ou "Concluir". Investigação prévia achou a
-- causa raiz de por que uma edição ingênua (escrever direto em occurrences/occurrence_commissions)
-- não funcionaria:
--
-- MAPA DAS DUAS FONTES DE DADOS (Lançamento):
--   1) sales + sale_commission_extras — fonte VIVA. calcular_distribuicao_venda() (usada por
--      "Comissão bruta"/"Saldo da imobiliária" e pelo gate de concluir_lancamento()) sempre lê daqui,
--      pra QUALQUER status — nunca lê occurrence_commissions pra Lançamento.
--   2) occurrences + occurrence_commissions — o "livro-razão" gravado (snapshot), usado pra exibir o
--      relatório impresso E como fonte real de dashboard/ranking/comissões a receber
--      (visao_executiva_stats() e afins agregam por occurrence_commissions.user_id/valor).
--   Essas duas fontes só se sincronizam em criar_ocorrencia_lancamento() (criação e reenvio), que só
--   roda com status IN ('rascunho','devolvida_ajuste') — nunca em 'ocorrencia_analise_financeiro'.
--   Por isso editar só uma fonte deixa a outra desatualizada (confirmado manualmente: editar
--   occurrence_commissions não mudava a "Comissão bruta" exibida, que continuava vindo de
--   sale_commission_extras).
--
-- PERMISSÕES ATUAIS (levantadas antes de implementar, ver relatório de entrega) — esta RPC preserva
-- exatamente o que já é o acesso PRÁTICO ao fluxo financeiro do Lançamento, sem ampliar nem reduzir:
--   - Frontend (LancamentoDetail.tsx): só financeiro/admin/super_admin (isFinanceiro) veem qualquer
--     ação sobre a ocorrência em análise (Devolver/Concluir). Gestor/team_leader não veem nada aqui.
--   - concluir_lancamento() já existente: exige has_any_role(financeiro/admin/super_admin).
--   - validate_sale_status_transition() (trigger): pra modalidade='lancamento', só financeiro (mais
--     admin/super_admin, que sempre passam) pode transicionar ocorrencia_analise_financeiro <-> outros
--     status financeiro-específicos. Gestor/team_leader não têm NENHUMA regra de transição pro estágio
--     financeiro do Lançamento (mesmo a RLS genérica de occurrences/occurrence_commissions sendo mais
--     ampla — essa RLS é herdada do fluxo de Venda Normal, nunca teve UI equivalente pro Lançamento).
--   Conclusão: financeiro/admin/super_admin é o conjunto que já tem acesso prático real — é o que
--   esta RPC exige, explicitamente (não via can_edit_sale_comissao(), que tem cláusulas de
--   dono-em-rascunho e gestor/team_leader-em-outros-status irrelevantes aqui e que poderiam confundir
--   uma leitura futura desta função).
--
-- STATUS PERMITIDO PRA EDIÇÃO: só 'ocorrencia_analise_financeiro' (checado explicitamente, allowlist
-- de um único valor) — exclui por construção rascunho, devolvida_ajuste, ocorrencia_concluida,
-- cancelada, arquivada e qualquer outro. "Venda errada" (id inexistente ou modalidade != lancamento)
-- também é rejeitada explicitamente antes de qualquer escrita.
--
-- ATOMICIDADE: uma única função PL/pgSQL, uma única transação do ponto de vista do chamador — QUALQUER
-- exceção (permissão, status, validação de distribuição inválida, etc.) reverte 100% das escritas já
-- feitas nesta chamada (sales, sale_commission_extras, occurrences, occurrence_commissions, activity_logs
-- nunca fica com só metade da edição aplicada).
--
-- SEM DUPLICIDADE / REEXECUÇÃO SEGURA: sale_commission_extras é identificado por id (update se veio
-- com id existente da venda, insert se não veio id, delete o que não voltou na lista — mesma lógica já
-- comprovada de salvar_divisao_comissao_lancamento()). occurrence_commissions NUNCA é diferenciado
-- linha a linha — é sempre "apaga tudo que é derivado de sale_commission_extras (sale_commission_extra_id
-- not null) e reinsere do zero a partir do sale_commission_extras atual", exatamente a mesma técnica já
-- usada e testada em criar_ocorrencia_lancamento() (branch de reenvio) — chamar esta RPC 2x seguidas
-- com o mesmo payload não duplica nada (mesma contagem de linhas, mesmos ids linkados por
-- sale_commission_extra_id).
--
-- CONCORRÊNCIA: "select ... from sales where id = p_sale_id for update" trava a linha de sales pelo
-- resto da transação — mesma trava que salvar_divisao_comissao_lancamento()/concluir_lancamento() já
-- usam entre si, então esta RPC serializa corretamente contra as duas (uma edição concorrente espera a
-- outra terminar, nunca lê um estado parcial).
--
-- AUDITORIA: activity_logs (mesma tabela já usada por lancamento_editado/lancamento_comissao_editada/
-- lancamento_concluido — nenhuma tabela nova) recebe uma linha 'lancamento_editado_financeiro' por
-- chamada bem-sucedida, com autor_id (usuário) + created_at (data, coluna própria da tabela) +
-- motivo obrigatório (validado no início da função, rejeita vazio/nulo) + só os campos que
-- REALMENTE mudaram (antes/depois), nunca um dump da linha inteira — evita registrar dados
-- irrelevantes ao mesmo tempo que não expõe nada que o financeiro já não veja rotineiramente na tela.
create or replace function public.editar_ocorrencia_lancamento_financeiro(
  p_sale_id uuid,
  p_sale_patch jsonb,
  p_occ_patch jsonb,
  p_linhas jsonb,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale sales%rowtype;
  v_occ_id uuid;
  v_comprador_nome text;
  v_dist jsonb;
  v_comissao_bruta numeric;
  v_linha jsonb;
  v_ids_mantidos uuid[] := '{}';
  v_id uuid;
  v_before_sale_j jsonb;
  v_after_sale_j jsonb;
  v_before_occ_j jsonb;
  v_after_occ_j jsonb;
  v_before_linhas jsonb;
  v_after_linhas jsonb;
  v_sale_diff jsonb := '{}'::jsonb;
  v_occ_diff jsonb := '{}'::jsonb;
  v_field text;
  v_sale_fields constant text[] := array[
    'imovel_id','data_assinatura','tempo_venda_dias','midia','nota_fiscal_obrigatoria',
    'valor_anunciado','valor_negociado','percentual_comissao','valor_total_comissao','premio_valor',
    'previsao_recebimento_valor','previsao_recebimento_data','previsao_recebimento_forma',
    'previsao_recebimento2_valor','previsao_recebimento2_data','previsao_recebimento2_forma',
    'previsao_recebimento3_valor','previsao_recebimento3_data','previsao_recebimento3_forma',
    'negociacao_observacoes'
  ];
  v_occ_fields constant text[] := array[
    'financiamento','financiamento_valor','financiamento_banco','financiamento_correspondente',
    'financiamento_previsao','oba_credito'
  ];
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Motivo da alteração é obrigatório.' using errcode = '23514';
  end if;

  if not public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]) then
    raise exception 'Apenas o financeiro pode editar a ocorrência de Lançamento nesta etapa.' using errcode = '42501';
  end if;

  -- FOR UPDATE: mesma trava de salvar_divisao_comissao_lancamento()/concluir_lancamento() — serializa
  -- contra edição/conclusão concorrentes da MESMA venda (ver comentário no topo do arquivo).
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.modalidade <> 'lancamento' then
    raise exception 'Esta venda não é uma venda de Lançamento.' using errcode = '23514';
  end if;

  if v_sale.status::text <> 'ocorrencia_analise_financeiro' then
    raise exception 'Só é possível editar enquanto a ocorrência está em análise do financeiro (status atual: %).', v_sale.status
      using errcode = '23514';
  end if;

  select id into v_occ_id from occurrences where sale_id = p_sale_id;
  if v_occ_id is null then
    raise exception 'Ocorrência desta venda não encontrada.' using errcode = 'P0002';
  end if;

  v_before_sale_j := to_jsonb(v_sale);
  select to_jsonb(o) into v_before_occ_j from occurrences o where o.id = v_occ_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'papel', papel, 'nome', nome, 'user_id', user_id,
      'percentual', percentual, 'valor', valor, 'sem_cadastro_confirmado', sem_cadastro_confirmado
    ) order by created_at), '[]'::jsonb)
    into v_before_linhas
  from sale_commission_extras where sale_id = p_sale_id;

  -- ===== 1) Resumo (sales) — mesmos campos que o formulário de rascunho já edita; cliente sempre
  -- manda o payload completo (mesma convenção de saveForm() em LancamentoDetail.tsx). =====
  update sales set
    imovel_id = nullif(p_sale_patch->>'imovel_id', ''),
    data_assinatura = nullif(p_sale_patch->>'data_assinatura', '')::date,
    tempo_venda_dias = (p_sale_patch->>'tempo_venda_dias')::integer,
    midia = nullif(p_sale_patch->>'midia', ''),
    nota_fiscal_obrigatoria = coalesce((p_sale_patch->>'nota_fiscal_obrigatoria')::boolean, false),
    valor_anunciado = (p_sale_patch->>'valor_anunciado')::numeric,
    valor_negociado = (p_sale_patch->>'valor_negociado')::numeric,
    percentual_comissao = (p_sale_patch->>'percentual_comissao')::numeric,
    valor_total_comissao = (p_sale_patch->>'valor_total_comissao')::numeric,
    premio_valor = (p_sale_patch->>'premio_valor')::numeric,
    previsao_recebimento_valor = (p_sale_patch->>'previsao_recebimento_valor')::numeric,
    previsao_recebimento_data = nullif(p_sale_patch->>'previsao_recebimento_data', '')::date,
    previsao_recebimento_forma = nullif(p_sale_patch->>'previsao_recebimento_forma', ''),
    previsao_recebimento2_valor = (p_sale_patch->>'previsao_recebimento2_valor')::numeric,
    previsao_recebimento2_data = nullif(p_sale_patch->>'previsao_recebimento2_data', '')::date,
    previsao_recebimento2_forma = nullif(p_sale_patch->>'previsao_recebimento2_forma', ''),
    previsao_recebimento3_valor = (p_sale_patch->>'previsao_recebimento3_valor')::numeric,
    previsao_recebimento3_data = nullif(p_sale_patch->>'previsao_recebimento3_data', '')::date,
    previsao_recebimento3_forma = nullif(p_sale_patch->>'previsao_recebimento3_forma', ''),
    negociacao_observacoes = nullif(p_sale_patch->>'negociacao_observacoes', '')
  where id = p_sale_id;

  select * into v_sale from sales where id = p_sale_id;

  -- ===== 2) Divisão da comissão (sale_commission_extras) — mesma lógica de identificação/update/
  -- insert/delete de salvar_divisao_comissao_lancamento(), copiada aqui de propósito (não chamada por
  -- referência) pra manter esta função autocontida e não depender de mudanças futuras naquela RPC. =====
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

  -- ===== 3) Recalcula e valida — mesma RPC que "Comissão bruta"/"Saldo da imobiliária"/o gate do
  -- Concluir já usam, agora já refletindo o patch acima. =====
  v_dist := public.calcular_distribuicao_venda(p_sale_id);
  v_comissao_bruta := (v_dist->>'comissao_bruta')::numeric;
  if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível salvar: %', (
      select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
    ) using errcode = '23514';
  end if;

  -- ===== 4) Campos só-da-ocorrência (financiamento) — não têm equivalente em sales, sempre foram
  -- preenchidos direto na ocorrência (criar_ocorrencia_lancamento nunca grava financiamento_*). =====
  update occurrences set
    financiamento = coalesce((p_occ_patch->>'financiamento')::boolean, false),
    financiamento_valor = (p_occ_patch->>'financiamento_valor')::numeric,
    financiamento_banco = nullif(p_occ_patch->>'financiamento_banco', ''),
    financiamento_correspondente = nullif(p_occ_patch->>'financiamento_correspondente', ''),
    financiamento_previsao = nullif(p_occ_patch->>'financiamento_previsao', '')::date,
    oba_credito = coalesce((p_occ_patch->>'oba_credito')::boolean, false)
  where id = v_occ_id;

  -- ===== 5) Sincroniza occurrences (campos derivados de sales) + occurrence_commissions — MESMA
  -- técnica do branch de reenvio de criar_ocorrencia_lancamento() (delete+reinsert das linhas
  -- derivadas de sale_commission_extras, update dos campos espelhados em occurrences). =====
  select nome into v_comprador_nome from sale_parties where sale_id = p_sale_id and papel = 'comprador_1';

  update occurrences set
    codigo_imovel = coalesce(v_sale.imovel_id, v_sale.codigo_interno),
    data_assinatura = v_sale.data_assinatura,
    tempo_venda_dias = v_sale.tempo_venda_dias,
    midia = v_sale.midia,
    valor_anunciado = v_sale.valor_anunciado,
    valor_negociado = v_sale.valor_negociado,
    percentual_comissao = v_sale.percentual_comissao,
    valor_comissao = v_comissao_bruta,
    premio_valor = v_sale.premio_valor,
    nota_fiscal_obrigatoria = v_sale.nota_fiscal_obrigatoria,
    prev_recebimento_valor = v_sale.previsao_recebimento_valor,
    prev_recebimento_data = v_sale.previsao_recebimento_data,
    prev_recebimento_forma = v_sale.previsao_recebimento_forma,
    prev_recebimento2_valor = v_sale.previsao_recebimento2_valor,
    prev_recebimento2_data = v_sale.previsao_recebimento2_data,
    prev_recebimento2_forma = v_sale.previsao_recebimento2_forma,
    prev_recebimento3_valor = v_sale.previsao_recebimento3_valor,
    prev_recebimento3_data = v_sale.previsao_recebimento3_data,
    prev_recebimento3_forma = v_sale.previsao_recebimento3_forma,
    observacoes = coalesce(
      v_sale.negociacao_observacoes,
      nullif(concat_ws(' | ', case when v_comprador_nome is not null then 'Comprador: ' || v_comprador_nome end), '')
    )
  where id = v_occ_id;

  delete from occurrence_commissions where occurrence_id = v_occ_id and sale_commission_extra_id is not null;
  insert into occurrence_commissions (occurrence_id, papel, nome, user_id, percentual, valor, sale_commission_extra_id, managed_by_sale, sem_cadastro_confirmado)
  select v_occ_id, e.papel, e.nome, e.user_id, e.percentual, e.valor, e.id, true, e.sem_cadastro_confirmado
  from sale_commission_extras e
  where e.sale_id = p_sale_id;

  -- ===== 6) Auditoria — só os campos que mudaram, nunca a linha inteira. =====
  select to_jsonb(v_sale) into v_after_sale_j;
  select to_jsonb(o) into v_after_occ_j from occurrences o where o.id = v_occ_id;

  foreach v_field in array v_sale_fields loop
    if (v_before_sale_j -> v_field) is distinct from (v_after_sale_j -> v_field) then
      v_sale_diff := v_sale_diff || jsonb_build_object(v_field, jsonb_build_object('de', v_before_sale_j -> v_field, 'para', v_after_sale_j -> v_field));
    end if;
  end loop;
  foreach v_field in array v_occ_fields loop
    if (v_before_occ_j -> v_field) is distinct from (v_after_occ_j -> v_field) then
      v_occ_diff := v_occ_diff || jsonb_build_object(v_field, jsonb_build_object('de', v_before_occ_j -> v_field, 'para', v_after_occ_j -> v_field));
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'papel', papel, 'nome', nome, 'user_id', user_id,
      'percentual', percentual, 'valor', valor, 'sem_cadastro_confirmado', sem_cadastro_confirmado
    ) order by created_at), '[]'::jsonb)
    into v_after_linhas
  from sale_commission_extras where sale_id = p_sale_id;

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'lancamento_editado_financeiro', jsonb_build_object(
    'motivo', p_motivo,
    'resumo_alteracoes', v_sale_diff,
    'financiamento_alteracoes', v_occ_diff,
    'comissao_antes', v_before_linhas,
    'comissao_depois', v_after_linhas
  ));

  return v_dist || jsonb_build_object('occurrence_id', v_occ_id, 'linhas', v_after_linhas);
end;
$function$;

-- "revoke ... from public" sozinho NÃO tira o EXECUTE de anon neste projeto — há um ALTER DEFAULT
-- PRIVILEGES que concede EXECUTE direto ao role anon (não via public) em toda função nova, mesmo
-- padrão que já exigiu o "from anon" explícito em criar_lancamento()/salvar_divisao_comissao_
-- lancamento()/concluir_lancamento() (ver essas migrations). Sem esta linha, usuário não autenticado
-- consegue CHAMAR a função (a lógica interna ainda bloqueia via has_any_role, mas expõe superfície
-- de ataque desnecessária numa RPC que mexe em dados financeiros).
revoke all on function public.editar_ocorrencia_lancamento_financeiro(uuid, jsonb, jsonb, jsonb, text) from public;
revoke execute on function public.editar_ocorrencia_lancamento_financeiro(uuid, jsonb, jsonb, jsonb, text) from anon;
grant execute on function public.editar_ocorrencia_lancamento_financeiro(uuid, jsonb, jsonb, jsonb, text) to authenticated;
