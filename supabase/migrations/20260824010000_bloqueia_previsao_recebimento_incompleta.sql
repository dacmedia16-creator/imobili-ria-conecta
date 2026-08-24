-- Impede o avanço ao Financeiro/Conclusão quando uma parcela usada tem somente
-- data ou somente valor. O rascunho continua livre para preenchimento gradual.
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
$$;

create or replace function public.bloquear_avanco_com_previsao_incompleta()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_occ public.occurrences%rowtype;
  v_prev jsonb;
begin
  if new.status::text not in ('ocorrencia_analise_financeiro', 'ocorrencia_concluida')
     or old.status is not distinct from new.status then
    return new;
  end if;

  select * into v_occ
  from public.occurrences
  where sale_id = new.id;

  if not found then
    raise exception 'Não é possível avançar esta venda: a Ocorrência ainda não foi criada.'
      using errcode = '23514';
  end if;

  v_prev := public.validar_previsao_recebimento(v_occ);
  if not coalesce((v_prev->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível avançar esta venda: %', (
      select string_agg(item, '; ')
      from jsonb_array_elements_text(v_prev->'inconsistencias') item
    ) using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bloquear_avanco_com_previsao_incompleta on public.sales;
create trigger trg_bloquear_avanco_com_previsao_incompleta
before update of status on public.sales
for each row execute function public.bloquear_avanco_com_previsao_incompleta();
