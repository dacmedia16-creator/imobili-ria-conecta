-- RPC única e transacional pra "Enviar ao financeiro" de uma venda de Lançamento: cria a Ocorrência
-- + as linhas de comissão (a partir de sale_commission_extras, única fonte pra esse formato -- ver
-- comentário no schema) e muda o status pra ocorrencia_analise_financeiro, tudo numa operação só.
--
-- SECURITY DEFINER (diferente de criar_ocorrencia_completa, que é INVOKER): o papel 'lancamento' não
-- tem INSERT direto em occurrences/occurrence_commissions (occ_write/occ_comm_write exigem gestor/
-- team_leader/financeiro/admin) -- mesmo padrão de change_sale_status/archive_sale_document, que já
-- fazem a checagem de permissão explicitamente no corpo da função em vez de depender da RLS de baixo.
-- A transição de status em si ainda passa pela trigger validate_sale_status_transition (checa
-- is_owner + papel lancamento), então não duplica essa regra aqui.
create or replace function public.criar_ocorrencia_lancamento(p_sale_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sale sales%rowtype;
  v_comprador_nome text;
  v_extras_count integer;
  v_occ_id uuid;
begin
  if not public.can_view_sale(auth.uid(), p_sale_id) then
    raise exception 'Sem permissão para acessar esta venda.';
  end if;

  select * into v_sale from sales where id = p_sale_id;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.modalidade <> 'lancamento' then
    raise exception 'Esta venda não é uma venda de Lançamento.' using errcode = '23514';
  end if;

  if v_sale.status::text <> 'rascunho' then
    raise exception 'Esta venda já foi enviada ao financeiro.' using errcode = '23505';
  end if;

  if v_sale.valor_negociado is null or v_sale.valor_negociado <= 0 then
    raise exception 'Informe o valor negociado antes de enviar ao financeiro.' using errcode = '23514';
  end if;

  if v_sale.valor_total_comissao is null or v_sale.valor_total_comissao <= 0 then
    raise exception 'Informe o valor total da comissão antes de enviar ao financeiro.' using errcode = '23514';
  end if;

  select count(*) into v_extras_count from sale_commission_extras where sale_id = p_sale_id;
  if v_extras_count = 0 then
    raise exception 'Adicione ao menos uma linha na divisão da comissão antes de enviar ao financeiro.' using errcode = '23514';
  end if;

  if exists (select 1 from occurrences where sale_id = p_sale_id) then
    raise exception 'Esta venda já tem uma Ocorrência criada.' using errcode = '23505';
  end if;

  select nome into v_comprador_nome from sale_parties where sale_id = p_sale_id and papel = 'comprador_1';

  insert into occurrences (
    sale_id, codigo_imovel, data_assinatura, tempo_venda_dias, midia,
    valor_anunciado, valor_negociado, percentual_comissao, valor_comissao, premio_valor,
    nota_fiscal_obrigatoria,
    prev_recebimento_valor, prev_recebimento_data, prev_recebimento_forma,
    prev_recebimento2_valor, prev_recebimento2_data, prev_recebimento2_forma,
    prev_recebimento3_valor, prev_recebimento3_data, prev_recebimento3_forma,
    observacoes, status
  ) values (
    p_sale_id, coalesce(v_sale.imovel_id, v_sale.codigo_interno), v_sale.data_assinatura, v_sale.tempo_venda_dias, v_sale.midia,
    v_sale.valor_anunciado, v_sale.valor_negociado, v_sale.percentual_comissao, v_sale.valor_total_comissao, v_sale.premio_valor,
    v_sale.nota_fiscal_obrigatoria,
    v_sale.previsao_recebimento_valor, v_sale.previsao_recebimento_data, v_sale.previsao_recebimento_forma,
    v_sale.previsao_recebimento2_valor, v_sale.previsao_recebimento2_data, v_sale.previsao_recebimento2_forma,
    v_sale.previsao_recebimento3_valor, v_sale.previsao_recebimento3_data, v_sale.previsao_recebimento3_forma,
    coalesce(
      v_sale.negociacao_observacoes,
      nullif(concat_ws(' | ', case when v_comprador_nome is not null then 'Comprador: ' || v_comprador_nome end), '')
    ),
    'pendente'
  )
  returning id into v_occ_id;

  -- Sem base captador/vendedor (não existe pro Lançamento) -- as linhas de sale_commission_extras
  -- SÃO a divisão completa (corretor, Team Leader(s), Coordenador etc.), não um extra sobre uma base.
  insert into occurrence_commissions (occurrence_id, papel, nome, user_id, percentual, valor, sale_commission_extra_id)
  select v_occ_id, e.papel, e.nome, e.user_id, e.percentual, e.valor, e.id
  from sale_commission_extras e
  where e.sale_id = p_sale_id;

  update sales set status = 'ocorrencia_analise_financeiro' where id = p_sale_id;

  insert into sale_status_history (sale_id, de, para, autor_id, motivo)
  values (p_sale_id, v_sale.status, 'ocorrencia_analise_financeiro'::sale_status, auth.uid(), 'Envio direto ao financeiro (Lançamento)');

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'status_change', jsonb_build_object('de', v_sale.status, 'para', 'ocorrencia_analise_financeiro', 'motivo', 'Envio direto ao financeiro (Lançamento)'));

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'occurrence_created', jsonb_build_object('occurrence_id', v_occ_id, 'modalidade', 'lancamento'));

  return jsonb_build_object('occurrence_id', v_occ_id);
end;
$function$;
