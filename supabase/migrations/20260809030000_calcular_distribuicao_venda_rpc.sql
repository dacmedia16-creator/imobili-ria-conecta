-- Fonte única da distribuição financeira de uma venda — antes duplicada em dois lugares no
-- front-end (Resumo e Ocorrência em vendas.$id.tsx), cada um com sua própria fórmula pra "valor da
-- imobiliária"/líquido do captador/vendedor. As duas já convergiam no resultado, mas por serem
-- implementações separadas podiam divergir silenciosamente a qualquer mudança futura numa só delas.
--
-- FÓRMULA (nenhum percentual é fixo no código — 22,5%/45%/etc não existem aqui, tudo vem das
-- colunas de sales/sale_commission_extras preenchidas venda a venda):
--
--  comissao_bruta   = percentual_comissao/100 * valor_negociado (se percentual informado, incide
--                      sobre o negociado — regra 3) senão valor_total_comissao já gravado.
--  parceria_externa = mesma lógica (percentual sobre negociado, senão valor gravado). Nunca é
--                      receita da unidade (regra 9) — só é informativa, não faz parte de nenhuma
--                      base de cálculo daqui pra baixo.
--  parte_remax      = mesma lógica. Quando NÃO informado (venda antiga — regra de preservação),
--                      o saldo inicial da imobiliária cai pro campo legado valor_comissao_imobiliaria
--                      (que já vinha com parceria descontada por quem preencheu manualmente).
--  captador/vendedor = valores definidos manualmente na venda (regra 4) — nunca calculados aqui.
--  indicador_captador/vendedor = descontado exclusivamente do respectivo líquido (regras 6/7).
--  gestores_team_leaders = líder_captador + líder_vendedor (campos fixos de sales) + extras com
--                      papel gestor/team_leader — tudo isso sai exclusivamente do saldo da
--                      imobiliária (regra 5), nunca do captador/vendedor.
--  outros_extras    = demais linhas de sale_commission_extras (qualquer papel exceto
--                      gestor/team_leader), deduzidas do líquido de quem a origem indica
--                      (imobiliaria/captador/vendedor — regra 8), nunca de mais de um lugar (regra 10).
--
--  saldo_inicial_imobiliaria = parte_remax - captador - vendedor (quando remax preenchido) senão
--                      valor_comissao_imobiliaria (legado).
--  saldo_liquido_imobiliaria = saldo_inicial - gestores_team_leaders - extras com origem imobiliaria.
--  total_distribuido = liquido_captador + liquido_vendedor + indicador_captador + indicador_vendedor
--                      + gestores_team_leaders + outros_extras + saldo_liquido_imobiliaria +
--                      parceria_externa — deve bater com comissao_bruta sempre (cada real conta uma
--                      única vez nessa soma, nunca em dois buckets ao mesmo tempo).
--  diferenca_restante = comissao_bruta - total_distribuido (idealmente 0; usado pra detectar dado
--                      inconsistente, não pra "sobrar" dinheiro sem dono).
--
-- Validado contra o cenário oficial: negociado R$730.000, comissão 6%=R$43.800, parceria
-- 3%=R$21.900, REMAX 3%=R$21.900, captador/vendedor R$4.927,50 cada -> saldo inicial R$12.045.
-- Com gestor R$1.000 -> saldo líquido R$11.045. Com indicador captador R$500 -> líquido captador
-- R$4.427,50. Com indicador vendedor R$300 -> líquido vendedor R$4.627,50. Em todos os casos
-- total_distribuido bate exatamente com comissao_bruta (diferenca_restante = 0).
create or replace function public.calcular_distribuicao_venda(p_sale_id uuid)
 returns jsonb
 language plpgsql
 stable
 security invoker
 set search_path to 'public'
as $function$
declare
  v_sale sales%rowtype;
  v_negociado numeric;
  v_comissao_bruta numeric;
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
  v_outros_extras numeric;
  v_liquido_captador numeric;
  v_liquido_vendedor numeric;
  v_gestores_team_leaders numeric;
  v_saldo_inicial numeric;
  v_saldo_liquido numeric;
  v_total_distribuido numeric;
  v_diferenca numeric;
  v_inconsistencias jsonb := '[]'::jsonb;
