-- Corrige regressão em criar_ocorrencia_lancamento(): a migration 20260819000000 (que trocou o
-- cálculo de comissao_bruta pra usar calcular_distribuicao_venda(), suportando percentual) foi
-- gerada a partir de uma base mais antiga da função e sem querer descartou o suporte a reenvio
-- (branch v_is_resend) que já existia desde 20260817020000 — voltando a exigir status = 'rascunho'
-- incondicionalmente. Efeito em produção: nenhuma venda de Lançamento devolvida pelo financeiro
-- (status devolvida_ajuste) consegue ser reenviada — "Reenviar ao financeiro" sempre lança "Esta
-- venda já foi enviada ao financeiro." Reportado pelo usuário em 2026-08-18 (Aline, papel
-- Lançamento/Gestor, bloqueada numa venda devolvida).
--
-- Esta migration reintroduz o branch v_is_resend (idêntico em estrutura ao de 20260817020000: UPDATE
-- na ocorrência existente + resync de occurrence_commissions com sem_cadastro_confirmado/
-- managed_by_sale propagados), mantendo o cálculo de comissao_bruta via calcular_distribuicao_venda()
-- introduzido em 20260819000000 (não volta a exigir valor_total_comissao preenchido manualmente).
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
  v_dist jsonb;
  v_comissao_bruta numeric;
  v_is_resend boolean;
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

  v_is_resend := v_sale.status::text = 'devolvida_ajuste';
  if v_sale.status::text <> 'rascunho' and not v_is_resend then
    raise exception 'Esta venda já foi enviada ao financeiro.' using errcode = '23505';
  end if;

  if v_sale.valor_negociado is null or v_sale.valor_negociado <= 0 then
    raise exception 'Informe o valor negociado antes de enviar ao financeiro.' using errcode = '23514';
  end if;

  -- calcular_distribuicao_venda(v_sale) cai no branch modalidade='lancamento' (checado acima) e
  -- devolve comissao_bruta com a mesma regra de precedência que a tela usa: percentual_comissao *
  -- valor_negociado quando ambos informados, senão valor_total_comissao gravado.
  v_dist := public.calcular_distribuicao_venda(v_sale);
  v_comissao_bruta := (v_dist->>'comissao_bruta')::numeric;

  if v_comissao_bruta is null or v_comissao_bruta <= 0 then
    raise exception 'Informe o percentual de comissão (junto com o valor negociado) ou o valor total da comissão antes de enviar ao financeiro.' using errcode = '23514';
  end if;

  select count(*) into v_extras_count from sale_commission_extras where sale_id = p_sale_id;
  if v_extras_count = 0 then
    raise exception 'Adicione ao menos uma linha na divisão da comissão antes de enviar ao financeiro.' using errcode = '23514';
  end if;

  select nome into v_comprador_nome from sale_parties where sale_id = p_sale_id and papel = 'comprador_1';

  if v_is_resend then
    select id into v_occ_id from occurrences where sale_id = p_sale_id;
    if v_occ_id is null then
      raise exception 'Ocorrência desta venda não encontrada.' using errcode = 'P0002';
    end if;

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
  else
    if exists (select 1 from occurrences where sale_id = p_sale_id) then
      raise exception 'Esta venda já tem uma Ocorrência criada.' using errcode = '23505';
    end if;

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
      v_sale.valor_anunciado, v_sale.valor_negociado, v_sale.percentual_comissao, v_comissao_bruta, v_sale.premio_valor,
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

    insert into occurrence_commissions (occurrence_id, papel, nome, user_id, percentual, valor, sale_commission_extra_id, managed_by_sale, sem_cadastro_confirmado)
    select v_occ_id, e.papel, e.nome, e.user_id, e.percentual, e.valor, e.id, true, e.sem_cadastro_confirmado
    from sale_commission_extras e
    where e.sale_id = p_sale_id;
  end if;

  update sales set status = 'ocorrencia_analise_financeiro' where id = p_sale_id;

  insert into sale_status_history (sale_id, de, para, autor_id, motivo)
  values (p_sale_id, v_sale.status, 'ocorrencia_analise_financeiro'::sale_status, auth.uid(),
    case when v_is_resend then 'Reenvio ao financeiro após ajuste (Lançamento)' else 'Envio direto ao financeiro (Lançamento)' end);

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'status_change', jsonb_build_object('de', v_sale.status, 'para', 'ocorrencia_analise_financeiro', 'motivo',
    case when v_is_resend then 'Reenvio ao financeiro após ajuste (Lançamento)' else 'Envio direto ao financeiro (Lançamento)' end));

  if not v_is_resend then
    insert into activity_logs (autor_id, sale_id, acao, payload)
    values (auth.uid(), p_sale_id, 'occurrence_created', jsonb_build_object('occurrence_id', v_occ_id, 'modalidade', 'lancamento'));
  end if;

  return jsonb_build_object('occurrence_id', v_occ_id, 'comissao_bruta', v_comissao_bruta);
end;
$function$;
