-- gerado por gen_estado.py a partir de leitura somente-leitura de produção (definições, sem dados)
set local check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.calcular_distribuicao_venda(p_sale sales)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_sale sales%rowtype := p_sale;
  v_negociado numeric;
  v_comissao_bruta numeric;
  v_comissao_conflito boolean;
  -- ---- variáveis específicas do branch de Lançamento ----
  v_lanc_total_pessoas numeric;
  v_lanc_parceria numeric;
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
  v_comissoes_manuais numeric;
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

  -- Fonte oficial: o valor monetário informado. O percentual é apenas referência derivada.
  -- Fallback pelo percentual existe somente para registros legados sem valor em reais.
  if v_sale.valor_total_comissao is not null then
    v_comissao_bruta := round(v_sale.valor_total_comissao, 2);
  elsif v_sale.percentual_comissao is not null and v_negociado is not null and v_negociado > 0 then
    v_comissao_bruta := round(v_sale.percentual_comissao / 100 * v_negociado, 2);
  else
    v_comissao_bruta := 0;
  end if;

  -- O percentual não bloqueia nem redefine o valor oficial em reais.
  v_comissao_conflito := false;

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
  -- FIM DO BRANCH LANÇAMENTO — daqui pra baixo é o fluxo padrão.
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
  elsif v_sale.parceria_valor is not null then
    v_parceria := round(v_sale.parceria_valor, 2);
  elsif v_sale.parceria_percentual is not null and v_negociado > 0 then
    v_parceria := round(v_sale.parceria_percentual / 100 * v_negociado, 2);
  else
    v_parceria := 0;
  end if;

  if v_sale.parceria_tipo is not null and coalesce(v_sale.parceria_percentual, 0) <= 0 and coalesce(v_sale.parceria_valor, 0) <= 0 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Parceria externa "' || coalesce(v_sale.parceria_nome, '(sem nome)') || '" marcada mas sem percentual nem valor de comissão informado.');
  end if;

  v_tem_remax := v_sale.percentual_remax is not null or v_sale.valor_remax is not null;
  if v_sale.valor_remax is not null then
    v_parte_remax := round(v_sale.valor_remax, 2);
  elsif v_sale.percentual_remax is not null and v_negociado > 0 then
    v_parte_remax := round(v_sale.percentual_remax / 100 * v_negociado, 2);
  else
    v_parte_remax := null;
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
  -- NOVO: mesma trava de vínculo obrigatório, agora pro indicador — só dispara se tiver nome sem id
  -- (indicador continua opcional; sem nome, não gera inconsistência nenhuma).
  if v_sale.indicador_captador is not null and v_sale.indicador_captador_id is null then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Indicador do captador "' || v_sale.indicador_captador || '" sem conta vinculada no sistema.');
  end if;
  if v_sale.indicador_vendedor is not null and v_sale.indicador_vendedor_id is null then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Indicador do vendedor "' || v_sale.indicador_vendedor || '" sem conta vinculada no sistema.');
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

  select coalesce(sum(oc.valor), 0)
  into v_comissoes_manuais
  from public.occurrence_commissions oc
  join public.occurrences o on o.id = oc.occurrence_id
  where o.sale_id = v_sale.id
    and oc.managed_by_sale is false
    and oc.sale_commission_extra_id is null
    and not coalesce(oc.sem_cadastro_confirmado, false);

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

  v_saldo_liquido := v_saldo_inicial - v_gestores_team_leaders - v_extra_imobiliaria - v_comissoes_manuais;

  if v_saldo_liquido < -0.01 then
    v_inconsistencias := v_inconsistencias || jsonb_build_array('Os pagamentos atribuídos à imobiliária (gestores, Team Leaders e extras) ultrapassam o saldo disponível em R$ ' || round(abs(v_saldo_liquido), 2) || '.');
  end if;

  v_total_distribuido := v_liquido_captador + v_liquido_vendedor + v_indicador_captador + v_indicador_vendedor
    + v_gestores_team_leaders + v_outros_extras + v_comissoes_manuais + v_saldo_liquido + v_parceria;
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
    'comissoes_manuais_imobiliaria', v_comissoes_manuais,
    'saldo_inicial_imobiliaria', v_saldo_inicial,
    'saldo_liquido_imobiliaria', v_saldo_liquido,
    'total_distribuido', round(v_total_distribuido, 2),
    'diferenca_restante', v_diferenca,
    'inconsistencias', v_inconsistencias,
    'calculo_valido', jsonb_array_length(v_inconsistencias) = 0
  );