begin
  select * into v_sale from sales where id = p_sale_id;
  if not found then
    return jsonb_build_object(
      'inconsistencias', jsonb_build_array('Venda não encontrada.'),
      'calculo_valido', false
    );
  end if;

  v_negociado := v_sale.valor_negociado;
  if v_negociado is null or v_negociado <= 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Valor negociado não informado — valores percentuais (comissão, parceria, REMAX) não puderam ser calculados a partir dele.');
  end if;

  -- Comissão bruta: percentual sempre incide sobre o negociado (regra 3); sem percentual, usa o
  -- valor já gravado (compatibilidade com vendas antigas preenchidas só com valor fixo).
  if v_sale.percentual_comissao is not null and v_negociado > 0 then
    v_comissao_bruta := round(v_sale.percentual_comissao / 100 * v_negociado, 2);
  else
    v_comissao_bruta := coalesce(v_sale.valor_total_comissao, 0);
  end if;

  -- Parceria externa: nunca é receita da unidade (regra 9) — só informativa daqui pra baixo.
  if v_sale.parceria_tipo is null then
    v_parceria := 0;
  elsif v_sale.parceria_percentual is not null and v_negociado > 0 then
    v_parceria := round(v_sale.parceria_percentual / 100 * v_negociado, 2);
  else
    v_parceria := coalesce(v_sale.parceria_valor, 0);
  end if;

  -- Parte da REMAX/unidade — mesma regra de incidência. Vendas antigas sem esse campo preenchido
  -- (nem percentual nem valor) caem no saldo inicial legado abaixo, não aqui.
  v_tem_remax := v_sale.percentual_remax is not null or v_sale.valor_remax is not null;
  if v_sale.percentual_remax is not null and v_negociado > 0 then
    v_parte_remax := round(v_sale.percentual_remax / 100 * v_negociado, 2);
  else
    v_parte_remax := v_sale.valor_remax;
  end if;

  -- Captador/vendedor: valores definidos manualmente venda a venda (regra 4) — nunca calculados.
  v_captador := coalesce(v_sale.valor_comissao_captador, 0);
  v_vendedor := coalesce(v_sale.valor_comissao_vendedor, 0);
  v_indicador_captador := coalesce(v_sale.valor_comissao_indicador_captador, 0);
  v_indicador_vendedor := coalesce(v_sale.valor_comissao_indicador_vendedor, 0);
  v_lider_captador := coalesce(v_sale.valor_comissao_lider_captador, 0);
  v_lider_vendedor := coalesce(v_sale.valor_comissao_lider_vendedor, 0);

  if v_indicador_captador > v_captador then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Indicador do captador (' || v_indicador_captador || ') é maior que a comissão bruta do captador (' || v_captador || ').');
  end if;
  if v_indicador_vendedor > v_vendedor then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Indicador do vendedor (' || v_indicador_vendedor || ') é maior que a comissão bruta do vendedor (' || v_vendedor || ').');
  end if;
  if v_comissao_bruta > 0 and (v_captador + v_vendedor) > v_comissao_bruta then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Soma de captador + vendedor (' || (v_captador + v_vendedor) || ') ultrapassa a comissão bruta (' || v_comissao_bruta || ').');
  end if;

  -- Extras (sale_commission_extras): gestor/team_leader saem exclusivamente do saldo da imobiliária
  -- (regra 5); os demais respeitam a origem gravada (imobiliaria/captador/vendedor — regra 8), nunca
  -- deduzidos de mais de um lugar (regra 10, cada linha entra numa única categoria abaixo).
  select
    coalesce(sum(valor) filter (where papel in ('gestor', 'team_leader')), 0),
    coalesce(sum(valor) filter (where papel not in ('gestor', 'team_leader') and origem = 'captador'), 0),
    coalesce(sum(valor) filter (where papel not in ('gestor', 'team_leader') and origem = 'vendedor'), 0),
    coalesce(sum(valor) filter (where papel not in ('gestor', 'team_leader') and origem = 'imobiliaria'), 0)
  into v_extra_gestores, v_extra_captador, v_extra_vendedor, v_extra_imobiliaria
  from sale_commission_extras
  where sale_id = p_sale_id;

  v_outros_extras := v_extra_captador + v_extra_vendedor + v_extra_imobiliaria;
  v_gestores_team_leaders := v_lider_captador + v_lider_vendedor + v_extra_gestores;

  v_liquido_captador := v_captador - v_indicador_captador - v_extra_captador;
  v_liquido_vendedor := v_vendedor - v_indicador_vendedor - v_extra_vendedor;

  if v_liquido_captador < 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Líquido do captador ficou negativo (' || v_liquido_captador || ') — indicador/extras descontados somam mais que a comissão bruta.');
  end if;
  if v_liquido_vendedor < 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Líquido do vendedor ficou negativo (' || v_liquido_vendedor || ') — indicador/extras descontados somam mais que a comissão bruta.');
  end if;

  -- Saldo inicial da imobiliária: com REMAX preenchido, é a parte da unidade menos captador/vendedor
  -- (que são pagos a partir dessa fatia); sem REMAX (venda antiga), usa o campo legado já gravado —
  -- não recalcula, pra não alterar retroativamente vendas fechadas antes desse campo existir.
  if v_tem_remax then
    v_saldo_inicial := coalesce(v_parte_remax, 0) - v_captador - v_vendedor;
  else
    v_saldo_inicial := coalesce(v_sale.valor_comissao_imobiliaria, 0);
  end if;

  v_saldo_liquido := v_saldo_inicial - v_gestores_team_leaders - v_extra_imobiliaria;

  if v_saldo_liquido < 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Saldo líquido da imobiliária ficou negativo (' || v_saldo_liquido || ') — gestor/team leader/extras descontados somam mais que o saldo inicial.');
  end if;

  v_total_distribuido := v_liquido_captador + v_liquido_vendedor + v_indicador_captador + v_indicador_vendedor
    + v_gestores_team_leaders + v_outros_extras + v_saldo_liquido + v_parceria;
  v_diferenca := round(v_comissao_bruta - v_total_distribuido, 2);

  if abs(v_diferenca) > 0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Diferença de R$ ' || v_diferenca || ' entre a comissão bruta e o total distribuído — confira os valores da divisão da comissão.');
  end if;

  return jsonb_build_object(
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
    'saldo_inicial_imobiliaria', v_saldo_inicial,
    'saldo_liquido_imobiliaria', v_saldo_liquido,
    'total_distribuido', round(v_total_distribuido, 2),
    'diferenca_restante', v_diferenca,
    'inconsistencias', v_inconsistencias,
    'calculo_valido', jsonb_array_length(v_inconsistencias) = 0
  );
end;
$function$;
