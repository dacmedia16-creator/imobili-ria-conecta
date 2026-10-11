-- PROBLEMA (auditoria externa, 3º lote): createOcc() no front-end montava manualmente as linhas de
-- occurrence_commissions usando sales.valor_comissao_captador/vendedor BRUTO (não o líquido já
-- calculado por sync_occurrence_commissions/calcular_distribuicao_venda), e fazia isso em 4 chamadas
-- Supabase separadas e não-transacionais (occurrences, occurrence_commissions, occurrence_partners,
-- activity_logs) — uma falha no meio deixava a Ocorrência "meio criada".
--
-- Correção: RPC única, transacional (toda função plpgsql roda numa única transação de banco por
-- natureza — sem BEGIN/COMMIT explícito necessário; qualquer exceção no meio desfaz tudo), que passa
-- a ser a ÚNICA forma de criar uma Ocorrência. Nunca monta linha de comissão na mão — delega 100% pra
-- sync_occurrence_commissions(), a mesma fonte já usada em todo save() da Resumo.
--
-- SECURITY INVOKER (não DEFINER) de propósito: as policies já existentes (occ_write, occ_comm_write,
-- occ_part_write, log_insert) já implementam exatamente a autorização necessária (financeiro/admin/
-- super_admin/gestor/team_leader, mais can_view_sale) — rodando como invoker, cada INSERT desta função
-- é auditado pela MESMA RLS que já protege escrita direta nessas tabelas, sem duplicar (e arriscar
-- divergir) a lógica de papéis dentro da função.
--
-- occurrences_sale_id_key (UNIQUE, já existente) impede duas ocorrências pra mesma venda — não
-- precisou de constraint nova.
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
  select * into v_sale from sales where id = p_sale_id;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.status::text in ('cancelada', 'arquivada') then
    raise exception 'Não é possível criar Ocorrência para uma venda cancelada ou arquivada.' using errcode = '23514';
  end if;

  if exists (select 1 from occurrences where sale_id = p_sale_id) then
    raise exception 'Esta venda já tem uma Ocorrência criada.' using errcode = '23505';
  end if;

  v_dist := calcular_distribuicao_venda(v_sale);
  if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível criar a Ocorrência: %', (
      select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
    ) using errcode = '23514';
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
    p_sale_id, coalesce(v_sale.imovel_id, v_sale.codigo_interno), current_date, v_sale.tempo_venda_dias, v_sale.midia,
    v_sale.valor_anunciado, v_sale.valor_negociado, v_sale.percentual_comissao, v_sale.valor_total_comissao,
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

  -- Única fonte de verdade pras linhas de comissão — nunca monta captador/vendedor/indicador/líder/
  -- extras na mão aqui. Mesma função usada em todo save() da Resumo (já grava líquido, não bruto).
  perform sync_occurrence_commissions(p_sale_id);

  if v_sale.parceria_tipo is not null then
    insert into occurrence_partners (occurrence_id, from_sale, tipo, nome, cpf_cnpj, percentual, valor, banco, agencia, conta, pix)
    values (v_occ_id, true, v_sale.parceria_tipo, v_sale.parceria_nome, v_sale.parceria_cpf_cnpj, v_sale.parceria_percentual, v_sale.parceria_valor, v_sale.parceria_banco, v_sale.parceria_agencia, v_sale.parceria_conta, v_sale.parceria_pix);
  end if;

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'occurrence_created', jsonb_build_object('occurrence_id', v_occ_id));

  return jsonb_build_object('occurrence_id', v_occ_id);
end;
$function$;
