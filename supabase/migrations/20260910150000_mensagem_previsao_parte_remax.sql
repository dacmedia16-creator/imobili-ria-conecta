-- Torna explícita a regra da previsão de recebimento.
-- A previsão representa somente a parte da REMAX, já descontada a parceria externa.
-- A validação continua bloqueando o avanço quando a soma das parcelas diverge;
-- esta migration altera apenas a mensagem exibida ao usuário.
create or replace function public.validar_previsao_recebimento(p_occ occurrences)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_soma numeric;
  v_parceria numeric;
  v_esperado numeric;
  v_inconsistencias jsonb := '[]'::jsonb;
begin
  if (p_occ.prev_recebimento_data is null) <> (p_occ.prev_recebimento_valor is null) then
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      case when p_occ.prev_recebimento_data is null
        then '1ª parcela da previsão: informe a data prevista para o valor já preenchido.'
        else '1ª parcela da previsão: informe o valor previsto para a data já preenchida.'
      end
    );
  end if;
  if (p_occ.prev_recebimento2_data is null) <> (p_occ.prev_recebimento2_valor is null) then
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      case when p_occ.prev_recebimento2_data is null
        then '2ª parcela da previsão: informe a data prevista para o valor já preenchido.'
        else '2ª parcela da previsão: informe o valor previsto para a data já preenchida.'
      end
    );
  end if;
  if (p_occ.prev_recebimento3_data is null) <> (p_occ.prev_recebimento3_valor is null) then
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      case when p_occ.prev_recebimento3_data is null
        then '3ª parcela da previsão: informe a data prevista para o valor já preenchido.'
        else '3ª parcela da previsão: informe o valor previsto para a data já preenchida.'
      end
    );
  end if;

  v_soma := coalesce(p_occ.prev_recebimento_valor, 0)
    + coalesce(p_occ.prev_recebimento2_valor, 0)
    + coalesce(p_occ.prev_recebimento3_valor, 0);

  select coalesce(sum(valor), 0)
    into v_parceria
  from public.occurrence_partners
  where occurrence_id = p_occ.id;

  v_parceria := v_parceria + coalesce((
    select sum(valor)
    from public.occurrence_commissions
    where occurrence_id = p_occ.id
      and sem_cadastro_confirmado = true
  ), 0);

  v_esperado := greatest(
    coalesce(p_occ.valor_comissao, 0) + coalesce(p_occ.premio_valor, 0) - v_parceria,
    0
  );

  if v_esperado > 0 and v_soma <= 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      'Previsão de recebimento não informada. Informe somente a parte da REMAX: R$ '
      || round(v_esperado, 2)
      || ' (comissão bruta de R$ ' || round(coalesce(p_occ.valor_comissao, 0) + coalesce(p_occ.premio_valor, 0), 2)
      || ' menos parceria externa de R$ ' || round(v_parceria, 2) || ').'
    );
  elsif v_esperado > 0 and abs(v_soma - v_esperado) > 0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      'Não é possível avançar: a previsão deve conter somente a parte da REMAX, já descontada a parceria externa. '
      || 'Parte da REMAX: R$ ' || round(v_esperado, 2)
      || '; valor informado: R$ ' || round(v_soma, 2)
      || '; comissão bruta: R$ ' || round(coalesce(p_occ.valor_comissao, 0) + coalesce(p_occ.premio_valor, 0), 2)
      || '; parceria externa: R$ ' || round(v_parceria, 2) || '.'
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
$$;

revoke execute on function public.validar_previsao_recebimento(public.occurrences) from public, anon;
grant execute on function public.validar_previsao_recebimento(public.occurrences) to authenticated;
