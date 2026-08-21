-- Achado ao revisar um erro de salvamento na venda 630601222-23: os corretores da modalidade
-- Lançamento já calculam a % deles em cima da comissão + prêmio somados (prática confirmada pelo
-- usuário), mas o "Saldo da imobiliária/construtora (automático)" só descontava o total das pessoas
-- da comissão bruta pura -- sem somar o prêmio antes. Resultado: o saldo mostrado ficava exatamente
-- R$ premio_valor menor do que a imobiliária realmente retém (simulado contra as 4 vendas de
-- Lançamento que hoje têm prêmio preenchido: em todas o saldo novo = saldo atual + prêmio, nenhuma
-- fica negativa).
--
-- O prêmio continua fora da checagem de conflito percentual x valor_total_comissao (item 4, migration
-- 20260819110000) -- essa conta nunca envolveu prêmio e continua não envolvendo.
create or replace function public.calcular_distribuicao_venda(p_sale sales)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to 'public'
as $function$
declare
  v_sale sales%rowtype := p_sale;
  v_negociado numeric;
  v_comissao_bruta numeric;
  v_comissao_conflito boolean;
  -- ---- variáveis específicas do branch de Lançamento ----
  v_lanc_total_pessoas numeric;
  v_lanc_parceria numeric;
  -- NOVO: base do saldo automático da imobiliária -- comissão bruta + prêmio (o prêmio já é
  -- distribuído junto com a comissão pelos corretores, então precisa entrar na conta de quanto
  -- sobra pra imobiliária, mesmo continuando fora do valor "comissão bruta" mostrado à parte).
  v_lanc_base_saldo numeric;
  v_lanc_saldo_imobiliaria numeric;
  v_lanc_inconsistencias jsonb;
  -- ---- variáveis do branch padrão (inalteradas) ----
  v_parceria numeric;
  v_parte_remax numeric;
  v_tem_remax boolean;
  v_captador numeric;
  v_vendedor numeric;
  v_indicador_captador numeric;
  v_indicador_vendedor numeric;
  v_lider_captador numeric;
  v_lider_vendedor numeric;
  v_extra_gestores numeric;
  v_extra_captador numeric;
  v_extra_vendedor numeric;
  v_extra_imobiliaria numeric;
  v_extra_negativo boolean;
  v_outros_extras numeric;
  v_liquido_captador numeric;
  v_liquido_vendedor numeric;
  v_gestores_team_leaders numeric;
  v_saldo_inicial numeric;
  v_saldo_liquido numeric;
  v_total_distribuido numeric;
  v_diferenca numeric;
  v_inconsistencias jsonb := '[]'::jsonb;
  v_neg record;
  v_extra_link record;
