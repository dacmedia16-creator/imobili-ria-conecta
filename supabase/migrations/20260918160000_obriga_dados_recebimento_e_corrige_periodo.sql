-- Torna a previsão e a efetivação financeira completas no ponto em que passam a
-- alimentar o Financeiro, sem reavaliar automaticamente registros históricos.
-- A correção de registros antigos deve ser feita pela fila de divergências.

create or replace function public.validar_dados_financeiros_ocorrencia()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_slot record;
  v_tem_previsao boolean := false;
  v_exigir_previsao boolean := false;
  v_financeiro_alterado boolean := false;
  v_esperado numeric;
begin
  if tg_op = 'INSERT' then
    v_exigir_previsao := NEW.status = 'concluida' or NEW.aceita_financeiro = true;
    v_financeiro_alterado := true;
  else
    v_exigir_previsao :=
      (NEW.status = 'concluida' and OLD.status is distinct from NEW.status)
      or (NEW.aceita_financeiro = true and OLD.aceita_financeiro is distinct from NEW.aceita_financeiro);

    -- Registros históricos incompletos continuam consultáveis, mas qualquer edição
    -- financeira passa a ser validada integralmente.
    v_financeiro_alterado :=
      NEW.prev_recebimento_data is distinct from OLD.prev_recebimento_data
      or NEW.prev_recebimento_valor is distinct from OLD.prev_recebimento_valor
      or NEW.prev_recebimento_forma is distinct from OLD.prev_recebimento_forma
      or NEW.prev_recebimento_recebido_em is distinct from OLD.prev_recebimento_recebido_em
      or NEW.prev_recebimento_recebido_valor is distinct from OLD.prev_recebimento_recebido_valor
      or NEW.prev_recebimento2_data is distinct from OLD.prev_recebimento2_data
      or NEW.prev_recebimento2_valor is distinct from OLD.prev_recebimento2_valor
      or NEW.prev_recebimento2_forma is distinct from OLD.prev_recebimento2_forma
      or NEW.prev_recebimento2_recebido_em is distinct from OLD.prev_recebimento2_recebido_em
      or NEW.prev_recebimento2_recebido_valor is distinct from OLD.prev_recebimento2_recebido_valor
      or NEW.prev_recebimento3_data is distinct from OLD.prev_recebimento3_data
      or NEW.prev_recebimento3_valor is distinct from OLD.prev_recebimento3_valor
      or NEW.prev_recebimento3_forma is distinct from OLD.prev_recebimento3_forma
      or NEW.prev_recebimento3_recebido_em is distinct from OLD.prev_recebimento3_recebido_em
      or NEW.prev_recebimento3_recebido_valor is distinct from OLD.prev_recebimento3_recebido_valor;
  end if;

  if not (v_exigir_previsao or v_financeiro_alterado) then
    return NEW;
  end if;

  for v_slot in
    select
      1 as numero,
      NEW.prev_recebimento_data as data_prevista,
      NEW.prev_recebimento_valor as valor_previsto,
      NEW.prev_recebimento_forma as forma_prevista,
      NEW.prev_recebimento_recebido_em as recebido_em,
      NEW.prev_recebimento_recebido_valor as valor_recebido
    union all
    select
      2,
      NEW.prev_recebimento2_data,
      NEW.prev_recebimento2_valor,
      NEW.prev_recebimento2_forma,
      NEW.prev_recebimento2_recebido_em,
      NEW.prev_recebimento2_recebido_valor
    union all
    select
      3,
      NEW.prev_recebimento3_data,
      NEW.prev_recebimento3_valor,
      NEW.prev_recebimento3_forma,
      NEW.prev_recebimento3_recebido_em,
      NEW.prev_recebimento3_recebido_valor
  loop
    if v_slot.data_prevista is not null
      or v_slot.valor_previsto is not null
      or nullif(trim(v_slot.forma_prevista), '') is not null
    then
      v_tem_previsao := true;
      if v_slot.data_prevista is null
        or v_slot.valor_previsto is null
        or v_slot.valor_previsto <= 0
        or nullif(trim(v_slot.forma_prevista), '') is null
      then
        raise exception 'Não é possível salvar a Ocorrência: a previsão da parcela % precisa ter data, valor maior que zero e forma de recebimento.', v_slot.numero
          using errcode = '23514';
      end if;
    end if;

    if (v_slot.recebido_em is null) is distinct from (v_slot.valor_recebido is null) then
      raise exception 'Não é possível salvar a Ocorrência: a parcela % precisa ter data e valor recebido juntos.', v_slot.numero
        using errcode = '23514';
    end if;

    if v_slot.valor_recebido is not null and v_slot.valor_recebido <= 0 then
      raise exception 'Não é possível salvar a Ocorrência: o valor recebido da parcela % precisa ser maior que zero.', v_slot.numero
        using errcode = '23514';
    end if;

    if v_slot.recebido_em is not null then
      if v_slot.data_prevista is null
        or v_slot.valor_previsto is null
        or v_slot.valor_previsto <= 0
        or nullif(trim(v_slot.forma_prevista), '') is null
      then
        raise exception 'Não é possível registrar o recebimento da parcela % sem previsão completa (data, valor e forma).', v_slot.numero
          using errcode = '23514';
      end if;
    end if;
  end loop;

  v_esperado := coalesce(NEW.valor_comissao, 0) + coalesce(NEW.premio_valor, 0);
  if v_exigir_previsao and v_esperado > 0 and not v_tem_previsao then
    raise exception 'Não é possível concluir/travar a Ocorrência: informe ao menos uma previsão de recebimento completa.'
      using errcode = '23514';
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_validar_dados_financeiros_ocorrencia on public.occurrences;
create trigger trg_validar_dados_financeiros_ocorrencia
before insert or update on public.occurrences
for each row execute function public.validar_dados_financeiros_ocorrencia();
