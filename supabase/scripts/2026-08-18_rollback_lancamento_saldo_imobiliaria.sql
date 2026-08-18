-- ROLLBACK exato da feature "saldo automático da imobiliária/construtora" do Lançamento
-- (migrations 20260818000000, 20260818010000, 20260818020000) E da correção de comissão por
-- percentual (migration 20260819000000_lancamento_permite_comissao_por_percentual.sql, que estende
-- criar_ocorrencia_lancamento pra depender de calcular_distribuicao_venda). Atualizado quando essa
-- 4ª migration entrou no PR -- antes disso o rollback cobria só as 3 primeiras, e ficava incompleto
-- porque não desfazia a dependência nova que 20260819000000 criou.
--
-- Não é uma migration — é um script de operação manual, executado deliberadamente por alguém com
-- acesso, do mesmo jeito que os scripts de correção/reversão de comissão já existentes nesta pasta
-- (2026-08-17_corrige_comissao_aline_duas_parcelas.sql / 2026-08-17_reverte_comissao_aline_duas_parcelas.sql).
-- NÃO roda sozinho em nenhum replay (`supabase start`/`db push`) — só se alguém explicitamente
-- executar este arquivo contra um banco.
--
-- POR SEGURANÇA, este rollback NÃO remove as 3 colunas de auditoria
-- (lancamento_saldo_imobiliaria/confirmado_em/confirmado_por) — ficam paradas em sales, sem efeito
-- em nada (nenhum trigger/RPC as lê mais depois deste rollback), só preservando o histórico do que
-- já foi confirmado antes da reversão. Remover essas colunas é uma decisão separada, deliberada, se
-- algum dia for necessária — não faz parte deste rollback. Pelo mesmo motivo, também não mexe em
-- nenhuma linha já gravada em occurrences/occurrence_commissions/sales_status_history/activity_logs
-- -- Ocorrências já criadas (com valor_comissao derivado por percentual ou gravado direto) continuam
-- exatamente como estão; o rollback só desfaz FUNÇÕES, TRIGGER e a lógica que passaria a valer pra
-- operações NOVAS depois da reversão.
--
-- ORDEM DE REVERSÃO (rigorosamente o inverso da ordem de aplicação das 4 migrations) e por quê:
--   aplicação:  818000000 (calcular_distribuicao_venda ganha branch lançamento)
--            -> 818010000 (RPCs salvar_divisao/concluir + trigger, chamam calcular_distribuicao_venda)
--            -> 818020000 (RPC criar_lancamento, independente das 2 acima)
--            -> 819000000 (criar_ocorrencia_lancamento passa a CHAMAR calcular_distribuicao_venda
--                          em vez de ter fórmula própria -- dependência NOVA, é o motivo desta
--                          atualização do rollback)
--   reversão:   trigger/função da trigger (consome calcular_distribuicao_venda E o estado da venda)
--            -> as 3 RPCs de 818010000/818020000 (param de existir -- nada mais as chama)
--            -> criar_ocorrencia_lancamento restaurado ANTES de calcular_distribuicao_venda: se a
--               ordem fosse invertida, haveria uma janela em que criar_ocorrencia_lancamento (ainda
--               com o corpo de 819000000, chamando calcular_distribuicao_venda) executaria contra
--               uma calcular_distribuicao_venda JÁ sem o branch modalidade='lancamento' -- cairia na
--               lógica de Venda Normal (captador/vendedor/REMAX, campos que uma venda de Lançamento
--               nunca preenche) e devolveria comissao_bruta incorreta sem erro nenhum, silenciosamente.
--               Restaurando criar_ocorrencia_lancamento primeiro, essa função já volta a ter sua
--               própria checagem de valor_total_comissao (sem depender de calcular_distribuicao_venda
--               reconhecer lançamento) antes da outra função perder esse branch.
--            -> por último, calcular_distribuicao_venda volta ao corpo pré-818000000.
-- Numa única transação (begin/commit) -- ou tudo aplica, ou nada, nunca um estado parcial.

begin;

-- 1) Trigger de segurança da conclusão (bloqueava UPDATE direto sem confirmação). Depende das
-- colunas lancamento_saldo_* (mantidas) e de calcular_distribuicao_venda -- remove antes de mexer
-- em qualquer uma das duas.
drop trigger if exists trg_validar_distribuicao_concluir_lancamento on public.sales;
drop function if exists public.validar_distribuicao_antes_concluir_lancamento();

-- 2) As 3 RPCs de 818010000/818020000. Nenhuma outra função do banco as chama, então podem cair
-- em qualquer ordem entre si.
drop function if exists public.concluir_lancamento(uuid, numeric);
drop function if exists public.salvar_divisao_comissao_lancamento(uuid, jsonb);
drop function if exists public.criar_lancamento(text, text, text);

-- 3) Restaura criar_ocorrencia_lancamento(uuid) pro corpo EXATO de antes de 20260819000000 --
-- cópia literal de supabase/migrations/20260811040000_criar_ocorrencia_lancamento_rpc.sql (a mesma
-- versão que já estava em produção antes de todo este PR, nunca alterada por mais nada além da
-- migration que este rollback está desfazendo). Volta a exigir valor_total_comissao > 0 direto,
-- sem chamar calcular_distribuicao_venda -- por isso PRECISA rodar antes do passo 4 (comentário
-- acima explica o motivo: evita a janela de dependência quebrada).
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