begin
  v_negociado := v_sale.valor_negociado;

  if v_sale.percentual_comissao is not null and v_negociado is not null and v_negociado > 0 then
    v_comissao_bruta := round(v_sale.percentual_comissao / 100 * v_negociado, 2);
  else
    v_comissao_bruta := coalesce(v_sale.valor_total_comissao, 0);
  end if;

  v_comissao_conflito :=
    v_sale.percentual_comissao is not null
    and v_sale.valor_total_comissao is not null
    and v_negociado is not null and v_negociado > 0
    and abs(round(v_sale.percentual_comissao / 100 * v_negociado, 2) - v_sale.valor_total_comissao) > 0.01;

  -- ============================================================================================
  -- BRANCH LANÇAMENTO: modelo simples, sem captador/vendedor/REMAX. Retorna e sai antes de tocar
  -- em qualquer lógica do fluxo padrão abaixo.
  -- ============================================================================================
  if v_sale.modalidade = 'lancamento' then
    v_lanc_inconsistencias := '[]'::jsonb;

    if v_negociado is null or v_negociado <= 0 then
      v_lanc_inconsistencias := v_lanc_inconsistencias || jsonb_build_array('Valor negociado não informado — a comissão bruta não pôde ser calculada a partir dele.');
    end if;

    if v_negociado > 0 and v_comissao_bruta <= 0 then
      v_lanc_inconsistencias := v_lanc_inconsistencias || jsonb_build_array('Comissão da venda não informada — preencha o percentual de comissão ou o valor total da comissão.');
    end if;

    if v_comissao_conflito then
      v_lanc_inconsistencias := v_lanc_inconsistencias || jsonb_build_array(
        'Percentual de comissão (' || v_sale.percentual_comissao || '% = R$ ' || v_comissao_bruta ||
        ') não bate com o valor total da comissão digitado (R$ ' || v_sale.valor_total_comissao ||
        ') — o sistema usa o percentual como comissão bruta; confira qual dos dois valores está certo (e a divisão da comissão, que pode ter sido calculada em cima do valor errado).'
      );
    end if;

    select
      coalesce(sum(valor) filter (where not sem_cadastro_confirmado), 0),
      coalesce(sum(valor) filter (where sem_cadastro_confirmado), 0)
    into v_lanc_total_pessoas, v_lanc_parceria
    from sale_commission_extras
    where sale_id = v_sale.id;

    if exists (
      select 1 from sale_commission_extras
      where sale_id = v_sale.id and coalesce(valor, 0) < -0.01
    ) then
      v_lanc_inconsistencias := v_lanc_inconsistencias || jsonb_build_array('Uma ou mais linhas da divisão de comissão têm valor negativo.');
    end if;

    -- NOVO: prêmio somado antes de calcular o saldo -- os corretores já dividem a % deles em cima
    -- da comissão + prêmio, então o que sobra pra imobiliária também precisa considerar o prêmio.
    v_lanc_base_saldo := round(v_comissao_bruta + coalesce(v_sale.premio_valor, 0), 2);
    v_lanc_saldo_imobiliaria := round(v_lanc_base_saldo - v_lanc_total_pessoas - v_lanc_parceria, 2);

    if v_lanc_base_saldo > 0 and v_lanc_saldo_imobiliaria < -0.01 then
      v_lanc_inconsistencias := v_lanc_inconsistencias || jsonb_build_array(
        'A soma das comissões de pessoas e parceria externa (R$ ' || round(v_lanc_total_pessoas + v_lanc_parceria, 2) ||
        ') ultrapassa a comissão bruta' || (case when coalesce(v_sale.premio_valor, 0) > 0 then ' + prêmio' else '' end) ||
        ' (R$ ' || v_lanc_base_saldo || ') em R$ ' || round(abs(v_lanc_saldo_imobiliaria), 2) || '.'
      );
    end if;

    return jsonb_build_object(
      'modalidade', 'lancamento',
      'valor_negociado', v_negociado,
      'comissao_bruta', v_comissao_bruta,
      'premio_valor', round(coalesce(v_sale.premio_valor, 0), 2),
      'total_pessoas', round(v_lanc_total_pessoas, 2),
      'parceria_externa', round(v_lanc_parceria, 2),
      'saldo_imobiliaria', v_lanc_saldo_imobiliaria,
      'total_distribuido', round(v_lanc_total_pessoas + v_lanc_parceria + v_lanc_saldo_imobiliaria, 2),
      'diferenca_restante', v_lanc_saldo_imobiliaria,
      'inconsistencias', v_lanc_inconsistencias,
      'calculo_valido', jsonb_array_length(v_lanc_inconsistencias) = 0
    );
  end if;
  -- ============================================================================================
  -- FIM DO BRANCH LANÇAMENTO — daqui pra baixo é o fluxo padrão, inalterado.
  -- ============================================================================================

  if v_negociado is null or v_negociado <= 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Valor negociado não informado — valores percentuais (comissão, parceria, REMAX) não puderam ser calculados a partir dele.');
  end if;

  if v_negociado > 0 and v_comissao_bruta <= 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Comissão da venda não informada — preencha o percentual de comissão ou o valor total da comissão.');
  end if;

  if v_comissao_conflito then
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      'Percentual de comissão (' || v_sale.percentual_comissao || '% = R$ ' || v_comissao_bruta ||
      ') não bate com o valor total da comissão digitado (R$ ' || v_sale.valor_total_comissao ||
      ') — o sistema usa o percentual como comissão bruta; confira qual dos dois valores está certo (e a divisão da comissão, que pode ter sido calculada em cima do valor errado).'
    );
  end if;

  if v_sale.parceria_tipo is null then
    v_parceria := 0;
  elsif v_sale.parceria_percentual is not null and v_negociado > 0 then
    v_parceria := round(v_sale.parceria_percentual / 100 * v_negociado, 2);
  else
    v_parceria := coalesce(v_sale.parceria_valor, 0);
  end if;

  if v_sale.parceria_tipo is not null and coalesce(v_sale.parceria_percentual, 0) <= 0 and coalesce(v_sale.parceria_valor, 0) <= 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Parceria externa "' || coalesce(v_sale.parceria_nome, '(sem nome)') || '" marcada mas sem percentual nem valor de comissão informado.');
  end if;

  v_tem_remax := v_sale.percentual_remax is not null or v_sale.valor_remax is not null;
  if v_sale.percentual_remax is not null and v_negociado > 0 then
    v_parte_remax := round(v_sale.percentual_remax / 100 * v_negociado, 2);
  else
    v_parte_remax := v_sale.valor_remax;
  end if;

  v_captador := coalesce(v_sale.valor_comissao_captador, 0);
  v_vendedor := coalesce(v_sale.valor_comissao_vendedor, 0);
  v_indicador_captador := coalesce(v_sale.valor_comissao_indicador_captador, 0);
  v_indicador_vendedor := coalesce(v_sale.valor_comissao_indicador_vendedor, 0);
  v_lider_captador := coalesce(v_sale.valor_comissao_lider_captador, 0);
  v_lider_vendedor := coalesce(v_sale.valor_comissao_lider_vendedor, 0);

  for v_neg in
    select * from (values
      ('Valor negociado', v_negociado),
      ('Percentual de comissão', v_sale.percentual_comissao),
      ('Comissão bruta', v_comissao_bruta),
      ('Percentual de parceria', v_sale.parceria_percentual),
      ('Parceria externa', v_parceria),
      ('Percentual da REMAX', v_sale.percentual_remax),
      ('Parte da REMAX', v_parte_remax),
      ('Comissão do captador', v_captador),
      ('Comissão do vendedor', v_vendedor),
      ('Indicador do captador', v_indicador_captador),
      ('Indicador do vendedor', v_indicador_vendedor),
      ('Gestor/Team Leader do captador', v_lider_captador),
      ('Gestor/Team Leader do vendedor', v_lider_vendedor)
    ) as t(label, valor)
  loop
    if v_neg.valor is not null and v_neg.valor = 'NaN'::numeric then
      v_inconsistencias := v_inconsistencias || jsonb_build_array(v_neg.label || ' não é um número válido.');
    elsif v_neg.valor is not null and v_neg.valor < -0.01 then
      v_inconsistencias := v_inconsistencias || jsonb_build_array(v_neg.label || ' está negativo (R$ ' || round(v_neg.valor, 2) || ').');
    end if;
  end loop;

  select exists(
    select 1 from sale_commission_extras
    where sale_id = v_sale.id and (coalesce(valor, 0) < -0.01 or coalesce(percentual, 0) < -0.01)
  ) into v_extra_negativo;
  if v_extra_negativo then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Uma ou mais partes extras têm valor ou percentual negativo.');
  end if;

  if v_sale.corretor_captador is not null and v_sale.corretor_captador_id is null then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Captador "' || v_sale.corretor_captador || '" sem conta vinculada no sistema.');
  end if;
  if v_sale.corretor_vendedor is not null and v_sale.corretor_vendedor_id is null then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Vendedor "' || v_sale.corretor_vendedor || '" sem conta vinculada no sistema.');
  end if;
  for v_extra_link in
    select nome, papel from sale_commission_extras
    where sale_id = v_sale.id and nome is not null and user_id is null
      and papel in ('gestor', 'team_leader', 'corretor_captador', 'corretor_vendedor')
  loop
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      (case v_extra_link.papel
        when 'gestor' then 'Gestor'
        when 'team_leader' then 'Team Leader'
        when 'corretor_captador' then 'Outro corretor captador'
        else 'Outro corretor vendedor'
      end) || ' "' || v_extra_link.nome || '" sem conta vinculada no sistema.'
    );
  end loop;

  if v_indicador_captador - v_captador > 0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('O indicador do captador ultrapassa a comissão do captador em R$ ' || round(v_indicador_captador - v_captador, 2) || '.');
  end if;
  if v_indicador_vendedor - v_vendedor > 0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('O indicador do vendedor ultrapassa a comissão do vendedor em R$ ' || round(v_indicador_vendedor - v_vendedor, 2) || '.');
  end if;
  if v_comissao_bruta > 0 and (v_captador + v_vendedor) - v_comissao_bruta > 0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('A soma das comissões de captador e vendedor ultrapassa a comissão bruta em R$ ' || round((v_captador + v_vendedor) - v_comissao_bruta, 2) || '.');
  end if;
  if v_comissao_bruta > 0 and v_parceria - v_comissao_bruta > 0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('A parceria externa ultrapassa a comissão bruta em R$ ' || round(v_parceria - v_comissao_bruta, 2) || '.');
  end if;

  select
    coalesce(sum(valor) filter (where papel in ('gestor', 'team_leader')), 0),
    coalesce(sum(valor) filter (where papel not in ('gestor', 'team_leader') and origem = 'captador'), 0),
    coalesce(sum(valor) filter (where papel not in ('gestor', 'team_leader') and origem = 'vendedor'), 0),
    coalesce(sum(valor) filter (where papel not in ('gestor', 'team_leader') and origem = 'imobiliaria'), 0)
  into v_extra_gestores, v_extra_captador, v_extra_vendedor, v_extra_imobiliaria
  from sale_commission_extras
  where sale_id = v_sale.id;

  v_outros_extras := v_extra_captador + v_extra_vendedor + v_extra_imobiliaria;
  v_gestores_team_leaders := v_lider_captador + v_lider_vendedor + v_extra_gestores;

  v_liquido_captador := v_captador - v_indicador_captador - v_extra_captador;
  v_liquido_vendedor := v_vendedor - v_indicador_vendedor - v_extra_vendedor;

  if v_liquido_captador < -0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('O líquido do captador ficou negativo em R$ ' || round(abs(v_liquido_captador), 2) || ' — indicador e/ou extras descontados do captador somam mais que a comissão bruta dele.');
  end if;
  if v_liquido_vendedor < -0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('O líquido do vendedor ficou negativo em R$ ' || round(abs(v_liquido_vendedor), 2) || ' — indicador e/ou extras descontados do vendedor somam mais que a comissão bruta dele.');
  end if;

  if v_tem_remax then
    v_saldo_inicial := coalesce(v_parte_remax, 0) - v_captador - v_vendedor;
  else
    v_saldo_inicial := coalesce(v_sale.valor_comissao_imobiliaria, 0);
  end if;

  v_saldo_liquido := v_saldo_inicial - v_gestores_team_leaders - v_extra_imobiliaria;

  if v_saldo_liquido < -0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Os pagamentos atribuídos à imobiliária (gestores, Team Leaders e extras) ultrapassam o saldo disponível em R$ ' || round(abs(v_saldo_liquido), 2) || '.');
  end if;

  v_total_distribuido := v_liquido_captador + v_liquido_vendedor + v_indicador_captador + v_indicador_vendedor
    + v_gestores_team_leaders + v_outros_extras + v_saldo_liquido + v_parceria;
  v_diferenca := round(v_comissao_bruta - v_total_distribuido, 2);

  if v_total_distribuido = 'NaN'::numeric then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('O cálculo da distribuição resultou num valor inválido — confira os campos preenchidos.');
  elsif abs(v_diferenca) > 0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Diferença de R$ ' || v_diferenca || ' entre a comissão bruta e o total distribuído — confira os valores da divisão da comissão.');
  end if;

  return jsonb_build_object(
    'modalidade', 'padrao',
    'valor_negociado', v_negociado,
    'comissao_bruta', v_comissao_bruta,
    'parceria_externa', v_parceria,
    'parte_remax', v_parte_remax,
    'comissao_bruta_captador', v_captador,
    'comissao_bruta_vendedor', v_vendedor,
    'indicador_captador', v_indicador_captador,
    'indicador_vendedor', v_indicador_vendedor,
    'liquido_captador', v_liquido_captador,
    'liquido_vendedor', v_liquido_vendedor,
    'gestores_team_leaders', v_gestores_team_leaders,
    'outros_extras', v_outros_extras,
    'descontos_extra_captador', v_extra_captador,
    'descontos_extra_vendedor', v_extra_vendedor,
    'descontos_extra_imobiliaria', v_extra_imobiliaria,
    'saldo_inicial_imobiliaria', v_saldo_inicial,
    'saldo_liquido_imobiliaria', v_saldo_liquido,
    'total_distribuido', round(v_total_distribuido, 2),
    'diferenca_restante', v_diferenca,
    'inconsistencias', v_inconsistencias,
    'calculo_valido', jsonb_array_length(v_inconsistencias) = 0
  );
end;
$function$;
