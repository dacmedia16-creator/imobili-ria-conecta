-- Item 2 da correção de comissão por beneficiário: impedir que uma linha de comissão de papel
-- interno fique com user_id nulo SEM uma confirmação explícita de que a pessoa realmente não tem
-- cadastro no sistema.
--
-- Por que não é simplesmente "user_id obrigatório pra todo papel != outro": a auditoria encontrou
-- 4 linhas hoje com user_id nulo em papel interno — 2 delas ("Wilson Grecchi", corretor_vendedor)
-- são, aparentemente, um corretor parceiro que nunca teve conta no sistema (não existe nenhum
-- profiles.nome parecido) — um caso LEGÍTIMO, não um bug. As outras 2 ("Aline Rodrigues",
-- coordenador_lancamento) são o bug real: o nome foi digitado sem escolher da lista, e a pessoa
-- tem cadastro (Aline de Souza Rodrigues). Uma trava simples de "sempre exigir user_id" quebraria
-- o caso legítimo do Wilson.
--
-- Por isso a trava não é "user_id obrigatório", é "user_id OU confirmação explícita obrigatório":
-- uma coluna nova sem_cadastro_confirmado, marcada true só quando alguém escolhe deliberadamente
-- "Sem cadastro / parceiro externo" no seletor (não é mais possível digitar um nome livre sem
-- passar por uma dessas duas escolhas).
--
-- NOT VALID em ambas as constraints: não valida as 4 linhas antigas (nem qualquer outra) no momento
-- da migration — só passa a exigir a partir de agora, em INSERT/UPDATE novos. As linhas antigas
-- continuam de pé exatamente como estão até serem corrigidas uma a uma (ver script separado da
-- Aline). Detalhe importante: como NOT VALID não isenta updates futuros da MESMA linha antiga, um
-- UPDATE em qualquer campo de uma das 4 linhas hoje (não só user_id) só vai passar se, junto,
-- sem_cadastro_confirmado ou user_id também forem preenchidos — efeito colateral desejado (força
-- a correção na próxima vez que alguém mexer na linha), mas documentado aqui pra não surpreender.
alter table public.sale_commission_extras
  add column if not exists sem_cadastro_confirmado boolean not null default false;

alter table public.occurrence_commissions
  add column if not exists sem_cadastro_confirmado boolean not null default false;

-- criar_ocorrencia_lancamento() copia sale_commission_extras -> occurrence_commissions; sem alterar
-- essa função a nova coluna simplesmente não seria copiada (ficaria sempre false na ocorrência,
-- mesmo quando a extra de origem já foi confirmada como sem cadastro). Ajuste mínimo: inclui a
-- coluna nos dois INSERTs (criação e reenvio), mesma lógica de antes.
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

  if v_sale.valor_total_comissao is null or v_sale.valor_total_comissao <= 0 then
    raise exception 'Informe o valor total da comissão antes de enviar ao financeiro.' using errcode = '23514';
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
      valor_comissao = v_sale.valor_total_comissao,
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

  return jsonb_build_object('occurrence_id', v_occ_id);
end;
$function$;

-- sync_occurrence_commissions() é o equivalente de criar_ocorrencia_lancamento() pro fluxo PADRÃO
-- (não-Lançamento): sincroniza sale_commission_extras -> occurrence_commissions pra vendas com
-- captador/vendedor/indicador/líder nos campos normais da venda. Mesmo motivo da correção acima —
-- sem propagar sem_cadastro_confirmado aqui, toda linha "extra" (papel != gestor/team_leader,
-- captador/vendedor/outro) de uma venda do fluxo padrão ficaria sempre com sem_cadastro_confirmado
-- = false na ocorrência, mesmo quando a extra de origem já foi confirmada como parceiro externo —
-- quebrando a distinção usada por dashboard_stats() pra separar parceria externa de faturamento
-- (ver migration 20260817010000) pra qualquer venda que não seja de Lançamento. As linhas dos
-- papéis "fixos" (corretor_captador/vendedor principal, indicador, líder — v_fixed) não precisam
-- disso: são sempre gente interna, nunca parceiro externo (calcular_distribuicao_venda já trava
-- isso como inconsistência se um desses ficar sem user_id).
create or replace function public.sync_occurrence_commissions(_sale_id uuid)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_occ_id uuid;
  v_total numeric;
  v_sale sales%rowtype;
  v_dist jsonb;
  v_pct numeric;
  v_fixed record;
  v_extra record;
