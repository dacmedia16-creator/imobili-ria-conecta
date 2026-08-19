-- Pedido do usuário (19/08): financeiro/admin/super_admin devem poder editar a Ocorrência de
-- Lançamento também quando ela está 'devolvida_ajuste', não só 'ocorrencia_analise_financeiro' —
-- útil quando o corretor dono não está disponível pra fazer a correção ele mesmo. A migration
-- original (20260819060000) limitou de propósito só a 'ocorrencia_analise_financeiro' (ver comentário
-- lá — decisão consciente de não ampliar o acesso prático de então); esta migration amplia
-- explicitamente por pedido direto, com o mesmo mecanismo já existente (motivo obrigatório,
-- transação única, auditoria em activity_logs) — nenhuma lógica nova, só a allowlist de status.
--
-- Corpo idêntico ao de 20260819060000, exceto a checagem de status (era um único valor fixo, agora
-- 2). A ocorrência já existe em devolvida_ajuste desde o primeiro envio (só o status muda), então
-- v_occ_id sempre resolve — nenhum outro trecho da função precisa mudar.
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
  -- contra edição/conclusão concorrentes da MESMA venda (ver comentário no topo do arquivo original).
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.modalidade <> 'lancamento' then
    raise exception 'Esta venda não é uma venda de Lançamento.' using errcode = '23514';
  end if;

  -- ALTERADO: allowlist de 2 status agora (era só 'ocorrencia_analise_financeiro') — ver comentário
  -- no topo do arquivo.
  if v_sale.status::text not in ('ocorrencia_analise_financeiro', 'devolvida_ajuste') then
    raise exception 'Só é possível editar enquanto a ocorrência está em análise do financeiro ou devolvida para ajuste (status atual: %).', v_sale.status
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
