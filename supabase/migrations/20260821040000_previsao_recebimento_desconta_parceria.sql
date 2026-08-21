-- PROBLEMA (achado ao investigar bloqueio real na venda 630601171-48): validar_previsao_recebimento
-- (20260819070000) compara a soma de prev_recebimento{1,2,3}_valor contra occurrences.valor_comissao
-- (SEMPRE bruto, com a parte da parceria externa incluída) + premio_valor. Na prática, quando a venda
-- tem parceria externa (outra unidade RE/MAX ou imobiliária externa), o parceiro cobra a fatia dele
-- diretamente do cliente/incorporadora — nunca passa pela conta desta imobiliária — então quem
-- preenche a venda só lança a fatia própria em prev_recebimento (confirmado: 3 das 4 vendas com
-- parceria já no banco seguem esse padrão). A trava, então, cobrava reconciliar contra um total que
-- nunca vai bater de verdade.
--
-- Mesma inversão de regra em src/lib/status.ts (fatorComissaoPropria, removida) e nos 3 lugares que a
-- usavam pra descontar a parceria de uma previsão assumida bruta (Central Financeira, Relatórios,
-- Comissões a Receber) — ver commit irmão no front-end. De agora em diante prev_recebimento{1,2,3} já
-- É a fatia própria; a comissão esperada pra bater com a soma das parcelas precisa descontar a
-- parceria, não mais incluí-la.
create or replace function public.validar_previsao_recebimento(p_occ occurrences)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to 'public'
as $function$
declare
  v_soma numeric;
  v_parceria numeric;
  v_esperado numeric;
  v_inconsistencias jsonb := '[]'::jsonb;
begin
  v_soma := coalesce(p_occ.prev_recebimento_valor, 0) + coalesce(p_occ.prev_recebimento2_valor, 0) + coalesce(p_occ.prev_recebimento3_valor, 0);

  -- Parceria externa da ocorrência: nunca passa pela conta desta imobiliária, então nunca deveria
  -- estar embutida na previsão de recebimento. Duas fontes somadas, mesma regra de
  -- agruparParceriaExternaPorOcorrencia no front-end: occurrence_partners (parceria da ocorrência
  -- inteira) + occurrence_commissions.sem_cadastro_confirmado (beneficiário individual sem cadastro).
  select coalesce(sum(valor), 0) into v_parceria from occurrence_partners where occurrence_id = p_occ.id;
  v_parceria := v_parceria + coalesce((
    select sum(valor) from occurrence_commissions
    where occurrence_id = p_occ.id and sem_cadastro_confirmado = true
  ), 0);

  v_esperado := greatest(coalesce(p_occ.valor_comissao, 0) + coalesce(p_occ.premio_valor, 0) - v_parceria, 0);

  if v_esperado > 0 and v_soma <= 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      'Previsão de recebimento não informada — a comissão própria da Ocorrência (descontada eventual parceria externa) é R$ ' || round(v_esperado, 2) || ' mas nenhuma parcela prevista foi cadastrada.'
    );
  elsif v_esperado > 0 and abs(v_soma - v_esperado) > 0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      'Previsão de recebimento (R$ ' || round(v_soma, 2) || ') não bate com a comissão própria da Ocorrência (R$ ' || round(v_esperado, 2) || ', já descontada a parceria externa) — confira os valores das parcelas previstas.'
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