-- 4) Restaura calcular_distribuicao_venda(sales) pro corpo EXATO de antes do branch de lançamento
-- (migration 20260809130000_calcular_distribuicao_venda_overload_row_valida_new.sql) — sem a
-- ramificação `if v_sale.modalidade = 'lancamento' then ... end if;` do topo. Cópia literal, nem
-- uma linha mudou em relação à versão pré-feature.
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
  if v_negociado is null or v_negociado <= 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Valor negociado não informado — valores percentuais (comissão, parceria, REMAX) não puderam ser calculados a partir dele.');
  end if;

  -- Comissão bruta: percentual sempre incide sobre o negociado (regra 3 da distribuição); sem
  -- percentual, usa o valor já gravado (compatibilidade com vendas antigas preenchidas só com valor fixo).
  if v_sale.percentual_comissao is not null and v_negociado > 0 then
    v_comissao_bruta := round(v_sale.percentual_comissao / 100 * v_negociado, 2);
  else
    v_comissao_bruta := coalesce(v_sale.valor_total_comissao, 0);
  end if;

  -- Parceria externa: nunca é receita da unidade — só informativa daqui pra baixo.
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

  -- Captador/vendedor: valores definidos manualmente venda a venda — nunca calculados por percentual fixo.
  v_captador := coalesce(v_sale.valor_comissao_captador, 0);
  v_vendedor := coalesce(v_sale.valor_comissao_vendedor, 0);
  v_indicador_captador := coalesce(v_sale.valor_comissao_indicador_captador, 0);
  v_indicador_vendedor := coalesce(v_sale.valor_comissao_indicador_vendedor, 0);
  v_lider_captador := coalesce(v_sale.valor_comissao_lider_captador, 0);
  v_lider_vendedor := coalesce(v_sale.valor_comissao_lider_vendedor, 0);

  -- Regra 8: nenhum valor ou percentual informado pode ser negativo. Checa todos os campos-base de
  -- uma vez (tolerância de 1 centavo pra não acusar erro de arredondamento como se fosse negativo de verdade).
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

  -- Extras com valor ou percentual negativo (mesma regra 8, agora pra sale_commission_extras).
  select exists(
    select 1 from sale_commission_extras
    where sale_id = v_sale.id and (coalesce(valor, 0) < -0.01 or coalesce(percentual, 0) < -0.01)
  ) into v_extra_negativo;
  if v_extra_negativo then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Uma ou mais partes extras têm valor ou percentual negativo.');
  end if;

  -- Vínculo de conta obrigatório: captador/vendedor principal, "outro captador/vendedor" e
  -- gestor/Team Leader são sempre gente interna — só Parceria Externa pode ficar só no nome.
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

  -- Extras (sale_commission_extras): gestor/team_leader saem exclusivamente do saldo da imobiliária;
  -- os demais respeitam a origem gravada (imobiliaria/captador/vendedor), nunca deduzidos de mais de
  -- um lugar (cada linha entra numa única categoria abaixo).
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

  -- Saldo inicial da imobiliária: com REMAX preenchido, é a parte da unidade menos captador/vendedor
  -- (que são pagos a partir dessa fatia); sem REMAX (venda antiga), usa o campo legado já gravado —
  -- não recalcula, pra não alterar retroativamente vendas fechadas antes desse campo existir.
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

-- Overload por uuid (usado pelo front-end via RPC e pela trigger de Ocorrência) já existia antes
-- da feature e não precisa ser recriado — ele só busca a row e delega pro overload acima, que a
-- partir deste rollback voltou a não reconhecer modalidade = 'lancamento' (toda venda de lançamento
-- passaria a ser tratada pela lógica padrão, que não faz sentido pra ela — ver nota abaixo).

commit;

-- NOTA IMPORTANTE PÓS-ROLLBACK: depois deste script, calcular_distribuicao_venda() não tem mais
-- branch de lançamento — uma venda modalidade='lancamento' cairia na lógica padrão (captador/
-- vendedor/REMAX), que não se aplica a ela e provavelmente devolve lixo. Isso é esperado: o
-- rollback desfaz a FEATURE inteira, não deixa ela "meio aplicada". Se alguma venda de lançamento
-- estiver em andamento nesse momento, ela fica sem cálculo de distribuição até a feature ser
-- reaplicada (as migrations 20260818000000/010000/020000/20260819000000 continuam no repo, só não
-- estão mais refletidas no banco depois deste rollback).
--
-- criar_ocorrencia_lancamento (passo 3 acima) já está protegido dessa mudança — depois do rollback
-- ele voltou a ter sua própria checagem (valor_total_comissao > 0) e não chama mais
-- calcular_distribuicao_venda, então "Enviar ao financeiro" continua funcionando (com a limitação
-- original, sem aceitar comissão só por percentual) mesmo com o branch de lançamento removido da
-- outra função. O que fica exposto ao "devolve lixo" acima é só quem CONTINUA chamando
-- calcular_distribuicao_venda diretamente pra uma venda de Lançamento depois do rollback (ex.: o
-- front-end do PR #5 ainda implantado, que usa essa RPC em refreshDistribuicao()/openConcluir() --
-- código de front não é revertido por este script, só o banco).
