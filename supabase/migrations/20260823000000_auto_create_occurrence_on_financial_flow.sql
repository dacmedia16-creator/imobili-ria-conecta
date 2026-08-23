-- Garante que nenhuma venda entre no fluxo de Ocorrência/Financeiro sem o registro-base.
-- A criação é idempotente e roda na mesma transação da mudança de status: se qualquer etapa
-- falhar, nem a ocorrência nem o novo status ficam gravados parcialmente.

create or replace function public.criar_ocorrencia_completa(p_sale_id uuid)
 returns jsonb
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare
  v_sale sales%rowtype;
  v_payment sale_payment%rowtype;
  v_vendedor_nome text;
  v_comprador_nome text;
  v_occ_id uuid;
  v_dist jsonb;
begin
  -- O lock por venda serializa cliques/requisições concorrentes e, junto da UNIQUE(sale_id),
  -- impede ocorrência duplicada até quando duas ações chegam praticamente ao mesmo tempo.
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.status::text in ('cancelada', 'arquivada') then
    raise exception 'Não é possível criar Ocorrência para uma venda cancelada ou arquivada.' using errcode = '23514';
  end if;

  -- Valida também quando a ocorrência já existe: enviar ao Financeiro nunca pode contornar
  -- uma inconsistência surgida depois da criação inicial.
  v_dist := calcular_distribuicao_venda(v_sale);
  if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível criar ou sincronizar a Ocorrência: %', (
      select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
    ) using errcode = '23514';
  end if;

  select id into v_occ_id from occurrences where sale_id = p_sale_id;
  if v_occ_id is not null then
    -- sync_occurrence_commissions preserva linhas manuais do Financeiro
    -- (managed_by_sale = false) e atualiza somente as gerenciadas pela venda.
    perform sync_occurrence_commissions(p_sale_id);
    return jsonb_build_object('occurrence_id', v_occ_id, 'created', false);
  end if;

  select * into v_payment from sale_payment where sale_id = p_sale_id;
  select nome into v_vendedor_nome from sale_parties where sale_id = p_sale_id and papel = 'vendedor_1';
  select nome into v_comprador_nome from sale_parties where sale_id = p_sale_id and papel = 'comprador_1';

  insert into occurrences (
    sale_id, codigo_imovel, data_assinatura, tempo_venda_dias, midia,
    valor_anunciado, valor_negociado, percentual_comissao, valor_comissao,
    financiamento, financiamento_valor, financiamento_banco, financiamento_correspondente, financiamento_previsao, oba_credito,
    prev_recebimento_valor, prev_recebimento_data, prev_recebimento_forma,
    prev_recebimento2_valor, prev_recebimento2_data, prev_recebimento2_forma,
    prev_recebimento3_valor, prev_recebimento3_data, prev_recebimento3_forma,
    observacoes, status
  ) values (
    p_sale_id, coalesce(v_sale.imovel_id, v_sale.codigo_interno), coalesce(v_sale.data_assinatura, current_date), v_sale.tempo_venda_dias, v_sale.midia,
    v_sale.valor_anunciado, v_sale.valor_negociado, v_sale.percentual_comissao,
    coalesce((v_dist->>'comissao_bruta')::numeric, v_sale.valor_total_comissao),
    coalesce(v_payment.financiamento, false), v_payment.financiamento_valor, v_payment.financiamento_banco, v_payment.financiamento_correspondente, v_payment.financiamento_previsao, coalesce(v_payment.oba_credito, false),
    v_sale.previsao_recebimento_valor, v_sale.previsao_recebimento_data, v_sale.previsao_recebimento_forma,
    v_sale.previsao_recebimento2_valor, v_sale.previsao_recebimento2_data, v_sale.previsao_recebimento2_forma,
    v_sale.previsao_recebimento3_valor, v_sale.previsao_recebimento3_data, v_sale.previsao_recebimento3_forma,
    nullif(concat_ws(' | ',
      case when v_vendedor_nome is not null then 'Vendedor/Proprietário: ' || v_vendedor_nome end,
      case when v_comprador_nome is not null then 'Comprador: ' || v_comprador_nome end
    ), ''),
    'pendente'
  )
  returning id into v_occ_id;

  perform sync_occurrence_commissions(p_sale_id);

  if v_sale.parceria_tipo is not null then
    insert into occurrence_partners (occurrence_id, from_sale, tipo, nome, cpf_cnpj, percentual, valor, banco, agencia, conta, pix)
    values (v_occ_id, true, v_sale.parceria_tipo, v_sale.parceria_nome, v_sale.parceria_cpf_cnpj, v_sale.parceria_percentual, v_sale.parceria_valor, v_sale.parceria_banco, v_sale.parceria_agencia, v_sale.parceria_conta, v_sale.parceria_pix);
  end if;

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'occurrence_created', jsonb_build_object('occurrence_id', v_occ_id, 'automatic', true));

  return jsonb_build_object('occurrence_id', v_occ_id, 'created', true);
end;
$function$;

create or replace function public.change_sale_status(_sale_id uuid, _new_status text, _motivo text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _prev_status text;
begin
  if not public.can_view_sale(auth.uid(), _sale_id) then
    raise exception 'Sem permissão para acessar esta venda.';
  end if;

  select status::text into _prev_status from public.sales where id = _sale_id for update;
  if _prev_status is null then
    raise exception 'Venda não encontrada.';
  end if;

  -- Dupla proteção:
  -- 1) cria ao entrar em ocorrencia_pendente;
  -- 2) confere/cria/sincroniza novamente antes de chegar ao Financeiro.
  -- Como a chamada está dentro desta função, qualquer erro desfaz toda a troca de status.
  if _new_status in ('ocorrencia_pendente', 'ocorrencia_analise_financeiro') then
    perform public.criar_ocorrencia_completa(_sale_id);
  end if;

  update public.sales set status = _new_status::sale_status where id = _sale_id;

  insert into public.sale_status_history (sale_id, de, para, autor_id, motivo)
  values (_sale_id, _prev_status::sale_status, _new_status::sale_status, auth.uid(), _motivo);

  insert into public.activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), _sale_id, 'status_change', jsonb_build_object('de', _prev_status, 'para', _new_status, 'motivo', _motivo));
end;
$function$;