begin
  select id, valor_comissao into v_occ_id, v_total from occurrences where sale_id = _sale_id;
  if v_occ_id is null then
    return;
  end if;

  select * into v_sale from sales where id = _sale_id;
  v_dist := calcular_distribuicao_venda(_sale_id);

  -- valor_bruto decide se a linha existe/some (mesma regra de sempre: nome+valor+user_id todos
  -- nulos = removido no Resumo) e entra no cálculo do percentual; valor_final é o que de fato é
  -- gravado. Só captador/vendedor diferem entre os dois (líquido vs bruto) — os demais papéis
  -- nunca tiveram nada descontado deles mesmos, então valor_final = valor_bruto igual antes.
  for v_fixed in
    select * from (values
      ('corretor_captador', v_sale.corretor_captador, v_sale.valor_comissao_captador, (v_dist->>'liquido_captador')::numeric, v_sale.corretor_captador_id),
      ('corretor_vendedor', v_sale.corretor_vendedor, v_sale.valor_comissao_vendedor, (v_dist->>'liquido_vendedor')::numeric, v_sale.corretor_vendedor_id),
      ('indicador_captador', v_sale.indicador_captador, v_sale.valor_comissao_indicador_captador, v_sale.valor_comissao_indicador_captador, null::uuid),
      ('indicador_vendedor', v_sale.indicador_vendedor, v_sale.valor_comissao_indicador_vendedor, v_sale.valor_comissao_indicador_vendedor, null::uuid),
      ('lider_captador', v_sale.lider_captador_nome, v_sale.valor_comissao_lider_captador, v_sale.valor_comissao_lider_captador, v_sale.lider_captador_id),
      ('lider_vendedor', v_sale.lider_vendedor_nome, v_sale.valor_comissao_lider_vendedor, v_sale.valor_comissao_lider_vendedor, v_sale.lider_vendedor_id)
    ) as t(papel, nome, valor_bruto, valor_final, user_id)
  loop
    if v_fixed.nome is null and v_fixed.valor_bruto is null and v_fixed.user_id is null then
      delete from occurrence_commissions
      where occurrence_id = v_occ_id and papel = v_fixed.papel and sale_commission_extra_id is null and managed_by_sale = true;
    else
      v_pct := case when v_fixed.valor_final is not null and v_total > 0 then round((v_fixed.valor_final / v_total) * 100, 3) else null end;
      update occurrence_commissions
      set nome = v_fixed.nome, valor = v_fixed.valor_final, percentual = v_pct, user_id = v_fixed.user_id
      where occurrence_id = v_occ_id and papel = v_fixed.papel and sale_commission_extra_id is null and managed_by_sale = true;
      if not found then
        -- Não achou linha GERENCIADA pra atualizar — ou é a primeira sincronização (cria normal), ou
        -- a única linha existente daquele papel é manual (managed_by_sale = false, protegida acima):
        -- nesse caso cria uma linha gerenciada nova ao lado dela, em vez de tocar na manual.
        insert into occurrence_commissions (occurrence_id, papel, nome, valor, percentual, user_id, managed_by_sale)
        values (v_occ_id, v_fixed.papel, v_fixed.nome, v_fixed.valor_final, v_pct, v_fixed.user_id, true);
      end if;
    end if;
  end loop;

  for v_extra in
    select
      m.id as extra_id, m.papel, m.nome, m.valor, m.sem_cadastro_confirmado,
      coalesce(m.user_id_raw,
        case m.papel when 'gestor' then v_sale.coordenador_id when 'team_leader' then v_sale.team_leader_id else null end
      ) as user_id
    from (
      select e.id, e.nome, e.valor, e.user_id as user_id_raw, e.sem_cadastro_confirmado,
        case when e.papel in ('gestor','team_leader','outro','corretor_captador','corretor_vendedor') then e.papel else 'outro' end as papel
      from sale_commission_extras e
      where e.sale_id = _sale_id
    ) m
  loop
    v_pct := case when v_extra.valor is not null and v_total > 0 then round((v_extra.valor / v_total) * 100, 3) else null end;
    -- Casamento por sale_commission_extra_id já é inequívoco (nunca colide com linha manual, que
    -- nunca tem esse id preenchido) — managed_by_sale aqui é só consistência de dado, não proteção.
    update occurrence_commissions
    set nome = v_extra.nome, valor = v_extra.valor, percentual = v_pct, papel = v_extra.papel, user_id = v_extra.user_id, managed_by_sale = true, sem_cadastro_confirmado = v_extra.sem_cadastro_confirmado
    where occurrence_id = v_occ_id and sale_commission_extra_id = v_extra.extra_id;
    if not found then
      insert into occurrence_commissions (occurrence_id, papel, nome, valor, percentual, sale_commission_extra_id, user_id, managed_by_sale, sem_cadastro_confirmado)
      values (v_occ_id, v_extra.papel, v_extra.nome, v_extra.valor, v_pct, v_extra.extra_id, v_extra.user_id, true, v_extra.sem_cadastro_confirmado);
    end if;
  end loop;

  delete from occurrence_commissions oc
  where oc.occurrence_id = v_occ_id
    and oc.sale_commission_extra_id is not null
    and not exists (select 1 from sale_commission_extras e where e.id = oc.sale_commission_extra_id);
end;
$function$;

-- NOT VALID: só passa a valer daqui pra frente, não mexe/rejeita nenhuma linha já existente.
alter table public.sale_commission_extras
  add constraint sale_commission_extras_exige_vinculo_ou_confirmacao
  check (papel = 'outro' or papel is null or user_id is not null or sem_cadastro_confirmado)
  not valid;

alter table public.occurrence_commissions
  add constraint occurrence_commissions_exige_vinculo_ou_confirmacao
  check (papel = 'outro' or user_id is not null or sem_cadastro_confirmado)
  not valid;
