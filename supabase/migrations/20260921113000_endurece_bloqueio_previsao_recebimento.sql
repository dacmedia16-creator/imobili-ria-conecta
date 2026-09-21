-- Fecha a lacuna restante da validação de previsão financeira.
-- Rascunhos e registros históricos continuam consultáveis; a trava atua quando a venda
-- avança para o Financeiro/conclusão e quando a Ocorrência é aceita/concluída.
-- Cada parcela usada exige o trio indivisível (valor, data e forma) e cada recebimento
-- exige o par indivisível (data e valor), sempre apoiado em uma previsão completa.

create or replace function public.validar_previsao_recebimento(p_occ public.occurrences)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_slot record;
  v_soma numeric := 0;
  v_parceria numeric := 0;
  v_esperado numeric := 0;
  v_inconsistencias jsonb := '[]'::jsonb;
  v_tem_previsao boolean := false;
  v_anterior_preenchida boolean := true;
  v_preenchida boolean;
  v_completa boolean;
begin
  for v_slot in
    select 1 as numero,
      p_occ.prev_recebimento_data as data_prevista,
      p_occ.prev_recebimento_valor as valor_previsto,
      p_occ.prev_recebimento_forma as forma_prevista,
      p_occ.prev_recebimento_recebido_em as recebido_em,
      p_occ.prev_recebimento_recebido_valor as valor_recebido
    union all
    select 2,
      p_occ.prev_recebimento2_data,
      p_occ.prev_recebimento2_valor,
      p_occ.prev_recebimento2_forma,
      p_occ.prev_recebimento2_recebido_em,
      p_occ.prev_recebimento2_recebido_valor
    union all
    select 3,
      p_occ.prev_recebimento3_data,
      p_occ.prev_recebimento3_valor,
      p_occ.prev_recebimento3_forma,
      p_occ.prev_recebimento3_recebido_em,
      p_occ.prev_recebimento3_recebido_valor
  loop
    v_preenchida := v_slot.data_prevista is not null
      or v_slot.valor_previsto is not null
      or nullif(btrim(v_slot.forma_prevista), '') is not null;

    v_completa := v_slot.data_prevista is not null
      and v_slot.valor_previsto is not null
      and v_slot.valor_previsto > 0
      and nullif(btrim(v_slot.forma_prevista), '') is not null;

    if v_preenchida then
      v_tem_previsao := true;
      if not v_anterior_preenchida then
        v_inconsistencias := v_inconsistencias || jsonb_build_array(
          'A previsão da parcela ' || v_slot.numero || ' não pode deixar uma parcela anterior vazia.'
        );
      end if;
      if not v_completa then
        v_inconsistencias := v_inconsistencias || jsonb_build_array(
          'A previsão da parcela ' || v_slot.numero || ' precisa ter data, valor maior que zero e forma de recebimento.'
        );
      end if;
    end if;

    if (v_slot.recebido_em is null) is distinct from (v_slot.valor_recebido is null) then
      v_inconsistencias := v_inconsistencias || jsonb_build_array(
        'O recebimento da parcela ' || v_slot.numero || ' precisa ter data e valor juntos.'
      );
    end if;

    if v_slot.valor_recebido is not null and v_slot.valor_recebido <= 0 then
      v_inconsistencias := v_inconsistencias || jsonb_build_array(
        'O valor recebido da parcela ' || v_slot.numero || ' precisa ser maior que zero.'
      );
    end if;

    if v_slot.recebido_em is not null and not v_completa then
      v_inconsistencias := v_inconsistencias || jsonb_build_array(
        'O recebimento da parcela ' || v_slot.numero || ' exige previsão completa: data, valor e forma.'
      );
    end if;

    v_soma := v_soma + coalesce(v_slot.valor_previsto, 0);
    v_anterior_preenchida := v_preenchida;
  end loop;

  select coalesce(sum(op.valor), 0)
    into v_parceria
  from public.occurrence_partners op
  where op.occurrence_id = p_occ.id;

  v_parceria := v_parceria + coalesce((
    select sum(oc.valor)
    from public.occurrence_commissions oc
    where oc.occurrence_id = p_occ.id
      and oc.sem_cadastro_confirmado = true
  ), 0);

  v_esperado := greatest(
    coalesce(p_occ.valor_comissao, 0) + coalesce(p_occ.premio_valor, 0) - v_parceria,
    0
  );

  if v_esperado > 0 and v_soma <= 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      'Previsão de recebimento não informada — a comissão própria da Ocorrência (descontada eventual parceria externa) é R$ '
      || round(v_esperado, 2) || ' mas nenhuma parcela prevista foi cadastrada.'
    );
  elsif v_esperado > 0 and abs(v_soma - v_esperado) > 0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      'Previsão de recebimento (R$ ' || round(v_soma, 2)
      || ') não bate com a comissão própria da Ocorrência (R$ ' || round(v_esperado, 2)
      || ', já descontada a parceria externa) — confira os valores das parcelas previstas.'
    );
  end if;

  return jsonb_build_object(
    'soma_previsto', round(v_soma, 2),
    'parceria_externa', round(v_parceria, 2),
    'comissao_esperada', round(v_esperado, 2),
    'inconsistencias', v_inconsistencias,
    'calculo_valido', jsonb_array_length(v_inconsistencias) = 0
  );
end;
$function$;

revoke all on function public.validar_previsao_recebimento(public.occurrences) from public, anon;
grant execute on function public.validar_previsao_recebimento(public.occurrences) to authenticated, service_role;