end;
$function$;
alter function public.calcular_distribuicao_venda(sales) owner to postgres;
revoke all on function public.calcular_distribuicao_venda(sales) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.calcular_distribuicao_venda(sales) to postgres;
grant execute on function public.calcular_distribuicao_venda(sales) to authenticated;
grant execute on function public.calcular_distribuicao_venda(sales) to service_role;
grant execute on function public.calcular_distribuicao_venda(sales) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.calcular_distribuicao_venda(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_sale public.sales%rowtype;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    return jsonb_build_object(
      'inconsistencias', jsonb_build_array('Venda não encontrada.'),
      'calculo_valido', false
    );
  end if;
  return public.calcular_distribuicao_venda(v_sale);
end;
$function$;
alter function public.calcular_distribuicao_venda(uuid) owner to postgres;
revoke all on function public.calcular_distribuicao_venda(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.calcular_distribuicao_venda(uuid) to postgres;
grant execute on function public.calcular_distribuicao_venda(uuid) to authenticated;
grant execute on function public.calcular_distribuicao_venda(uuid) to service_role;
grant execute on function public.calcular_distribuicao_venda(uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.can_edit_sale_as_co_leader(_sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((
  SELECT public.can_manage_sale_as_co_leader(_sale_id)
    AND NOT public.is_sale_locked(_sale_id)
    AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = _sale_id
      AND s.status::text = ANY(ARRAY['rascunho','enviada_revisao',
        'contrato_conferencia_gestor','contrato_ok_corretor','aguardando_assinatura',
        'contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor']))
  ),false) AND public.mt_1b_gate() AND ((EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres')));
$function$;
alter function public.can_edit_sale_as_co_leader(uuid) owner to postgres;
revoke all on function public.can_edit_sale_as_co_leader(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.can_edit_sale_as_co_leader(uuid) to postgres;
grant execute on function public.can_edit_sale_as_co_leader(uuid) to authenticated;
grant execute on function public.can_edit_sale_as_co_leader(uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.can_manage_sale_as_co_leader(_sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((
  SELECT public.can_read_principal_sale_as_co_leader(_sale_id)
    AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = _sale_id AND s.modalidade = 'padrao')
  ),false) AND public.mt_1b_gate() AND ((EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres')));
$function$;
alter function public.can_manage_sale_as_co_leader(uuid) owner to postgres;
revoke all on function public.can_manage_sale_as_co_leader(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.can_manage_sale_as_co_leader(uuid) to postgres;
grant execute on function public.can_manage_sale_as_co_leader(uuid) to authenticated;
grant execute on function public.can_manage_sale_as_co_leader(uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.can_read_principal_sale_as_co_leader(_sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((
  SELECT EXISTS (
    SELECT 1
    FROM public.sales s
    JOIN public.teams t ON t.lider_id = s.corretor_id
    JOIN public.team_co_leaders cl ON cl.team_id = t.id
    JOIN public.profiles p ON p.id = cl.user_id AND p.ativo IS TRUE
    WHERE s.id = _sale_id
      AND cl.user_id = (SELECT auth.uid())
      AND public.has_any_role(cl.user_id, ARRAY['gestor','team_leader']::public.app_role[])
  )
  ),false) AND public.mt_1b_gate() AND ((EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres')));
$function$;
alter function public.can_read_principal_sale_as_co_leader(uuid) owner to postgres;
revoke all on function public.can_read_principal_sale_as_co_leader(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.can_read_principal_sale_as_co_leader(uuid) to postgres;
grant execute on function public.can_read_principal_sale_as_co_leader(uuid) to authenticated;
grant execute on function public.can_read_principal_sale_as_co_leader(uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.can_read_sale_juridico_certidao(_sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((
  SELECT COALESCE(public.is_active_user(auth.uid())
    AND public.has_role(auth.uid(), 'juridico'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.sales s
      JOIN public.sale_juridico_reached r ON r.sale_id = s.id
      WHERE s.id = _sale_id AND s.modalidade = 'padrao'
        AND s.status::text IN (
          'enviada_revisao','devolvida_ajuste',
          'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
          'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
          'aguardando_assinatura','contrato_assinado','ocorrencia_pendente',
          'ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
        )
    ), false)
  ),false) AND public.mt_1b_gate() AND ((EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres')));
$function$;
alter function public.can_read_sale_juridico_certidao(uuid) owner to postgres;
revoke all on function public.can_read_sale_juridico_certidao(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.can_read_sale_juridico_certidao(uuid) to postgres;
grant execute on function public.can_read_sale_juridico_certidao(uuid) to authenticated;
grant execute on function public.can_read_sale_juridico_certidao(uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  SELECT public.is_active_user(_user) AND EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND s.organization_id = (SELECT public.user_org(_user)) AND (
      s.corretor_id = _user
      OR s.corretor_captador_id = _user
      OR s.corretor_vendedor_id = _user
      OR s.lider_captador_id = _user
      OR s.lider_vendedor_id = _user
      OR EXISTS (SELECT 1 FROM public.sale_commission_extras sce WHERE sce.sale_id = s.id AND sce.user_id = _user)
      OR public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (public.has_any_role(_user, ARRAY['gestor','team_leader']::public.app_role[])
          AND (public.is_lead_of(_user, s.corretor_id) OR public.is_lead_of_sale_corretor(_user, s.id)))
      OR (public.has_role(_user,'juridico'::public.app_role) AND s.status::text = ANY (ARRAY[
        'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
        'aguardando_assinatura','contrato_assinado',
        'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
      ]))
    )
  )

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_user) AND EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$;
alter function public.can_view_sale(uuid,uuid) owner to postgres;
revoke all on function public.can_view_sale(uuid,uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.can_view_sale(uuid,uuid) to postgres;
grant execute on function public.can_view_sale(uuid,uuid) to service_role;
grant execute on function public.can_view_sale(uuid,uuid) to anon;
grant execute on function public.can_view_sale(uuid,uuid) to authenticated;
grant execute on function public.can_view_sale(uuid,uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.carreira_clube(_ano integer DEFAULT NULL::integer)
 RETURNS TABLE(ano integer, vgc_ano_anterior numeric, clube_atual text, tabela_atual integer, vgc_ano_corrente numeric, clube_buscando text, proximo_clube text, falta_proximo numeric, tabela_buscando integer, origem text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
  _a integer := coalesce(_ano, extract(year FROM now() AT TIME ZONE 'America/Sao_Paulo')::integer);
  _vgc_ant numeric; _vgc_cor numeric; _t_at integer; _t_bu integer;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF _a < 2000 OR _a > 2100 THEN RAISE EXCEPTION 'Ano inválido' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(sum(p.valor_individual) FILTER (WHERE extract(year FROM v.data_fechamento) = _a - 1), 0),
         coalesce(sum(p.valor_individual) FILTER (WHERE extract(year FROM v.data_fechamento) = _a), 0)
    INTO _vgc_ant, _vgc_cor
    FROM public.participacoes_comerciais_validas() p
    JOIN public.vendas_comerciais_canonicas() v ON v.sale_id = p.sale_id
    JOIN public.sales s ON s.id = p.sale_id
   WHERE p.user_id = _me AND s.organization_id = _org
     AND v.data_fechamento >= make_date(_a - 1, 1, 1) AND v.data_fechamento <= make_date(_a, 12, 31);
  SELECT max(f.ano) INTO _t_at FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano <= _a;
  SELECT max(f.ano) INTO _t_bu FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano <= _a + 1;
  RETURN QUERY SELECT _a, _vgc_ant,
    (SELECT f.nome FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano = _t_at
        AND f.vgc_minimo <= _vgc_ant ORDER BY f.vgc_minimo DESC LIMIT 1),
    _t_at, _vgc_cor,
    (SELECT f.nome FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano = _t_bu
        AND f.vgc_minimo <= _vgc_cor ORDER BY f.vgc_minimo DESC LIMIT 1),
    (SELECT f.nome FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano = _t_bu
        AND f.vgc_minimo > _vgc_cor ORDER BY f.vgc_minimo LIMIT 1),
    (SELECT f.vgc_minimo - _vgc_cor FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano = _t_bu
        AND f.vgc_minimo > _vgc_cor ORDER BY f.vgc_minimo LIMIT 1),
    _t_bu,
    (SELECT f.origem FROM public.clube_remax_faixas f WHERE f.organization_id = _org AND f.ano = _t_bu
        ORDER BY f.ordem LIMIT 1);
END $function$;
alter function public.carreira_clube(integer) owner to postgres;
revoke all on function public.carreira_clube(integer) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.carreira_clube(integer) to postgres;
grant execute on function public.carreira_clube(integer) to authenticated;
grant execute on function public.carreira_clube(integer) to service_role;
CREATE OR REPLACE FUNCTION public.carreira_ranking(_inicio date, _fim date)
 RETURNS TABLE(posicao integer, user_id uuid, nome text, avatar_url text, captacoes integer, vendas integer, pontos integer, vgv numeric, comissao numeric, eu boolean, valores_visiveis boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id(); _ver boolean;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio OR _fim - _inicio > 366 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  _ver := coalesce((SELECT om.enabled FROM public.organization_modules om
                     WHERE om.organization_id = _org AND om.module = 'ranking_valores'), false);
  RETURN QUERY
  WITH canon AS (
    SELECT v.sale_id, v.vgv_proprio, s.corretor_captador_id AS capt_id, s.corretor_vendedor_id AS vend_id
      FROM public.vendas_comerciais_canonicas() v
      JOIN public.sales s ON s.id = v.sale_id
     WHERE s.organization_id = _org AND v.data_fechamento BETWEEN _inicio AND _fim),
  part AS (
    SELECT p.user_id AS uid, p.sale_id, sum(p.valor_individual) AS valor
      FROM public.participacoes_comerciais_validas() p
      JOIN canon c ON c.sale_id = p.sale_id
     GROUP BY p.user_id, p.sale_id),
  pessoas AS (
    SELECT c.capt_id AS uid FROM canon c WHERE c.capt_id IS NOT NULL
    UNION SELECT c.vend_id FROM canon c WHERE c.vend_id IS NOT NULL
    UNION SELECT pt.uid FROM part pt),
  tot AS (
    SELECT x.uid,
      (SELECT count(*) FROM canon c WHERE c.capt_id = x.uid)::integer AS n_capt,
      (SELECT count(*) FROM canon c WHERE c.vend_id = x.uid)::integer AS n_vend,
      coalesce((SELECT sum(c.vgv_proprio) FROM canon c JOIN part pt ON pt.sale_id = c.sale_id AND pt.uid = x.uid), 0)::numeric AS t_vgv,
      coalesce((SELECT sum(pt.valor) FROM part pt WHERE pt.uid = x.uid), 0)::numeric AS t_com
      FROM pessoas x)
  SELECT (rank() OVER (ORDER BY t.n_capt + t.n_vend DESC))::integer,
         t.uid, pr.nome, pr.avatar_url, t.n_capt, t.n_vend, (t.n_capt + t.n_vend)::integer,
         CASE WHEN _ver OR t.uid = _me THEN t.t_vgv END,
         CASE WHEN _ver OR t.uid = _me THEN t.t_com END,
         t.uid = _me, _ver
    FROM tot t
    JOIN public.profiles pr ON pr.id = t.uid
   ORDER BY t.n_capt + t.n_vend DESC, pr.nome
   LIMIT 100;
END $function$;
alter function public.carreira_ranking(date,date) owner to postgres;
revoke all on function public.carreira_ranking(date,date) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.carreira_ranking(date,date) to postgres;
grant execute on function public.carreira_ranking(date,date) to authenticated;
grant execute on function public.carreira_ranking(date,date) to service_role;
CREATE OR REPLACE FUNCTION public.comissoes_carteira_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with efetivadas as (
    select sale_id, venda_em as efetivada_em
    from public.vendas_comerciais_canonicas()
  ),
  parceria as (
    select occurrence_id, sum(valor) as valor
    from (
      select occurrence_id, coalesce(valor, 0) as valor
      from public.occurrence_partners
      union all
      select occurrence_id, coalesce(valor, 0) as valor
      from public.occurrence_commissions
      where sem_cadastro_confirmado
    ) x
    group by occurrence_id
  )
  select jsonb_build_object(
    'comissao_prevista_total', coalesce(sum(greatest(o.valor_comissao - coalesce(p.valor, 0), 0)) filter (where o.status <> 'concluida'), 0),
    'comissao_concluida_total', coalesce(sum(greatest(o.valor_comissao - coalesce(p.valor, 0), 0)) filter (where o.status = 'concluida'), 0),
    'comissao_parceria_externa_prevista_total', coalesce(sum(coalesce(p.valor, 0)) filter (where o.status <> 'concluida'), 0),
    'comissao_parceria_externa_concluida_total', coalesce(sum(coalesce(p.valor, 0)) filter (where o.status = 'concluida'), 0),
    'liquido_imobiliaria_prevista_total', coalesce(sum(coalesce(
      (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
      (d.resultado->>'saldo_imobiliaria')::numeric,
      0
    )) filter (where o.status <> 'concluida'), 0),
    'liquido_imobiliaria_concluida_total', coalesce(sum(coalesce(
      (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
      (d.resultado->>'saldo_imobiliaria')::numeric,
      0
    )) filter (where o.status = 'concluida'), 0),
    'comissao_por_corretor', coalesce((select jsonb_object_agg(user_id, total) from (
      select oc.user_id::text as user_id, sum(oc.valor) as total
      from public.occurrence_commissions oc
      join public.occurrences oi on oi.id = oc.occurrence_id
      join efetivadas ei on ei.sale_id = oi.sale_id
      join public.sales si on si.id = oi.sale_id
      where oc.user_id is not null
        and not coalesce(oc.sem_cadastro_confirmado, false)
        and si.status::text not in ('cancelada','arquivada')
        and ei.efetivada_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
        and ei.efetivada_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      group by oc.user_id
    ) q), '{}'::jsonb)
  )
  from public.occurrences o
  join efetivadas e on e.sale_id = o.sale_id
  join public.sales s on s.id = o.sale_id
  cross join lateral (
    select public.calcular_distribuicao_venda(s.*) as resultado
  ) d
  left join parceria p on p.occurrence_id = o.id
  where _de <= _ate
    and e.efetivada_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
    and e.efetivada_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
    and s.status::text not in ('cancelada','arquivada')
    and public.has_any_role(
      auth.uid(),
      array['financeiro','admin','super_admin']::public.app_role[]
    );
$function$;
alter function public.comissoes_carteira_periodo(date,date) owner to postgres;
revoke all on function public.comissoes_carteira_periodo(date,date) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.comissoes_carteira_periodo(date,date) to postgres;
grant execute on function public.comissoes_carteira_periodo(date,date) to authenticated;
grant execute on function public.comissoes_carteira_periodo(date,date) to service_role;
grant execute on function public.comissoes_carteira_periodo(date,date) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.comparativo_comissao_6pct()
 RETURNS TABLE(sale_id uuid, codigo_interno text, imovel_id text, modalidade text, status text, corretor_id uuid, valor_negociado numeric, valor_total_comissao numeric, percentual_comissao numeric, parceria_externa numeric, data_fechamento date, evento_fechamento text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_any_role((select auth.uid()), array['admin','super_admin','financeiro']::public.app_role[]) then
    raise exception 'Acesso não autorizado ao Comparativo de Comissão.' using errcode = '42501';
  end if;

  return query
  select s.id, s.codigo_interno, s.imovel_id, s.modalidade::text, s.status::text,
    s.corretor_id, s.valor_negociado, s.valor_total_comissao, s.percentual_comissao,
    coalesce(px.valor, 0), (v.venda_em at time zone 'America/Sao_Paulo')::date,
    case when s.modalidade::text = 'lancamento'
      then 'ocorrencia_analise_financeiro' else 'contrato_assinado' end
  from public.vendas_comerciais_validas() v
  join public.sales s on s.id = v.sale_id
  left join lateral (
    select
      coalesce((select sum(op.valor) from public.occurrences o join public.occurrence_partners op on op.occurrence_id = o.id where o.sale_id = s.id), 0)
      + coalesce((select sum(oc.valor) from public.occurrences o join public.occurrence_commissions oc on oc.occurrence_id = o.id where o.sale_id = s.id and oc.sem_cadastro_confirmado), 0) as valor
  ) px on true
  where s.valor_negociado > 0 and s.valor_total_comissao > 0;
end;
$function$;
alter function public.comparativo_comissao_6pct() owner to postgres;
revoke all on function public.comparativo_comissao_6pct() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.comparativo_comissao_6pct() to postgres;
grant execute on function public.comparativo_comissao_6pct() to authenticated;
grant execute on function public.comparativo_comissao_6pct() to service_role;
grant execute on function public.comparativo_comissao_6pct() to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.comparativo_comissao_6pct_inconsistencias()
 RETURNS TABLE(sale_id uuid, codigo_interno text, modalidade text, motivo text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_any_role((select auth.uid()), array['admin','super_admin','financeiro']::public.app_role[]) then
    raise exception 'Acesso não autorizado ao Comparativo de Comissão.' using errcode = '42501';
  end if;
  return query
  select s.id, s.codigo_interno, s.modalidade::text, 'valores_invalidos'::text
  from public.vendas_comerciais_validas() v
  join public.sales s on s.id = v.sale_id
  where not (s.valor_negociado is not null and s.valor_negociado > 0
    and s.valor_total_comissao is not null and s.valor_total_comissao > 0);
end;
$function$;
alter function public.comparativo_comissao_6pct_inconsistencias() owner to postgres;
revoke all on function public.comparativo_comissao_6pct_inconsistencias() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.comparativo_comissao_6pct_inconsistencias() to postgres;
grant execute on function public.comparativo_comissao_6pct_inconsistencias() to authenticated;
grant execute on function public.comparativo_comissao_6pct_inconsistencias() to service_role;
grant execute on function public.comparativo_comissao_6pct_inconsistencias() to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.current_org_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.mt_ctx_org(true);
END $function$;
alter function public.current_org_id() owner to postgres;
revoke all on function public.current_org_id() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.current_org_id() to postgres;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_org_id() to service_role;
grant execute on function public.current_org_id() to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.dashboard_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with vs as materialized (select * from public.sales),
  vo as materialized (select * from public.occurrences),
  parceria_por_occ as (
    select occurrence_id, sum(valor) as valor
    from (
      select occurrence_id, coalesce(valor, 0) as valor
      from occurrence_partners
      union all
      select occurrence_id, coalesce(valor, 0)
      from occurrence_commissions
      where sem_cadastro_confirmado
    ) p
    group by occurrence_id
  ),
  distribuicao_por_occ as (
    select
      o.id as occurrence_id,
      vd.resultado as resultado
    from vo o
    join vs s on s.id = o.sale_id
    join venda_distribuicao vd on vd.sale_id = s.id
  ),
  minha_parte_ocorrencia as (
    -- Venda com ocorrência: a parte do usuário é a linha dele em occurrence_commissions.
    select sum(oc.valor) as valor
    from occurrence_commissions oc
    join vo o on o.id = oc.occurrence_id
    join vs s on s.id = o.sale_id
    where oc.user_id = auth.uid()
      and coalesce(oc.sem_cadastro_confirmado, false) = false
      and s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
  ),
  minha_parte_venda as (
    -- Antes da ocorrência: líquido do lado em que participa (mesma distribuição oficial),
    -- indicador, líder e extras vinculados à conta do usuário.
    select sum(
      case when s.corretor_captador_id = auth.uid() then coalesce((d.r->>'liquido_captador')::numeric, 0) else 0 end
      + case when s.corretor_vendedor_id = auth.uid() then coalesce((d.r->>'liquido_vendedor')::numeric, 0) else 0 end
      + case when s.indicador_captador_id = auth.uid() then coalesce(s.valor_comissao_indicador_captador, 0) else 0 end
      + case when s.indicador_vendedor_id = auth.uid() then coalesce(s.valor_comissao_indicador_vendedor, 0) else 0 end
      + case when s.lider_captador_id = auth.uid() then coalesce(s.valor_comissao_lider_captador, 0) else 0 end
      + case when s.lider_vendedor_id = auth.uid() then coalesce(s.valor_comissao_lider_vendedor, 0) else 0 end
      + coalesce((select sum(coalesce(e.valor, 0)) from sale_commission_extras e
                  where e.sale_id = s.id and e.user_id = auth.uid()
                    and coalesce(e.sem_cadastro_confirmado, false) = false), 0)
    ) as valor
    from vs s
    join lateral (select vd.resultado as r from venda_distribuicao vd where vd.sale_id = s.id) d on true
    where s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
      and not exists (select 1 from vo o where o.sale_id = s.id)
      and (
        auth.uid() in (s.corretor_captador_id, s.corretor_vendedor_id, s.indicador_captador_id,
                       s.indicador_vendedor_id, s.lider_captador_id, s.lider_vendedor_id)
        or exists (select 1 from sale_commission_extras e where e.sale_id = s.id and e.user_id = auth.uid())
      )
  )
  select jsonb_build_object(
    'funil', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (
        select status::text as status, count(*) as cnt from vs group by status
      ) t
    ),
    'minhas_vendas', (select count(*) from vs s where public.is_sale_corretor(auth.uid(), s.id)),
    'minhas_pendencias', (select count(*) from vs s where s.status::text in ('rascunho','devolvida_ajuste') and public.is_sale_responsavel(auth.uid(), s.id)),
    'meus_contratos_conferir', (select count(*) from vs s where s.status::text = 'contrato_conferencia_corretor' and public.is_sale_responsavel(auth.uid(), s.id)),
    'meus_assinados', (select count(*) from vs s where s.status::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida') and public.is_sale_corretor(auth.uid(), s.id)),
    'minha_comissao_prevista', coalesce((select valor from minha_parte_ocorrencia), 0) + coalesce((select valor from minha_parte_venda), 0),
    'gestor_aguardando_revisao', (select count(*) from vs where status::text = 'enviada_revisao'),
    'gestor_contratos_conferir', (select count(*) from vs where status::text in ('contrato_conferencia_gestor','contrato_ok_corretor')),
    'gestor_ocorrencias_enviar', (select count(*) from vs where status::text in ('ocorrencia_pendente','ocorrencia_devolvida_gestor')),
    'gestor_devolvidas', (select count(*) from vs where status::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')),
    'juridico_aprovadas_gestor', (select count(*) from vs where status::text = 'aprovada_gestor'),
    'juridico_em_elaboracao', (select count(*) from vs where status::text = 'em_elaboracao_contrato'),
    'juridico_aguardando_assinatura', (select count(*) from vs where status::text = 'aguardando_assinatura'),
    'juridico_assinados', (select count(*) from vs where status::text = 'contrato_assinado'),
    'fin_ocorrencias_analise', (select count(*) from vs where status::text = 'ocorrencia_analise_financeiro'),
    'fin_devolvidas', (select count(*) from vs where status::text = 'ocorrencia_devolvida_gestor'),
    'occ_pendentes_total', (select count(*) from vo o join vs s on s.id = o.sale_id where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'occ_concluidas_total', (select count(*) from vo o join vs s on s.id = o.sale_id where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'comissao_prevista_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from vo o
      join vs s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_concluida_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from vo o
      join vs s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_prevista_total', coalesce((
      select sum(p.valor)
      from vo o
      join vs s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_concluida_total', coalesce((
      select sum(p.valor)
      from vo o
      join vs s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_prevista_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from vo o
      join vs s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_concluida_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from vo o
      join vs s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_por_corretor', (
      select coalesce(jsonb_object_agg(user_id, total), '{}'::jsonb) from (
        select oc.user_id::text as user_id, sum(oc.valor) as total
        from occurrence_commissions oc
        join vo o on o.id = oc.occurrence_id
        join vs s on s.id = o.sale_id
        where s.status::text not in ('cancelada','arquivada') and oc.user_id is not null
        group by oc.user_id
      ) t
    )
  );
$function$;
alter function public.dashboard_stats() owner to postgres;
revoke all on function public.dashboard_stats() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.dashboard_stats() to postgres;
grant execute on function public.dashboard_stats() to authenticated;
grant execute on function public.dashboard_stats() to service_role;
grant execute on function public.dashboard_stats() to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.desempenho_ranking_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with vendas_periodo as (
    select
      v.sale_id,
      v.venda_em as fechado_em,
      s.created_at as sale_created_at,
      s.modalidade::text as modalidade
    from public.vendas_comerciais_canonicas() v
    join sales s on s.id = v.sale_id
    where v.venda_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), devolucoes as (
    select sale_id, count(*) as n
    from sale_status_history
    where para::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')
    group by sale_id
  ), participante_venda as (
    select
      oc.user_id,
      vp.sale_id,
      sum(oc.valor) as valor_na_venda,
      coalesce(
        sum(oc.valor) filter (where oc.papel <> 'coordenador_lancamento'),
        0
      ) as valor_equipe_na_venda,
      bool_or(oc.papel <> 'coordenador_lancamento') as conta_equipe,
      bool_or(
        vp.modalidade = 'lancamento'
        and oc.papel = 'coordenador_lancamento'
      ) as gestao_lancamento,
      bool_or(
        vp.modalidade = 'lancamento'
        and oc.papel <> 'coordenador_lancamento'
      ) as corretora_lancamento,
      max(vp.fechado_em) as fechado_em,
      max(extract(epoch from (vp.fechado_em - vp.sale_created_at)) / 86400.0) as dias,
      bool_or(coalesce(d.n, 0) > 0) as teve_devolucao
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join vendas_periodo vp on vp.sale_id = o.sale_id
    left join devolucoes d on d.sale_id = vp.sale_id
    where oc.user_id is not null
    group by oc.user_id, vp.sale_id
  ), ranking_corretor_base as (
    select
      user_id as corretor_id,
      count(*) as vendas_fechadas,
      avg(dias) as tempo_medio_dias,
      count(*) filter (where teve_devolucao) as vendas_com_devolucao,
      sum(valor_na_venda) as comissao,
      bool_or(gestao_lancamento) as gestao_lancamento,
      bool_or(corretora_lancamento) as corretora_lancamento
    from participante_venda
    group by user_id
  ), unidade as (
    -- equipe ATUAL da pessoa (só para exibir ao lado do nome no ranking individual)
    select p.corretor_id, public.equipe_vigente(p.corretor_id, now()) as team_id
    from (select distinct user_id as corretor_id from participante_venda) p
  ), ranking_corretor_full as (
    select r.*, u.team_id
    from ranking_corretor_base r
    left join unidade u on u.corretor_id = r.corretor_id
  ), ranking_corretor as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'corretor_id', corretor_id,
      'vendas_fechadas', vendas_fechadas,
      'tempo_medio_dias', round(tempo_medio_dias::numeric, 1),
      'taxa_devolucao', round((100.0 * vendas_com_devolucao / nullif(vendas_fechadas, 0))::numeric, 0),
      'comissao', comissao,
      'gestao_lancamento', gestao_lancamento,
      'corretora_lancamento', corretora_lancamento
    ) order by comissao desc, vendas_fechadas desc), '[]'::jsonb) as valor
    from ranking_corretor_full
  ), equipe_vendas as (
    select
      p.team_id,
      p.sale_id,
      bool_or(p.teve_devolucao) as teve_devolucao,
      sum(p.valor_equipe_na_venda) as comissao
    from (
      select p.*, public.equipe_vigente(p.user_id, p.fechado_em) as team_id
      from participante_venda p
      where p.conta_equipe
    ) p
    where p.team_id is not null
    group by p.team_id, p.sale_id
  ), ranking_equipe_base as (
    select
      team_id,
      count(*) as vendas_fechadas,
      count(*) filter (where teve_devolucao) as vendas_com_devolucao,
      sum(comissao) as comissao
    from equipe_vendas
    group by team_id
  ), ranking_equipe as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'team_id', r.team_id,
      'team_nome', t.nome,
      'vendas_fechadas', r.vendas_fechadas,
      'comissao', r.comissao,
      'taxa_devolucao', round((100.0 * r.vendas_com_devolucao / nullif(r.vendas_fechadas, 0))::numeric, 0)
    ) order by r.comissao desc, r.vendas_fechadas desc), '[]'::jsonb) as valor
    from ranking_equipe_base r
    join teams t on t.id = r.team_id
  ), captacoes as (
    select count(distinct id) as quantidade
    from sales
    where created_at >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and created_at < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
      and status::text not in ('cancelada','arquivada')
  )
  select jsonb_build_object(
    'ranking_corretor', (select valor from ranking_corretor),
    'ranking_equipe', (select valor from ranking_equipe),
    'quantidade_captacoes', (select quantidade from captacoes)
  )
  where _de <= _ate
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$;
alter function public.desempenho_ranking_periodo(date,date) owner to postgres;
revoke all on function public.desempenho_ranking_periodo(date,date) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.desempenho_ranking_periodo(date,date) to postgres;
grant execute on function public.desempenho_ranking_periodo(date,date) to authenticated;
grant execute on function public.desempenho_ranking_periodo(date,date) to service_role;
grant execute on function public.desempenho_ranking_periodo(date,date) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.equipe_vigente(_user uuid, _em timestamp with time zone)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select h.team_id from public.team_membership_history h
      where h.membro_id = _user and h.vigente_de <= _em
        and (h.vigente_ate is null or h.vigente_ate > _em)
      order by h.vigente_de desc limit 1),
    (select t.id from public.teams t
      where t.lider_id = _user
        and (exists (select 1 from public.team_members m where m.team_id = t.id)
             or public.has_role(_user, 'team_leader'))
      order by t.created_at limit 1)
  );
$function$;
alter function public.equipe_vigente(uuid,timestamp with time zone) owner to postgres;
revoke all on function public.equipe_vigente(uuid,timestamp with time zone) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.equipe_vigente(uuid,timestamp with time zone) to postgres;
grant execute on function public.equipe_vigente(uuid,timestamp with time zone) to authenticated;
grant execute on function public.equipe_vigente(uuid,timestamp with time zone) to service_role;
grant execute on function public.equipe_vigente(uuid,timestamp with time zone) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.exclusive_aprovada_em(_id uuid)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(
    (SELECT (max(h.created_at) AT TIME ZONE 'America/Sao_Paulo')::date FROM public.exclusive_history h
      WHERE h.capture_id = _id AND h.action = 'aprovar'),
    (SELECT c.signed_on FROM public.exclusive_captures c WHERE c.id = _id))
$function$;
alter function public.exclusive_aprovada_em(uuid) owner to postgres;
revoke all on function public.exclusive_aprovada_em(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.exclusive_aprovada_em(uuid) to postgres;
grant execute on function public.exclusive_aprovada_em(uuid) to service_role;
CREATE OR REPLACE FUNCTION public.financeiro_distribuicao_vendas()
 RETURNS TABLE(sale_id uuid, saldo_inicial_imobiliaria numeric, saldo_liquido_imobiliaria numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    v.sale_id,
    coalesce((d.resultado->>'saldo_inicial_imobiliaria')::numeric, 0),
    coalesce(
      (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
      (d.resultado->>'saldo_imobiliaria')::numeric,
      0
    )
  from public.vendas_comerciais_canonicas() v
  join public.sales s on s.id = v.sale_id
  join lateral (
    select vd.resultado from venda_distribuicao vd where vd.sale_id = s.id
  ) d on true
  where s.status::text not in ('cancelada', 'arquivada')
    and public.has_any_role(
      auth.uid(),
      array['financeiro','admin','super_admin']::public.app_role[]
    );
$function$;
alter function public.financeiro_distribuicao_vendas() owner to postgres;
revoke all on function public.financeiro_distribuicao_vendas() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.financeiro_distribuicao_vendas() to postgres;
grant execute on function public.financeiro_distribuicao_vendas() to authenticated;
grant execute on function public.financeiro_distribuicao_vendas() to service_role;
grant execute on function public.financeiro_distribuicao_vendas() to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _in boolean := public.mt_in_ctx_org(_user_id);
BEGIN
  IF current_setting('mt.ctx_pc',true)='1' AND _user_id=auth.uid() THEN
    RETURN coalesce(cardinality(_roles)>0,false) AND public.mt_1b_gate() AND coalesce(_in,false);
  END IF;
  RETURN (SELECT COALESCE((SELECT public.is_active_user(_user_id)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=ANY(_roles))),false)
    AND public.mt_1b_gate() AND (_in
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END $function$;
alter function public.has_any_role(uuid,app_role[]) owner to postgres;
revoke all on function public.has_any_role(uuid,app_role[]) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.has_any_role(uuid,app_role[]) to postgres;
grant execute on function public.has_any_role(uuid,app_role[]) to service_role;
grant execute on function public.has_any_role(uuid,app_role[]) to anon;
grant execute on function public.has_any_role(uuid,app_role[]) to authenticated;
grant execute on function public.has_any_role(uuid,app_role[]) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _in boolean := public.mt_in_ctx_org(_user_id);
BEGIN
  IF current_setting('mt.ctx_pc',true)='1' AND _user_id=auth.uid() THEN
    RETURN _role IS NOT NULL AND public.mt_1b_gate() AND coalesce(_in,false);
  END IF;
  RETURN (SELECT COALESCE((SELECT public.is_active_user(_user_id)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)),false)
    AND public.mt_1b_gate() AND (_in
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END $function$;
alter function public.has_role(uuid,app_role) owner to postgres;
revoke all on function public.has_role(uuid,app_role) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.has_role(uuid,app_role) to postgres;
grant execute on function public.has_role(uuid,app_role) to service_role;
grant execute on function public.has_role(uuid,app_role) to anon;
grant execute on function public.has_role(uuid,app_role) to authenticated;
grant execute on function public.has_role(uuid,app_role) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.is_active_user(_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _in boolean := public.mt_in_ctx_org(_user);
BEGIN
  IF current_setting('mt.ctx_pc',true)='1' AND _user=auth.uid() THEN
    RETURN public.mt_1b_gate() AND coalesce(_in,false);
  END IF;
  RETURN (SELECT COALESCE((SELECT _user IS NOT NULL AND
    COALESCE((SELECT ativo FROM public.profiles WHERE id=_user),true)),false)
    AND public.mt_1b_gate() AND ((_in
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id=_user AND ativo IS TRUE))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END $function$;
alter function public.is_active_user(uuid) owner to postgres;
revoke all on function public.is_active_user(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.is_active_user(uuid) to postgres;
grant execute on function public.is_active_user(uuid) to service_role;
grant execute on function public.is_active_user(uuid) to anon;
grant execute on function public.is_active_user(uuid) to authenticated;
grant execute on function public.is_active_user(uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.is_lead_of(_lider uuid, _membro uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    LEFT JOIN public.teams pt ON pt.id = t.parent_team_id
    WHERE tm.membro_id = _membro
      AND t.organization_id = (SELECT public.user_org(_lider))
      AND (
      t.lider_id = _lider
      OR pt.lider_id = _lider
      OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = t.id AND cl.user_id = _lider)
      OR (pt.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = pt.id AND cl.user_id = _lider))
    )
  )

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_lider) AND public.mt_in_ctx_org(_membro))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$;
alter function public.is_lead_of(uuid,uuid) owner to postgres;
revoke all on function public.is_lead_of(uuid,uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.is_lead_of(uuid,uuid) to postgres;
grant execute on function public.is_lead_of(uuid,uuid) to service_role;
grant execute on function public.is_lead_of(uuid,uuid) to anon;
grant execute on function public.is_lead_of(uuid,uuid) to authenticated;
grant execute on function public.is_lead_of(uuid,uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.is_lead_of_sale_corretor(_lider uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _lider IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sale_corretores(_sale_id) c WHERE public.is_lead_of(_lider, c)
  )
$function$;
alter function public.is_lead_of_sale_corretor(uuid,uuid) owner to mt_1b_definer;
revoke all on function public.is_lead_of_sale_corretor(uuid,uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.is_lead_of_sale_corretor(uuid,uuid) to mt_1b_definer;
grant execute on function public.is_lead_of_sale_corretor(uuid,uuid) to authenticated;
grant execute on function public.is_lead_of_sale_corretor(uuid,uuid) to service_role;
CREATE OR REPLACE FUNCTION public.is_lead_of_sale_responsavel(_lider uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _lider IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sale_responsaveis(_sale_id) c WHERE public.is_lead_of(_lider, c)
  )
$function$;
alter function public.is_lead_of_sale_responsavel(uuid,uuid) owner to mt_1b_definer;
revoke all on function public.is_lead_of_sale_responsavel(uuid,uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.is_lead_of_sale_responsavel(uuid,uuid) to mt_1b_definer;
grant execute on function public.is_lead_of_sale_responsavel(uuid,uuid) to authenticated;
grant execute on function public.is_lead_of_sale_responsavel(uuid,uuid) to service_role;
CREATE OR REPLACE FUNCTION public.is_platform_super_admin(_user uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user)
$function$;
alter function public.is_platform_super_admin(uuid) owner to postgres;
revoke all on function public.is_platform_super_admin(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.is_platform_super_admin(uuid) to postgres;
grant execute on function public.is_platform_super_admin(uuid) to authenticated;
grant execute on function public.is_platform_super_admin(uuid) to service_role;
grant execute on function public.is_platform_super_admin(uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.is_sale_corretor(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user IS NOT NULL AND EXISTS (SELECT 1 FROM public.sale_corretores(_sale_id) c WHERE c = _user)
$function$;
alter function public.is_sale_corretor(uuid,uuid) owner to mt_1b_definer;
revoke all on function public.is_sale_corretor(uuid,uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.is_sale_corretor(uuid,uuid) to mt_1b_definer;
grant execute on function public.is_sale_corretor(uuid,uuid) to authenticated;
grant execute on function public.is_sale_corretor(uuid,uuid) to service_role;
CREATE OR REPLACE FUNCTION public.is_sale_locked(_sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
  SELECT EXISTS (
    SELECT 1 FROM public.occurrences o
    WHERE o.sale_id = _sale_id AND o.aceita_financeiro = true
  ) OR EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND s.status::text = 'ocorrencia_concluida'
  )
  ),false) AND public.mt_1b_gate() AND ((EXISTS (SELECT 1 FROM public.sales WHERE id=_sale_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres')));
$function$;
alter function public.is_sale_locked(uuid) owner to postgres;
revoke all on function public.is_sale_locked(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.is_sale_locked(uuid) to postgres;
grant execute on function public.is_sale_locked(uuid) to service_role;
grant execute on function public.is_sale_locked(uuid) to anon;
grant execute on function public.is_sale_locked(uuid) to authenticated;
grant execute on function public.is_sale_locked(uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.is_sale_responsavel(_user uuid, _sale_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user IS NOT NULL AND EXISTS (SELECT 1 FROM public.sale_responsaveis(_sale_id) c WHERE c = _user)
$function$;
alter function public.is_sale_responsavel(uuid,uuid) owner to mt_1b_definer;
revoke all on function public.is_sale_responsavel(uuid,uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.is_sale_responsavel(uuid,uuid) to mt_1b_definer;
grant execute on function public.is_sale_responsavel(uuid,uuid) to authenticated;
grant execute on function public.is_sale_responsavel(uuid,uuid) to service_role;
CREATE OR REPLACE FUNCTION public.leads_team_or_parent(_team_id uuid, _user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = _team_id AND (
      t.lider_id = _user
      OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = t.id AND cl.user_id = _user)
      OR EXISTS (
        SELECT 1 FROM public.teams pt
        WHERE pt.id = t.parent_team_id
        AND (pt.lider_id = _user OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = pt.id AND cl.user_id = _user))
      )
    )
  )

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_user) AND EXISTS (SELECT 1 FROM public.teams WHERE id=_team_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$;
alter function public.leads_team_or_parent(uuid,uuid) owner to postgres;
revoke all on function public.leads_team_or_parent(uuid,uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.leads_team_or_parent(uuid,uuid) to postgres;
grant execute on function public.leads_team_or_parent(uuid,uuid) to service_role;
grant execute on function public.leads_team_or_parent(uuid,uuid) to anon;
grant execute on function public.leads_team_or_parent(uuid,uuid) to authenticated;
grant execute on function public.leads_team_or_parent(uuid,uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.list_vendas_comerciais_paginadas(_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, _statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[], _midia text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with assinaturas as (
    select o.sale_id, max(o.data_assinatura) as data_assinatura
    from public.occurrences o
    group by o.sale_id
  ), base as (
    select
      s.id,
      s.status,
      s.valor_negociado,
      s.imovel_id,
      s.codigo_interno,
      s.corretor_captador,
      s.corretor_vendedor,
      s.updated_at,
      s.created_at,
      s.corretor_id,
      s.modalidade,
      s.data_assinatura,
      case
        when s.modalidade::text = 'lancamento' then
          coalesce(
            s.data_assinatura,
            (s.created_at at time zone 'America/Sao_Paulo')::date
          )
        else
          coalesce(
            u.data_assinatura,
            a.data_assinatura,
            s.data_assinatura,
            (s.created_at at time zone 'America/Sao_Paulo')::date
          )
      end as data_venda
    from public.sales s
    left join assinaturas a on a.sale_id = s.id
    left join lateral (
      select (max(h.created_at) at time zone 'America/Sao_Paulo')::date as data_assinatura
      from public.sale_status_history h
      where h.sale_id = s.id
        and h.para::text = 'contrato_assinado'
    ) u on true
    where (_status is null or s.status::text = _status)
      and (_statuses is null or s.status::text = any(_statuses))
      and (_corretor_ids is null or exists (
        select 1 from unnest(_corretor_ids) c where public.is_sale_corretor(c, s.id)
      ))
      and (_midia is null
        or (_midia = '__sem_midia__' and s.midia is null)
        or s.midia = _midia)
  ), filtradas as (
    select b.*
    from base b
    where b.data_venda is not null
      and (_desde is null or b.data_venda >= _desde)
      and (_ate is null or b.data_venda <= _ate)
      and (
        nullif(trim(_q), '') is null
        or b.imovel_id ilike '%' || trim(_q) || '%'
        or b.codigo_interno ilike '%' || trim(_q) || '%'
        or b.corretor_captador ilike '%' || trim(_q) || '%'
        or b.corretor_vendedor ilike '%' || trim(_q) || '%'
        or exists (
          select 1 from public.sales se
          where se.id = b.id
            and concat_ws(' ', se.imovel_endereco, se.imovel_logradouro, se.imovel_bairro, se.imovel_cidade, se.imovel_cep)
                ilike '%' || trim(_q) || '%'
        )
        or exists (
          select 1
          from public.sale_parties sp
          where sp.sale_id = b.id
            and sp.nome ilike '%' || trim(_q) || '%'
        )
      )
  ), pagina as (
    select f.*, public.sale_corretores_ids(f.id) as corretores_ids
    from filtradas f
    order by data_venda desc, id
    limit least(greatest(coalesce(_page_size, 10), 1), 50)
    offset greatest(coalesce(_page, 0), 0) * least(greatest(coalesce(_page_size, 10), 1), 50)
  ), totais as (
    select
      count(*)::integer as total_count,
      coalesce(sum(coalesce(valor_negociado, 0)) filter (where status::text not in ('cancelada', 'arquivada')), 0) as total_valor
    from filtradas
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(p) order by p.data_venda desc, p.id) from pagina p),
      '[]'::jsonb
    ),
    'total_count', totais.total_count,
    'total_valor', totais.total_valor
  )
  from totais;
$function$;
alter function public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[],text) owner to postgres;
revoke all on function public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[],text) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[],text) to postgres;
grant execute on function public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[],text) to authenticated;
grant execute on function public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[],text) to service_role;
grant execute on function public.list_vendas_comerciais_paginadas(integer,integer,text,text[],date,date,text,uuid[],text) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.list_vendas_comerciais_paginadas_fila(_page integer DEFAULT 0, _page_size integer DEFAULT 10, _status text DEFAULT NULL::text, _statuses text[] DEFAULT NULL::text[], _desde date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _q text DEFAULT NULL::text, _corretor_ids uuid[] DEFAULT NULL::uuid[], _midia text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH assinaturas AS (
    SELECT o.sale_id, max(o.data_assinatura) AS data_assinatura
    FROM public.occurrences o
    GROUP BY o.sale_id
  ), base AS (
    SELECT
      s.id,
      s.status,
      s.valor_negociado,
      s.imovel_id,
      s.codigo_interno,
      s.corretor_captador,
      s.corretor_vendedor,
      s.updated_at,
      s.created_at,
      s.corretor_id,
      s.modalidade,
      s.data_assinatura,
      CASE
        WHEN s.modalidade::text = 'lancamento' THEN
          coalesce(s.data_assinatura, (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
        ELSE coalesce(u.data_assinatura, a.data_assinatura, s.data_assinatura, (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
      END AS data_venda
    FROM public.sales s
    LEFT JOIN assinaturas a ON a.sale_id = s.id
    LEFT JOIN LATERAL (
      SELECT (max(h.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS data_assinatura
      FROM public.sale_status_history h
      WHERE h.sale_id = s.id
        AND h.para::text = 'contrato_assinado'
    ) u ON true
    WHERE (_status IS NULL OR s.status::text = _status)
      AND (_statuses IS NULL OR s.status::text = ANY(_statuses))
      AND (_corretor_ids IS NULL OR EXISTS (
        SELECT 1 FROM unnest(_corretor_ids) c WHERE public.is_sale_corretor(c, s.id)
      ))
      AND (_midia IS NULL
        OR (_midia = '__sem_midia__' AND s.midia IS NULL)
        OR s.midia = _midia)
  ), filtradas AS (
    SELECT b.*
    FROM base b
    WHERE b.data_venda IS NOT NULL
      AND (_desde IS NULL OR b.data_venda >= _desde)
      AND (_ate IS NULL OR b.data_venda <= _ate)
      AND (
        nullif(trim(_q), '') IS NULL
        OR b.imovel_id ILIKE '%' || trim(_q) || '%'
        OR b.codigo_interno ILIKE '%' || trim(_q) || '%'
        OR b.corretor_captador ILIKE '%' || trim(_q) || '%'
        OR b.corretor_vendedor ILIKE '%' || trim(_q) || '%'
        OR exists (
          select 1 from public.sales se
          where se.id = b.id
            and concat_ws(' ', se.imovel_endereco, se.imovel_logradouro, se.imovel_bairro, se.imovel_cidade, se.imovel_cep)
                ILIKE '%' || trim(_q) || '%'
        )
        OR EXISTS (
          SELECT 1
          FROM public.sale_parties sp
          WHERE sp.sale_id = b.id
            AND sp.nome ILIKE '%' || trim(_q) || '%'
        )
      )
      AND (
        (
          b.status::text IN ('rascunho', 'devolvida_ajuste', 'contrato_conferencia_corretor')
          AND is_sale_responsavel(auth.uid(), b.id)
        )
        OR (
          b.status::text IN (
            'enviada_revisao', 'contrato_conferencia_gestor', 'contrato_ok_corretor',
            'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
            'ocorrencia_devolvida_gestor'
          )
          AND has_any_role(auth.uid(), ARRAY['gestor', 'team_leader']::app_role[])
          AND (is_lead_of_sale_responsavel(auth.uid(), b.id) OR is_sale_responsavel(auth.uid(), b.id))
        )
        OR (
          b.status::text IN ('aprovada_gestor', 'enviada_juridico', 'em_elaboracao_contrato')
          AND has_role(auth.uid(), 'juridico'::app_role)
        )
        OR (
          b.status::text = 'ocorrencia_analise_financeiro'
          AND has_role(auth.uid(), 'financeiro'::app_role)
        )
      )
  ), pagina AS (
    SELECT f.*, public.sale_corretores_ids(f.id) AS corretores_ids
    FROM filtradas f
    ORDER BY data_venda DESC, id
    LIMIT least(greatest(coalesce(_page_size, 10), 1), 50)
    OFFSET greatest(coalesce(_page, 0), 0) * least(greatest(coalesce(_page_size, 10), 1), 50)
  ), totais AS (
    SELECT count(*)::integer AS total_count, coalesce(sum(coalesce(valor_negociado, 0)) FILTER (WHERE status::text NOT IN ('cancelada', 'arquivada')), 0) AS total_valor
    FROM filtradas
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.data_venda DESC, p.id) FROM pagina p), '[]'::jsonb),
    'total_count', totais.total_count,
    'total_valor', totais.total_valor
  )
  FROM totais;
$function$;
alter function public.list_vendas_comerciais_paginadas_fila(integer,integer,text,text[],date,date,text,uuid[],text) owner to postgres;
revoke all on function public.list_vendas_comerciais_paginadas_fila(integer,integer,text,text[],date,date,text,uuid[],text) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.list_vendas_comerciais_paginadas_fila(integer,integer,text,text[],date,date,text,uuid[],text) to postgres;
grant execute on function public.list_vendas_comerciais_paginadas_fila(integer,integer,text,text[],date,date,text,uuid[],text) to authenticated;
grant execute on function public.list_vendas_comerciais_paginadas_fila(integer,integer,text,text[],date,date,text,uuid[],text) to service_role;
grant execute on function public.list_vendas_comerciais_paginadas_fila(integer,integer,text,text[],date,date,text,uuid[],text) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.metricas_venda_sem_parceria()
 RETURNS TABLE(sale_id uuid, vgv numeric, comissao_bruta numeric, parceria_externa numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select s.id, coalesce(s.valor_negociado, 0), coalesce(s.valor_total_comissao, 0),
    coalesce((select sum(op.valor) from occurrences o join occurrence_partners op on op.occurrence_id = o.id where o.sale_id = s.id), 0)
    + coalesce((select sum(oc.valor) from occurrences o join occurrence_commissions oc on oc.occurrence_id = o.id where o.sale_id = s.id and oc.sem_cadastro_confirmado), 0)
  from sales s
  where s.status::text not in ('cancelada','arquivada');
$function$;
alter function public.metricas_venda_sem_parceria() owner to postgres;
revoke all on function public.metricas_venda_sem_parceria() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.metricas_venda_sem_parceria() to postgres;
grant execute on function public.metricas_venda_sem_parceria() to authenticated;
grant execute on function public.metricas_venda_sem_parceria() to service_role;
grant execute on function public.metricas_venda_sem_parceria() to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.meu_realizado(_inicio date, _fim date)
 RETURNS TABLE(comissao numeric, vendas integer, vgv numeric, captacoes integer, como_captador integer, vgv_captador numeric, como_vendedor integer, vgv_vendedor numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio OR _fim - _inicio > 366 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH canon AS (
    SELECT v.sale_id, v.vgv_proprio, s.corretor_captador_id, s.corretor_vendedor_id
      FROM public.vendas_comerciais_canonicas() v
      JOIN public.sales s ON s.id = v.sale_id
     WHERE s.organization_id = _org AND v.data_fechamento BETWEEN _inicio AND _fim),
  minhas AS (
    SELECT p.sale_id, sum(p.valor_individual) AS valor
      FROM public.participacoes_comerciais_validas() p
      JOIN canon c ON c.sale_id = p.sale_id
     WHERE p.user_id = _me
     GROUP BY p.sale_id),
  caps AS (
    SELECT count(*)::integer AS n
      FROM public.exclusive_captures c
     WHERE c.captor_id = _me AND c.organization_id = _org AND c.status = 'aprovada' AND c.discarded_at IS NULL
       AND public.exclusive_aprovada_em(c.id) BETWEEN _inicio AND _fim)
  SELECT
    coalesce((SELECT sum(m.valor) FROM minhas m), 0)::numeric,
    (SELECT count(*) FROM minhas)::integer,
    coalesce((SELECT sum(c.vgv_proprio) FROM canon c JOIN minhas m ON m.sale_id = c.sale_id), 0)::numeric,
    CASE WHEN EXISTS (SELECT 1 FROM public.organization_modules om
                       WHERE om.organization_id = _org AND om.module = 'captacao_exclusiva' AND om.enabled)
         THEN (SELECT n FROM caps) END,
    (SELECT count(*) FROM canon c WHERE c.corretor_captador_id = _me)::integer,
    coalesce((SELECT sum(c.vgv_proprio) FROM canon c WHERE c.corretor_captador_id = _me), 0)::numeric,
    (SELECT count(*) FROM canon c WHERE c.corretor_vendedor_id = _me)::integer,
    coalesce((SELECT sum(c.vgv_proprio) FROM canon c WHERE c.corretor_vendedor_id = _me), 0)::numeric;
END $function$;
alter function public.meu_realizado(date,date) owner to postgres;
revoke all on function public.meu_realizado(date,date) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.meu_realizado(date,date) to postgres;
grant execute on function public.meu_realizado(date,date) to authenticated;
grant execute on function public.meu_realizado(date,date) to service_role;
CREATE OR REPLACE FUNCTION public.mt_1b_gate(_target_org uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c uuid;
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR (current_setting('role', true) = 'none' AND session_user IN ('supabase_admin', 'postgres')) THEN
    RETURN true;
  END IF;
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  _c := public.mt_ctx_org(true);
  RETURN _c IS NOT NULL AND (_target_org IS NULL OR _target_org = _c);
END $function$;
alter function public.mt_1b_gate(uuid) owner to postgres;
revoke all on function public.mt_1b_gate(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.mt_1b_gate(uuid) to postgres;
grant execute on function public.mt_1b_gate(uuid) to authenticated;
grant execute on function public.mt_1b_gate(uuid) to service_role;
grant execute on function public.mt_1b_gate(uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.mt_ctx_org(_current boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _key text := statement_timestamp()::text || '|' || md5(coalesce(current_setting('request.jwt.claims', true), '-'));
  _val text := current_setting('mt.ctx', true);
  _uid uuid; _u uuid; _c uuid; _override uuid;
BEGIN
  IF _val IS NOT NULL AND split_part(_val, '#', 1) = _key THEN
    RETURN nullif(split_part(_val, '#', CASE WHEN _current THEN 3 ELSE 2 END), '')::uuid;
  END IF;
  _uid := auth.uid();
  IF _uid IS NOT NULL THEN
    _override := public.mt_pc_context_org();
    IF _override IS NOT NULL THEN
      _u := _override; _c := _override;
    ELSE
      SELECT m.organization_id INTO _u FROM public.organization_members m
        JOIN public.organizations o ON o.id = m.organization_id
       WHERE m.user_id = _uid AND m.ativo AND o.status = 'ativa';
      IF _u IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND ativo IS TRUE) THEN
        _c := _u;
      END IF;
    END IF;
  END IF;
  PERFORM set_config('mt.ctx', _key || '#' || coalesce(_u::text, '') || '#' || coalesce(_c::text, ''), false);
  PERFORM set_config('mt.ctx_pc', CASE WHEN _override IS NOT NULL THEN '1' ELSE '0' END, false);
  PERFORM set_config('mt.ctx_m', _key || '#', false);
  RETURN CASE WHEN _current THEN _c ELSE _u END;
END $function$;
alter function public.mt_ctx_org(boolean) owner to postgres;
revoke all on function public.mt_ctx_org(boolean) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.mt_ctx_org(boolean) to postgres;
grant execute on function public.mt_ctx_org(boolean) to authenticated;
grant execute on function public.mt_ctx_org(boolean) to service_role;
CREATE OR REPLACE FUNCTION public.mt_in_ctx_org(_x uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _c uuid := public.mt_ctx_org(true); _val text; _hit boolean;
BEGIN
  IF _c IS NULL OR _x IS NULL THEN RETURN NULL; END IF;
  IF _x = auth.uid() THEN RETURN TRUE; END IF;
  _val := current_setting('mt.ctx_m', true);
  IF position(';' || _x::text || '=1' IN _val) > 0 THEN RETURN TRUE; END IF;
  IF position(';' || _x::text || '=0' IN _val) > 0 THEN RETURN NULL; END IF;
  _hit := EXISTS (SELECT 1 FROM public.organization_members m
    WHERE m.user_id = _x AND m.ativo AND m.organization_id = _c);
  PERFORM set_config('mt.ctx_m', _val || ';' || _x::text || CASE WHEN _hit THEN '=1' ELSE '=0' END, false);
  RETURN CASE WHEN _hit THEN TRUE END;
END $function$;
alter function public.mt_in_ctx_org(uuid) owner to postgres;
revoke all on function public.mt_in_ctx_org(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.mt_in_ctx_org(uuid) to postgres;
grant execute on function public.mt_in_ctx_org(uuid) to authenticated;
grant execute on function public.mt_in_ctx_org(uuid) to service_role;
CREATE OR REPLACE FUNCTION public.mt_pc_auth_session()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _sid text := auth.jwt() ->> 'session_id'; _id uuid;
BEGIN
  IF auth.uid() IS NULL OR _sid IS NULL OR _sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  _id := _sid::uuid;
  IF EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = _id AND s.user_id = auth.uid()
             AND (s.not_after IS NULL OR s.not_after > now())) THEN RETURN _id; END IF;
  RETURN NULL;
END $function$;
alter function public.mt_pc_auth_session() owner to postgres;
revoke all on function public.mt_pc_auth_session() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.mt_pc_auth_session() to postgres;
CREATE OR REPLACE FUNCTION public.mt_pc_context_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _id uuid;
BEGIN
  IF current_setting('role',true) <> 'authenticated' OR auth.uid() IS NULL THEN RETURN NULL; END IF;
  SELECT c.id INTO _id FROM public.platform_org_context_sessions c
    JOIN public.platform_admins p ON p.user_id = c.actor_user_id
    JOIN public.organizations o ON o.id = c.organization_id AND o.status = 'ativa'
    JOIN public.profiles a ON a.id = c.actor_user_id AND a.ativo IS TRUE
   WHERE c.actor_user_id = auth.uid() AND c.auth_session_id = public.mt_pc_auth_session()
     AND c.ended_at IS NULL AND c.expires_at > now();
  RETURN _id;
END $function$;
alter function public.mt_pc_context_id() owner to postgres;
revoke all on function public.mt_pc_context_id() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.mt_pc_context_id() to postgres;
CREATE OR REPLACE FUNCTION public.mt_pc_context_org()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.organization_id FROM public.platform_org_context_sessions c
  WHERE c.id = public.mt_pc_context_id()
$function$;
alter function public.mt_pc_context_org() owner to postgres;
revoke all on function public.mt_pc_context_org() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.mt_pc_context_org() to postgres;
CREATE OR REPLACE FUNCTION public.participacoes_comerciais_validas()
 RETURNS TABLE(sale_id uuid, venda_em timestamp with time zone, user_id uuid, valor_individual numeric, valor_equipe numeric, conta_equipe boolean, team_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with por_pessoa as (
    select v.sale_id, v.venda_em, oc.user_id,
      sum(oc.valor) as valor_individual,
      coalesce(sum(oc.valor) filter (where oc.papel <> 'coordenador_lancamento'), 0) as valor_equipe,
      bool_or(oc.papel <> 'coordenador_lancamento') as conta_equipe
    from public.vendas_comerciais_canonicas() v
    join occurrences o on o.sale_id = v.sale_id
    join occurrence_commissions oc on oc.occurrence_id = o.id
    where oc.user_id is not null and coalesce(oc.sem_cadastro_confirmado, false) = false
    group by v.sale_id, v.venda_em, oc.user_id
  )
  select p.sale_id, p.venda_em, p.user_id, p.valor_individual, p.valor_equipe, p.conta_equipe,
    case when p.conta_equipe then public.equipe_vigente(p.user_id, p.venda_em) end as team_id
  from por_pessoa p;
$function$;
alter function public.participacoes_comerciais_validas() owner to postgres;
revoke all on function public.participacoes_comerciais_validas() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.participacoes_comerciais_validas() to postgres;
grant execute on function public.participacoes_comerciais_validas() to authenticated;
grant execute on function public.participacoes_comerciais_validas() to service_role;
grant execute on function public.participacoes_comerciais_validas() to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.relatorio_regiao_permitido()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(
    auth.uid() IS NOT NULL
    AND public.current_org_id() IS NOT NULL
    AND public.mt_1b_gate()
    AND public.is_active_user(auth.uid())
    AND public.has_any_role(auth.uid(), ARRAY['corretor','team_leader','gestor','financeiro','juridico',
      'lancamento','staff','admin','super_admin']::public.app_role[]),
    false)
$function$;
alter function public.relatorio_regiao_permitido() owner to mt_1b_definer;
revoke all on function public.relatorio_regiao_permitido() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.relatorio_regiao_permitido() to mt_1b_definer;
grant execute on function public.relatorio_regiao_permitido() to authenticated;
grant execute on function public.relatorio_regiao_permitido() to service_role;
CREATE OR REPLACE FUNCTION public.resumo_desempenho_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select
      s.id,
      greatest(coalesce(s.valor_negociado, 0), 0) as vgv,
      greatest(coalesce((d.valor->>'comissao_bruta')::numeric, 0), 0) as comissao_bruta,
      greatest(coalesce((d.valor->>'parceria_externa')::numeric, 0), 0) as parceria_externa,
      greatest(coalesce(
        (d.valor->>'saldo_inicial_imobiliaria')::numeric,
        case when d.valor ? 'saldo_imobiliaria' then
          (d.valor->>'saldo_imobiliaria')::numeric
          + coalesce((select sum(e.valor) from public.sale_commission_extras e
                      where e.sale_id = s.id and e.papel::text <> 'corretor_vendedor'), 0)
        end,
        0), 0) as parte_unidade,
      greatest(coalesce((d.valor->>'saldo_liquido_imobiliaria')::numeric, (d.valor->>'saldo_imobiliaria')::numeric, 0), 0) as receita_liquida
    from public.vendas_comerciais_canonicas() v
    join sales s on s.id = v.sale_id
    cross join lateral (select public.calcular_distribuicao_venda(s.id) as valor) d
    where v.venda_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), propria as (
    select *,
      greatest(comissao_bruta - parceria_externa, 0) as comissao_propria,
      case when comissao_bruta > 0 then
        vgv * least(greatest(comissao_bruta - parceria_externa, 0) / comissao_bruta, 1)
      else 0 end as vgv_proprio
    from base
  )
  select jsonb_build_object(
    'vgv_proprio', coalesce(sum(vgv_proprio), 0),
    'comissao_propria', coalesce(sum(comissao_propria), 0),
    'parte_unidade', coalesce(sum(parte_unidade), 0),
    'receita_liquida_imobiliaria', coalesce(sum(receita_liquida), 0),
    'quantidade_vendas', count(*)
  )
  from propria
  where _de <= _ate
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$;
alter function public.resumo_desempenho_periodo(date,date) owner to postgres;
revoke all on function public.resumo_desempenho_periodo(date,date) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.resumo_desempenho_periodo(date,date) to postgres;
grant execute on function public.resumo_desempenho_periodo(date,date) to authenticated;
grant execute on function public.resumo_desempenho_periodo(date,date) to service_role;
grant execute on function public.resumo_desempenho_periodo(date,date) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.sale_corretores(_sale_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT s.corretor_captador_id AS uid FROM public.sales s WHERE s.id = _sale_id
    UNION
    SELECT s.corretor_vendedor_id FROM public.sales s WHERE s.id = _sale_id
    UNION
    SELECT e.user_id FROM public.sale_commission_extras e
    WHERE e.sale_id = _sale_id AND e.papel IN ('corretor_captador', 'corretor_vendedor')
  )
  SELECT uid FROM p WHERE uid IS NOT NULL
  UNION
  SELECT s.corretor_id FROM public.sales s
  WHERE s.id = _sale_id AND NOT EXISTS (SELECT 1 FROM p WHERE p.uid IS NOT NULL)
$function$;
alter function public.sale_corretores(uuid) owner to mt_1b_definer;
revoke all on function public.sale_corretores(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.sale_corretores(uuid) to mt_1b_definer;
grant execute on function public.sale_corretores(uuid) to service_role;
CREATE OR REPLACE FUNCTION public.sale_corretores_ids(_sale_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public.can_view_sale(auth.uid(), _sale_id)
    THEN coalesce((SELECT array_agg(c ORDER BY c) FROM public.sale_corretores(_sale_id) c), ARRAY[]::uuid[])
    ELSE ARRAY[]::uuid[] END
$function$;
alter function public.sale_corretores_ids(uuid) owner to mt_1b_definer;
revoke all on function public.sale_corretores_ids(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.sale_corretores_ids(uuid) to mt_1b_definer;
grant execute on function public.sale_corretores_ids(uuid) to authenticated;
grant execute on function public.sale_corretores_ids(uuid) to service_role;
CREATE OR REPLACE FUNCTION public.sale_responsaveis(_sale_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.corretor_id FROM public.sales s
  WHERE s.id = _sale_id AND s.modalidade::text = 'lancamento'
  UNION
  SELECT c FROM public.sales s, public.sale_corretores(s.id) c
  WHERE s.id = _sale_id AND s.modalidade::text IS DISTINCT FROM 'lancamento'
$function$;
alter function public.sale_responsaveis(uuid) owner to mt_1b_definer;
revoke all on function public.sale_responsaveis(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.sale_responsaveis(uuid) to mt_1b_definer;
grant execute on function public.sale_responsaveis(uuid) to service_role;
CREATE OR REPLACE FUNCTION public.sees_own_team_leader(_profile_id uuid, _user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    LEFT JOIN public.teams pt ON pt.id = t.parent_team_id
    WHERE tm.membro_id = _user AND (
      t.lider_id = _profile_id
      OR pt.lider_id = _profile_id
      OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = t.id AND cl.user_id = _profile_id)
      OR (pt.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.team_id = pt.id AND cl.user_id = _profile_id))
    )
  )

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_user) AND public.mt_in_ctx_org(_profile_id))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$;
alter function public.sees_own_team_leader(uuid,uuid) owner to postgres;
revoke all on function public.sees_own_team_leader(uuid,uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.sees_own_team_leader(uuid,uuid) to postgres;
grant execute on function public.sees_own_team_leader(uuid,uuid) to service_role;
grant execute on function public.sees_own_team_leader(uuid,uuid) to anon;
grant execute on function public.sees_own_team_leader(uuid,uuid) to authenticated;
grant execute on function public.sees_own_team_leader(uuid,uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.sees_team(_team_id uuid, _user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (SELECT COALESCE((
  SELECT public.leads_team_or_parent(_team_id, _user)
    OR EXISTS (SELECT 1 FROM public.teams ct WHERE ct.parent_team_id = _team_id AND ct.lider_id = _user)
    OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = _team_id AND tm.membro_id = _user)

  ),false) AND public.mt_1b_gate() AND ((public.mt_in_ctx_org(_user) AND EXISTS (SELECT 1 FROM public.teams WHERE id=_team_id AND organization_id=public.current_org_id()))
    OR current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres'))));
END
$function$;
alter function public.sees_team(uuid,uuid) owner to postgres;
revoke all on function public.sees_team(uuid,uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.sees_team(uuid,uuid) to postgres;
grant execute on function public.sees_team(uuid,uuid) to service_role;
grant execute on function public.sees_team(uuid,uuid) to anon;
grant execute on function public.sees_team(uuid,uuid) to authenticated;
grant execute on function public.sees_team(uuid,uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.user_org(_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _org uuid;
BEGIN
  IF _user IS NULL THEN RETURN NULL; END IF;
  IF _user = auth.uid() THEN RETURN public.mt_ctx_org(false); END IF;
  SELECT m.organization_id INTO _org FROM public.organization_members m
    JOIN public.organizations o ON o.id=m.organization_id
   WHERE m.user_id=_user AND m.ativo AND o.status='ativa';
  IF _org IS NULL THEN RETURN NULL; END IF;
  IF _org = public.mt_ctx_org(false)
     OR current_setting('role',true)='service_role'
     OR (current_setting('role',true)='none' AND session_user IN ('supabase_admin','postgres')) THEN
    RETURN _org;
  END IF;
  RETURN NULL;
END $function$;
alter function public.user_org(uuid) owner to postgres;
revoke all on function public.user_org(uuid) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.user_org(uuid) to postgres;
grant execute on function public.user_org(uuid) to authenticated;
grant execute on function public.user_org(uuid) to service_role;
grant execute on function public.user_org(uuid) to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.vendas_coleader_edicao_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with g as (select 1 where exists (select 1 from public.team_co_leaders cl where cl.user_id = (select auth.uid())))
  select s.id from g, public.sales s where s.organization_id = public.current_org_id()
    and public.can_edit_sale_as_co_leader(s.id) $function$;
alter function public.vendas_coleader_edicao_ids() owner to postgres;
revoke all on function public.vendas_coleader_edicao_ids() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.vendas_coleader_edicao_ids() to postgres;
grant execute on function public.vendas_coleader_edicao_ids() to authenticated;
grant execute on function public.vendas_coleader_edicao_ids() to service_role;
CREATE OR REPLACE FUNCTION public.vendas_coleader_gestao_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with g as (select 1 where exists (select 1 from public.team_co_leaders cl where cl.user_id = (select auth.uid())))
  select s.id from g, public.sales s where s.organization_id = public.current_org_id()
    and public.can_manage_sale_as_co_leader(s.id) $function$;
alter function public.vendas_coleader_gestao_ids() owner to postgres;
revoke all on function public.vendas_coleader_gestao_ids() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.vendas_coleader_gestao_ids() to postgres;
grant execute on function public.vendas_coleader_gestao_ids() to authenticated;
grant execute on function public.vendas_coleader_gestao_ids() to service_role;
CREATE OR REPLACE FUNCTION public.vendas_coleader_leitura_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with g as (select 1 where exists (select 1 from public.team_co_leaders cl where cl.user_id = (select auth.uid())))
  select s.id from g, public.sales s where s.organization_id = public.current_org_id()
    and public.can_read_principal_sale_as_co_leader(s.id) $function$;
alter function public.vendas_coleader_leitura_ids() owner to postgres;
revoke all on function public.vendas_coleader_leitura_ids() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.vendas_coleader_leitura_ids() to postgres;
grant execute on function public.vendas_coleader_leitura_ids() to authenticated;
grant execute on function public.vendas_coleader_leitura_ids() to service_role;
CREATE OR REPLACE FUNCTION public.vendas_comerciais_canonicas()
 RETURNS TABLE(sale_id uuid, venda_em timestamp with time zone, data_fechamento date, modalidade text, status text, codigo_interno text, imovel_id text, corretor_id uuid, percentual_comissao numeric, valor_negociado numeric, valor_total_comissao numeric, comissao_bruta numeric, parceria_externa numeric, vgv_proprio numeric, comissao_propria numeric, occurrence_count bigint, occurrence_concluida_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH metricas AS (
    SELECT * FROM public.metricas_venda_sem_parceria()
  )
  SELECT
    v.sale_id,
    v.venda_em,
    (v.venda_em at time zone 'America/Sao_Paulo')::date AS data_fechamento,
    s.modalidade::text,
    s.status::text,
    s.codigo_interno,
    s.imovel_id,
    s.corretor_id,
    s.percentual_comissao,
    m.vgv AS valor_negociado,
    m.comissao_bruta AS valor_total_comissao,
    m.comissao_bruta,
    m.parceria_externa,
    CASE
      WHEN m.comissao_bruta > 0 THEN
        m.vgv * least(greatest(m.comissao_bruta - m.parceria_externa, 0) / m.comissao_bruta, 1)
      ELSE 0
    END AS vgv_proprio,
    greatest(m.comissao_bruta - m.parceria_externa, 0) AS comissao_propria,
    coalesce(o.occurrence_count, 0),
    coalesce(o.occurrence_concluida_count, 0)
  FROM public.vendas_comerciais_validas() v
  JOIN public.sales s ON s.id = v.sale_id
  JOIN metricas m ON m.sale_id = v.sale_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS occurrence_count,
      count(*) FILTER (WHERE oc.status = 'concluida') AS occurrence_concluida_count
    FROM public.occurrences oc
    WHERE oc.sale_id = s.id
  ) o ON true
  WHERE s.status::text NOT IN ('cancelada', 'arquivada')
    AND s.valor_negociado > 0
    AND s.valor_total_comissao > 0;
$function$;
alter function public.vendas_comerciais_canonicas() owner to postgres;
revoke all on function public.vendas_comerciais_canonicas() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.vendas_comerciais_canonicas() to postgres;
grant execute on function public.vendas_comerciais_canonicas() to authenticated;
grant execute on function public.vendas_comerciais_canonicas() to service_role;
grant execute on function public.vendas_comerciais_canonicas() to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.vendas_comerciais_validas()
 RETURNS TABLE(sale_id uuid, venda_em timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Mês comercial = mês da ASSINATURA (decisão de Denis, 27/09/2026):
  --   venda padrão: ÚLTIMO evento contrato_assinado (reassinatura vale a última);
  --   Lançamento: sales.data_assinatura (meia-noite de São Paulo); sem ela, entrada no Financeiro.
  -- A elegibilidade (status + evento obrigatório) não muda.
  select
    s.id as sale_id,
    case
      when s.modalidade::text = 'lancamento' then
        coalesce(
          (s.data_assinatura::timestamp at time zone 'America/Sao_Paulo'),
          max(h.created_at) filter (where h.para::text = 'ocorrencia_analise_financeiro')
        )
      else
        max(h.created_at) filter (where h.para::text = 'contrato_assinado')
    end as venda_em
  from sales s
  join sale_status_history h on h.sale_id = s.id
  where s.status::text in (
    'contrato_assinado',
    'ocorrencia_pendente',
    'ocorrencia_analise_financeiro',
    'ocorrencia_devolvida_gestor',
    'ocorrencia_concluida'
  )
  group by s.id, s.modalidade, s.data_assinatura
  having case
    when s.modalidade::text = 'lancamento' then
      max(h.created_at) filter (where h.para::text = 'ocorrencia_analise_financeiro') is not null
    else
      max(h.created_at) filter (where h.para::text = 'contrato_assinado') is not null
  end;
$function$;
alter function public.vendas_comerciais_validas() owner to postgres;
revoke all on function public.vendas_comerciais_validas() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.vendas_comerciais_validas() to postgres;
grant execute on function public.vendas_comerciais_validas() to authenticated;
grant execute on function public.vendas_comerciais_validas() to service_role;
grant execute on function public.vendas_comerciais_validas() to mt_1b_definer;
CREATE OR REPLACE FUNCTION public.vendas_juridico_certidao_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with g as (select 1 where exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'juridico'))
  select s.id from g, public.sales s where s.organization_id = public.current_org_id()
    and public.can_read_sale_juridico_certidao(s.id) $function$;
alter function public.vendas_juridico_certidao_ids() owner to postgres;
revoke all on function public.vendas_juridico_certidao_ids() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.vendas_juridico_certidao_ids() to postgres;
grant execute on function public.vendas_juridico_certidao_ids() to authenticated;
grant execute on function public.vendas_juridico_certidao_ids() to service_role;
CREATE OR REPLACE FUNCTION public.vendas_por_regiao()
 RETURNS TABLE(sale_id uuid, data_fechamento date, modalidade text, status text, codigo_interno text, imovel_id text, corretor_id uuid, valor_negociado numeric, imovel_endereco text, imovel_bairro text, imovel_cidade text, imovel_uf text, imovel_cep text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select c.sale_id, c.data_fechamento, c.modalidade, c.status, c.codigo_interno, c.imovel_id,
         c.corretor_id, c.valor_negociado, s.imovel_endereco, s.imovel_bairro, s.imovel_cidade,
         s.imovel_uf, s.imovel_cep
  from public.vendas_comerciais_canonicas() c
  join public.sales s on s.id = c.sale_id;
$function$;
alter function public.vendas_por_regiao() owner to postgres;
revoke all on function public.vendas_por_regiao() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.vendas_por_regiao() to postgres;
grant execute on function public.vendas_por_regiao() to authenticated;
grant execute on function public.vendas_por_regiao() to service_role;
CREATE OR REPLACE FUNCTION public.vendas_por_regiao_todos(_de date DEFAULT NULL::date, _ate date DEFAULT NULL::date)
 RETURNS TABLE(tipo text, sale_id uuid, data_fechamento date, modalidade text, codigo text, qtd integer, valor numeric, imovel_endereco text, imovel_bairro text, imovel_cidade text, imovel_uf text, geo_key text, geo_lat double precision, geo_lon double precision, tipo_imovel text, area_util_m2 numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF NOT public.relatorio_regiao_permitido() THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH v AS (
    SELECT c.sale_id, c.data_fechamento, c.modalidade, coalesce(c.valor_negociado, 0) AS valor,
           coalesce(nullif(c.codigo_interno, ''), c.imovel_id) AS codigo,
           s.imovel_endereco, s.imovel_bairro, s.imovel_cidade, s.imovel_uf,
           g.geo_key, g.geo_lat, g.geo_lon,
           s.tipo_imovel,
           -- Terreno: área do terreno (como no estudo). Demais: área útil.
           CASE WHEN s.tipo_imovel = 'Terreno' THEN s.area_terreno_m2 ELSE s.area_util_m2 END AS area,
           coalesce(public.can_view_sale(auth.uid(), c.sale_id), false) AS det
    FROM public.vendas_comerciais_canonicas() c
    JOIN public.sales s ON s.id = c.sale_id AND s.organization_id = _org
    LEFT JOIN public.sale_geo g ON g.sale_id = s.id AND g.organization_id = _org
    WHERE (_de IS NULL OR c.data_fechamento >= _de)
      AND (_ate IS NULL OR c.data_fechamento <= _ate)
  )
  SELECT 'venda'::text, v.sale_id, v.data_fechamento, v.modalidade, v.codigo, 1, v.valor,
         v.imovel_endereco, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, v.geo_key, v.geo_lat, v.geo_lon,
         v.tipo_imovel, v.area
    FROM v WHERE v.det
  UNION ALL
  SELECT 'grupo'::text, NULL::uuid, NULL::date, NULL::text, NULL::text, count(*)::integer, sum(v.valor),
         NULL::text, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, NULL::text, NULL::double precision,
         NULL::double precision, NULL::text, NULL::numeric
    FROM v WHERE NOT v.det
    GROUP BY v.imovel_bairro, v.imovel_cidade, v.imovel_uf
  UNION ALL
  SELECT 'pino'::text, NULL::uuid, NULL::date, v.modalidade, NULL::text, 1, v.valor,
         NULL::text, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, NULL::text,
         round(v.geo_lat::numeric, 3)::double precision, round(v.geo_lon::numeric, 3)::double precision,
         v.tipo_imovel, v.area
    FROM v WHERE NOT v.det AND v.geo_lat IS NOT NULL AND v.geo_lon IS NOT NULL;
END $function$;
alter function public.vendas_por_regiao_todos(date,date) owner to mt_1b_definer;
revoke all on function public.vendas_por_regiao_todos(date,date) from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.vendas_por_regiao_todos(date,date) to mt_1b_definer;
grant execute on function public.vendas_por_regiao_todos(date,date) to authenticated;
grant execute on function public.vendas_por_regiao_todos(date,date) to service_role;
CREATE OR REPLACE FUNCTION public.vendas_visiveis_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with u as (
    select (select auth.uid()) uid, public.current_org_id() org
  ), ctx as (
    select u.uid, u.org,
      coalesce(public.is_active_user(u.uid), false) ativo,
      coalesce(public.has_any_role(u.uid, array['financeiro','admin','super_admin']::public.app_role[]), false) amplo,
      coalesce(public.has_any_role(u.uid, array['gestor','team_leader']::public.app_role[]), false) lider,
      coalesce(public.has_role(u.uid, 'juridico'::public.app_role), false) juridico
    from u
    where u.uid is not null and u.org is not null and public.mt_1b_gate()
  ), liderados as (   -- = is_lead_of(uid, membro): equipes que lidera, co-lidera ou cuja equipe-mãe lidera/co-lidera
    select distinct tm.membro_id
    from ctx
    join public.teams t on t.organization_id = ctx.org
    join public.team_members tm on tm.team_id = t.id
    left join public.teams pt on pt.id = t.parent_team_id
    where ctx.lider
      and (t.lider_id = ctx.uid or pt.lider_id = ctx.uid
        or exists (select 1 from public.team_co_leaders cl where cl.team_id = t.id and cl.user_id = ctx.uid)
        or (pt.id is not null and exists (select 1 from public.team_co_leaders cl where cl.team_id = pt.id and cl.user_id = ctx.uid)))
      and exists (select 1 from public.organization_members m where m.user_id = tm.membro_id and m.ativo and m.organization_id = ctx.org)
  )
  select s.id
  from ctx
  join public.sales s on s.organization_id = ctx.org
  where ctx.ativo and (
       ctx.amplo
    or ctx.uid in (s.corretor_id, s.corretor_captador_id, s.corretor_vendedor_id, s.lider_captador_id, s.lider_vendedor_id)
    or exists (select 1 from public.sale_commission_extras e where e.sale_id = s.id and e.user_id = ctx.uid)
    or (ctx.lider and (
          s.corretor_id in (select membro_id from liderados)
       or exists (  -- = is_lead_of_sale_corretor (sale_corretores)
            select 1 from (
              select x.uid from (
                select s.corretor_captador_id uid union select s.corretor_vendedor_id
                union select e.user_id from public.sale_commission_extras e
                 where e.sale_id = s.id and e.papel in ('corretor_captador','corretor_vendedor')) x
              where x.uid is not null
              union
              select s.corretor_id where s.corretor_captador_id is null and s.corretor_vendedor_id is null
                and not exists (select 1 from public.sale_commission_extras e
                  where e.sale_id = s.id and e.papel in ('corretor_captador','corretor_vendedor') and e.user_id is not null)
            ) c where c.uid in (select membro_id from liderados))))
    or (ctx.juridico and s.status::text = any (array['aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor','aguardando_assinatura',
        'contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida']))
  )
$function$;
alter function public.vendas_visiveis_ids() owner to postgres;
revoke all on function public.vendas_visiveis_ids() from public, anon, authenticated, service_role, mt_1b_definer;
grant execute on function public.vendas_visiveis_ids() to postgres;
grant execute on function public.vendas_visiveis_ids() to authenticated;
grant execute on function public.vendas_visiveis_ids() to service_role;
do $p$ declare r record; begin for r in select tablename, policyname from pg_policies where schemaname='public' and tablename = any(array['occurrence_commissions','occurrence_partners','occurrences','sale_commission_extras','sale_parties','sale_status_history','sales','venda_distribuicao']) and cmd in ('SELECT','ALL') loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop; end $p$;
create policy "co_leader_commissions_write" on public.occurrence_commissions as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND (o.sale_id IN ( SELECT vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids)))))) with check ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_edit_sale_as_co_leader(o.sale_id)))));
create policy "mt_1b_definer_access" on public.occurrence_commissions as permissive for all to mt_1b_definer using (true) with check (true);
create policy "occ_comm_view" on public.occurrence_commissions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND (o.sale_id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids))))));
create policy "occ_comm_write" on public.occurrence_commissions as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND (o.sale_id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids)) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role))))) with check ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_view_sale(( SELECT auth.uid() AS uid), o.sale_id) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role) AND ((NOT is_sale_locked(o.sale_id)) OR ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role))))));
create policy "occurrence_commissions_co_leader_principal_read" on public.occurrence_commissions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND (o.sale_id IN ( SELECT vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids))))));
create policy "org_isolation" on public.occurrence_commissions as restrictive for all to authenticated using ((organization_id = ( SELECT current_org_id() AS current_org_id))) with check ((organization_id = ( SELECT current_org_id() AS current_org_id)));
create policy "zz_mt_leitor_amplo_select" on public.occurrence_commissions as permissive for select to authenticated using (( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role));
create policy "co_leader_partners_write" on public.occurrence_partners as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND (o.sale_id IN ( SELECT vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids)))))) with check ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_edit_sale_as_co_leader(o.sale_id)))));
create policy "mt_1b_definer_access" on public.occurrence_partners as permissive for all to mt_1b_definer using (true) with check (true);
create policy "occ_part_view" on public.occurrence_partners as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND (o.sale_id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids))))));
create policy "occ_part_write" on public.occurrence_partners as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND (o.sale_id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids)) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role))))) with check ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_view_sale(( SELECT auth.uid() AS uid), o.sale_id) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role) AND ((NOT is_sale_locked(o.sale_id)) OR ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role))))));
create policy "occurrence_partners_co_leader_principal_read" on public.occurrence_partners as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND (o.sale_id IN ( SELECT vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids))))));
create policy "org_isolation" on public.occurrence_partners as restrictive for all to authenticated using ((organization_id = ( SELECT current_org_id() AS current_org_id))) with check ((organization_id = ( SELECT current_org_id() AS current_org_id)));
create policy "zz_mt_leitor_amplo_select" on public.occurrence_partners as permissive for select to authenticated using (( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role));
create policy "co_leader_occurrence_write" on public.occurrences as permissive for all to authenticated using ((sale_id IN ( SELECT vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids))) with check ((can_edit_sale_as_co_leader(sale_id) AND (NOT aceita_financeiro)));
create policy "mt_1b_definer_access" on public.occurrences as permissive for all to mt_1b_definer using (true) with check (true);
create policy "occ_view" on public.occurrences as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids)));
create policy "occ_write" on public.occurrences as permissive for all to authenticated using ((( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role) AND (sale_id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids)))) with check ((( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role) AND can_view_sale(( SELECT auth.uid() AS uid), sale_id) AND ((NOT is_sale_locked(sale_id)) OR ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role))));
create policy "occurrences_co_leader_principal_read" on public.occurrences as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids)));
create policy "org_isolation" on public.occurrences as restrictive for all to authenticated using ((organization_id = ( SELECT current_org_id() AS current_org_id))) with check ((organization_id = ( SELECT current_org_id() AS current_org_id)));
create policy "zz_mt_leitor_amplo_select" on public.occurrences as permissive for select to authenticated using (( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role));
create policy "co_leader_extras_write" on public.sale_commission_extras as permissive for all to authenticated using ((sale_id IN ( SELECT vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids))) with check (can_edit_sale_as_co_leader(sale_id));
create policy "juridico_returned_extras_read" on public.sale_commission_extras as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids)));
create policy "mt_1b_definer_access" on public.sale_commission_extras as permissive for all to mt_1b_definer using (true) with check (true);
create policy "org_isolation" on public.sale_commission_extras as restrictive for all to authenticated using ((organization_id = ( SELECT current_org_id() AS current_org_id))) with check ((organization_id = ( SELECT current_org_id() AS current_org_id)));
create policy "sale_commission_extras_co_leader_principal_read" on public.sale_commission_extras as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids)));
create policy "sale_commission_extras_select" on public.sale_commission_extras as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids)));
create policy "zz_mt_leitor_amplo_select" on public.sale_commission_extras as permissive for select to authenticated using (( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role));
create policy "co_leader_parties_write" on public.sale_parties as permissive for all to authenticated using ((sale_id IN ( SELECT vendas_coleader_edicao_ids() AS vendas_coleader_edicao_ids))) with check (can_edit_sale_as_co_leader(sale_id));
create policy "juridico_returned_parties_read" on public.sale_parties as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids)));
create policy "mt_1b_definer_access" on public.sale_parties as permissive for all to mt_1b_definer using (true) with check (true);
create policy "org_isolation" on public.sale_parties as restrictive for all to authenticated using ((organization_id = ( SELECT current_org_id() AS current_org_id))) with check ((organization_id = ( SELECT current_org_id() AS current_org_id)));
create policy "sale_parties_co_leader_principal_read" on public.sale_parties as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids)));
create policy "sale_parties_select" on public.sale_parties as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids)));
create policy "zz_mt_leitor_amplo_select" on public.sale_parties as permissive for select to authenticated using (( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role));
create policy "co_leader_history_read" on public.sale_status_history as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_coleader_gestao_ids() AS vendas_coleader_gestao_ids)));
create policy "history_view" on public.sale_status_history as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids)));
create policy "juridico_returned_history_read" on public.sale_status_history as permissive for select to authenticated using ((sale_id IN ( SELECT vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids)));
create policy "mt_1b_definer_access" on public.sale_status_history as permissive for all to mt_1b_definer using (true) with check (true);
create policy "org_isolation" on public.sale_status_history as restrictive for all to authenticated using ((organization_id = ( SELECT current_org_id() AS current_org_id))) with check ((organization_id = ( SELECT current_org_id() AS current_org_id)));
create policy "zz_mt_leitor_amplo_select" on public.sale_status_history as permissive for select to authenticated using (( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role));
create policy "juridico_returned_sale_read" on public.sales as permissive for select to authenticated using ((id IN ( SELECT vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids)));
create policy "mt_1b_definer_access" on public.sales as permissive for all to mt_1b_definer using (true) with check (true);
create policy "org_isolation" on public.sales as restrictive for all to authenticated using ((organization_id = ( SELECT current_org_id() AS current_org_id))) with check ((organization_id = ( SELECT current_org_id() AS current_org_id)));
create policy "sales_co_leader_principal_read" on public.sales as permissive for select to authenticated using ((id IN ( SELECT vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids)));
create policy "sales_select" on public.sales as permissive for select to authenticated using (((id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids)) OR ((((( SELECT auth.uid() AS uid) = corretor_id) OR (( SELECT auth.uid() AS uid) = corretor_captador_id)) OR (( SELECT auth.uid() AS uid) = corretor_vendedor_id)) AND ( SELECT is_active_user(( SELECT auth.uid() AS uid)) AS is_active_user))));
create policy "org_isolation" on public.venda_distribuicao as restrictive for all to authenticated using ((organization_id = ( SELECT current_org_id() AS current_org_id)));
create policy "vd_select" on public.venda_distribuicao as permissive for select to authenticated using (((sale_id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids)) OR (sale_id IN ( SELECT vendas_coleader_leitura_ids() AS vendas_coleader_leitura_ids)) OR (sale_id IN ( SELECT vendas_juridico_certidao_ids() AS vendas_juridico_certidao_ids))));
