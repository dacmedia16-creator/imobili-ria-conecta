-- RECONCILIAÇÃO DAS MIGRATIONS DUPLICADAS DE 2026-08-19
-- Bancos que já registraram os timestamps 20260819020000 ou 20260819080000 podem ter
-- executado apenas um dos dois arquivos que compartilhavam cada versão. Esta migration
-- futura reaplica somente as definições finais que não foram substituídas depois, usando
-- CREATE OR REPLACE para tornar a reconciliação idempotente.
--
-- dashboard_movimentacao_periodo() não é redefinida aqui: existe uma definição mais nova em
-- 20260901215000_alinha_regra_comercial_pontos_restantes.sql, que não pode ser sobrescrita
-- pela versão antiga de 20260819020000.

-- =============================================================================
-- Definição final preservada de 20260819020000_lancamento_restaura_reenvio_apos_devolucao.sql
-- =============================================================================

-- Corrige regressão em criar_ocorrencia_lancamento(): a migration 20260819000000 (que trocou o
-- cálculo de comissao_bruta pra usar calcular_distribuicao_venda(), suportando percentual) foi
-- gerada a partir de uma base mais antiga da função e sem querer descartou o suporte a reenvio
-- (branch v_is_resend) que já existia desde 20260817020000 — voltando a exigir status = 'rascunho'
-- incondicionalmente. Efeito em produção: nenhuma venda de Lançamento devolvida pelo financeiro
-- (status devolvida_ajuste) consegue ser reenviada — "Reenviar ao financeiro" sempre lança "Esta
-- venda já foi enviada ao financeiro." Reportado pelo usuário em 2026-08-18 (Aline, papel
-- Lançamento/Gestor, bloqueada numa venda devolvida).
--
-- Esta migration reintroduz o branch v_is_resend (idêntico em estrutura ao de 20260817020000: UPDATE
-- na ocorrência existente + resync de occurrence_commissions com sem_cadastro_confirmado/
-- managed_by_sale propagados), mantendo o cálculo de comissao_bruta via calcular_distribuicao_venda()
-- introduzido em 20260819000000 (não volta a exigir valor_total_comissao preenchido manualmente).
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
  v_dist jsonb;
  v_comissao_bruta numeric;
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

  -- calcular_distribuicao_venda(v_sale) cai no branch modalidade='lancamento' (checado acima) e
  -- devolve comissao_bruta com a mesma regra de precedência que a tela usa: percentual_comissao *
  -- valor_negociado quando ambos informados, senão valor_total_comissao gravado.
  v_dist := public.calcular_distribuicao_venda(v_sale);
  v_comissao_bruta := (v_dist->>'comissao_bruta')::numeric;

  if v_comissao_bruta is null or v_comissao_bruta <= 0 then
    raise exception 'Informe o percentual de comissão (junto com o valor negociado) ou o valor total da comissão antes de enviar ao financeiro.' using errcode = '23514';
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
      valor_comissao = v_comissao_bruta,
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
      v_sale.valor_anunciado, v_sale.valor_negociado, v_sale.percentual_comissao, v_comissao_bruta, v_sale.premio_valor,
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

  return jsonb_build_object('occurrence_id', v_occ_id, 'comissao_bruta', v_comissao_bruta);
end;
$function$;

-- =============================================================================
-- Definição final preservada de 20260819080000_dashboard_stats_liquido_imobiliaria.sql
-- =============================================================================

-- Adiciona 'liquido_imobiliaria_prevista_total' e 'liquido_imobiliaria_concluida_total' a
-- dashboard_stats(). Pedido do usuário: "quanto de comissão fica para a imobiliária descontando
-- todas as comissões pagas" — hoje 'comissao_prevista_total'/'comissao_concluida_total' só
-- descontam a parceria externa confirmada (sem_cadastro_confirmado), não o que é pago a
-- corretores/gestores/team leaders internos via occurrence_commissions (visível hoje só
-- pulverizado no card "Comissão por corretor", sem total consolidado).
--
-- Fórmula: valor_comissao de cada ocorrência menos TODAS as linhas de occurrence_commissions
-- daquela ocorrência (internas com user_id + parceria externa confirmada) — sobra só o que não
-- foi atribuído a ninguém nomeado, ou seja, o que fica de fato com a casa. Equivale a
-- comissao_prevista_total/concluida_total (que já descontam só a parceria externa) menos a soma
-- de comissao_por_corretor.
--
-- Simulado antes de aplicar (execute_sql direto no projeto, sem alterar nada) contra os dados
-- reais de produção em 2026-08-19: comissao_prevista_total R$153.577,11 -> líquido R$55.874,98;
-- comissao_concluida_total R$55.200,00 -> líquido R$23.700,00. Também confirmado nessa simulação:
-- nenhuma linha de occurrence_commissions sem user_id e sem sem_cadastro_confirmado (vínculo
-- esquecido/quebrado, ver comissao-por-beneficiario.ts) nas vendas ativas hoje — então o valor
-- novo não corre risco de incluir, por engano, dinheiro que na verdade pertence a alguém com
-- vínculo quebrado. Se isso voltar a existir, essa soma entraria silenciosamente no líquido da
-- imobiliária (não há alerta pra esse caso ainda).
--
-- Não muda nem remove nenhuma chave existente de dashboard_stats().
create or replace function public.dashboard_stats()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with parceria_por_occ as (
    select occurrence_id, sum(valor) as valor
    from occurrence_commissions
    where sem_cadastro_confirmado
    group by occurrence_id
  ),
  todas_comissoes_por_occ as (
    select occurrence_id, sum(valor) as valor
    from occurrence_commissions
    group by occurrence_id
  )
  select jsonb_build_object(
    'funil', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (
        select status::text as status, count(*) as cnt from sales group by status
      ) t
    ),
    'minhas_vendas', (select count(*) from sales where corretor_id = auth.uid()),
    'minhas_pendencias', (select count(*) from sales where corretor_id = auth.uid() and status::text in ('rascunho','devolvida_ajuste')),
    'meus_contratos_conferir', (select count(*) from sales where corretor_id = auth.uid() and status::text = 'contrato_conferencia_corretor'),
    'meus_assinados', (select count(*) from sales where corretor_id = auth.uid() and status::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida')),
    'minha_comissao_prevista', coalesce((select sum(valor_total_comissao) from sales where corretor_id = auth.uid() and status::text not in ('ocorrencia_concluida','arquivada','cancelada')), 0),
    'gestor_aguardando_revisao', (select count(*) from sales where status::text = 'enviada_revisao'),
    'gestor_contratos_conferir', (select count(*) from sales where status::text in ('contrato_conferencia_gestor','contrato_ok_corretor')),
    'gestor_ocorrencias_enviar', (select count(*) from sales where status::text in ('ocorrencia_pendente','ocorrencia_devolvida_gestor')),
    'gestor_devolvidas', (select count(*) from sales where status::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')),
    'juridico_aprovadas_gestor', (select count(*) from sales where status::text = 'aprovada_gestor'),
    'juridico_em_elaboracao', (select count(*) from sales where status::text = 'em_elaboracao_contrato'),
    'juridico_aguardando_assinatura', (select count(*) from sales where status::text = 'aguardando_assinatura'),
    'juridico_assinados', (select count(*) from sales where status::text = 'contrato_assinado'),
    'fin_ocorrencias_analise', (select count(*) from sales where status::text = 'ocorrencia_analise_financeiro'),
    'fin_devolvidas', (select count(*) from sales where status::text = 'ocorrencia_devolvida_gestor'),
    'occ_pendentes_total', (select count(*) from occurrences o join sales s on s.id = o.sale_id where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'occ_concluidas_total', (select count(*) from occurrences o join sales s on s.id = o.sale_id where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'comissao_prevista_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from occurrences o
      join sales s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_concluida_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from occurrences o
      join sales s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_prevista_total', coalesce((
      select sum(p.valor)
      from occurrences o
      join sales s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_concluida_total', coalesce((
      select sum(p.valor)
      from occurrences o
      join sales s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_prevista_total', coalesce((
      select sum(o.valor_comissao - coalesce(t.valor, 0))
      from occurrences o
      join sales s on s.id = o.sale_id
      left join todas_comissoes_por_occ t on t.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_concluida_total', coalesce((
      select sum(o.valor_comissao - coalesce(t.valor, 0))
      from occurrences o
      join sales s on s.id = o.sale_id
      left join todas_comissoes_por_occ t on t.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_por_corretor', (
      select coalesce(jsonb_object_agg(user_id, total), '{}'::jsonb) from (
        select oc.user_id::text as user_id, sum(oc.valor) as total
        from occurrence_commissions oc
        join occurrences o on o.id = oc.occurrence_id
        join sales s on s.id = o.sale_id
        where s.status::text not in ('cancelada','arquivada') and oc.user_id is not null
        group by oc.user_id
      ) t
    )
  );
$function$;

-- =============================================================================
-- Definição final preservada de 20260819080000_lancamento_editar_ocorrencia_financeiro_devolvida.sql
-- =============================================================================

-- Pedido do usuário (19/08): financeiro/admin/super_admin devem poder editar a Ocorrência de
-- Lançamento também quando ela está 'devolvida_ajuste', não só 'ocorrencia_analise_financeiro' —
-- útil quando o corretor dono não está disponível pra fazer a correção ele mesmo. A migration
-- original (20260819060000) limitou de propósito só a 'ocorrencia_analise_financeiro' (ver comentário
-- lá — decisão consciente de não ampliar o acesso prático de então); esta migration amplia
-- explicitamente por pedido direto, com o mesmo mecanismo já existente (motivo obrigatório,
-- transação única, auditoria em activity_logs) — nenhuma lógica nova, só a allowlist de status.
--
-- Corpo idêntico ao de 20260819060000, exceto a checagem de status (era um único valor fixo, agora
-- 2). A ocorrência já existe em devolvida_ajuste desde o primeiro envio (só o status muda), então
-- v_occ_id sempre resolve — nenhum outro trecho da função precisa mudar.
create or replace function public.editar_ocorrencia_lancamento_financeiro(
  p_sale_id uuid,
  p_sale_patch jsonb,
  p_occ_patch jsonb,
  p_linhas jsonb,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale sales%rowtype;
  v_occ_id uuid;
  v_comprador_nome text;
  v_dist jsonb;
  v_comissao_bruta numeric;
  v_linha jsonb;
  v_ids_mantidos uuid[] := '{}';
  v_id uuid;
  v_before_sale_j jsonb;
  v_after_sale_j jsonb;
  v_before_occ_j jsonb;
  v_after_occ_j jsonb;
  v_before_linhas jsonb;
  v_after_linhas jsonb;
  v_sale_diff jsonb := '{}'::jsonb;
  v_occ_diff jsonb := '{}'::jsonb;
  v_field text;
  v_sale_fields constant text[] := array[
    'imovel_id','data_assinatura','tempo_venda_dias','midia','nota_fiscal_obrigatoria',
    'valor_anunciado','valor_negociado','percentual_comissao','valor_total_comissao','premio_valor',
    'previsao_recebimento_valor','previsao_recebimento_data','previsao_recebimento_forma',
    'previsao_recebimento2_valor','previsao_recebimento2_data','previsao_recebimento2_forma',
    'previsao_recebimento3_valor','previsao_recebimento3_data','previsao_recebimento3_forma',
    'negociacao_observacoes'
  ];
  v_occ_fields constant text[] := array[
    'financiamento','financiamento_valor','financiamento_banco','financiamento_correspondente',
    'financiamento_previsao','oba_credito'
  ];
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Motivo da alteração é obrigatório.' using errcode = '23514';
  end if;

  if not public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]) then
    raise exception 'Apenas o financeiro pode editar a ocorrência de Lançamento nesta etapa.' using errcode = '42501';
  end if;

  -- FOR UPDATE: mesma trava de salvar_divisao_comissao_lancamento()/concluir_lancamento() — serializa
  -- contra edição/conclusão concorrentes da MESMA venda (ver comentário no topo do arquivo original).
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  if v_sale.modalidade <> 'lancamento' then
    raise exception 'Esta venda não é uma venda de Lançamento.' using errcode = '23514';
  end if;

  -- ALTERADO: allowlist de 2 status agora (era só 'ocorrencia_analise_financeiro') — ver comentário
  -- no topo do arquivo.
  if v_sale.status::text not in ('ocorrencia_analise_financeiro', 'devolvida_ajuste') then
    raise exception 'Só é possível editar enquanto a ocorrência está em análise do financeiro ou devolvida para ajuste (status atual: %).', v_sale.status
      using errcode = '23514';
  end if;

  select id into v_occ_id from occurrences where sale_id = p_sale_id;
  if v_occ_id is null then
    raise exception 'Ocorrência desta venda não encontrada.' using errcode = 'P0002';
  end if;

  v_before_sale_j := to_jsonb(v_sale);
  select to_jsonb(o) into v_before_occ_j from occurrences o where o.id = v_occ_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'papel', papel, 'nome', nome, 'user_id', user_id,
      'percentual', percentual, 'valor', valor, 'sem_cadastro_confirmado', sem_cadastro_confirmado
    ) order by created_at), '[]'::jsonb)
    into v_before_linhas
  from sale_commission_extras where sale_id = p_sale_id;

  -- ===== 1) Resumo (sales) — mesmos campos que o formulário de rascunho já edita; cliente sempre
  -- manda o payload completo (mesma convenção de saveForm() em LancamentoDetail.tsx). =====
  update sales set
    imovel_id = nullif(p_sale_patch->>'imovel_id', ''),
    data_assinatura = nullif(p_sale_patch->>'data_assinatura', '')::date,
    tempo_venda_dias = (p_sale_patch->>'tempo_venda_dias')::integer,
    midia = nullif(p_sale_patch->>'midia', ''),
    nota_fiscal_obrigatoria = coalesce((p_sale_patch->>'nota_fiscal_obrigatoria')::boolean, false),
    valor_anunciado = (p_sale_patch->>'valor_anunciado')::numeric,
    valor_negociado = (p_sale_patch->>'valor_negociado')::numeric,
    percentual_comissao = (p_sale_patch->>'percentual_comissao')::numeric,
    valor_total_comissao = (p_sale_patch->>'valor_total_comissao')::numeric,
    premio_valor = (p_sale_patch->>'premio_valor')::numeric,
    previsao_recebimento_valor = (p_sale_patch->>'previsao_recebimento_valor')::numeric,
    previsao_recebimento_data = nullif(p_sale_patch->>'previsao_recebimento_data', '')::date,
    previsao_recebimento_forma = nullif(p_sale_patch->>'previsao_recebimento_forma', ''),
    previsao_recebimento2_valor = (p_sale_patch->>'previsao_recebimento2_valor')::numeric,
    previsao_recebimento2_data = nullif(p_sale_patch->>'previsao_recebimento2_data', '')::date,
    previsao_recebimento2_forma = nullif(p_sale_patch->>'previsao_recebimento2_forma', ''),
    previsao_recebimento3_valor = (p_sale_patch->>'previsao_recebimento3_valor')::numeric,
    previsao_recebimento3_data = nullif(p_sale_patch->>'previsao_recebimento3_data', '')::date,
    previsao_recebimento3_forma = nullif(p_sale_patch->>'previsao_recebimento3_forma', ''),
    negociacao_observacoes = nullif(p_sale_patch->>'negociacao_observacoes', '')
  where id = p_sale_id;

  select * into v_sale from sales where id = p_sale_id;

  -- ===== 2) Divisão da comissão (sale_commission_extras) — mesma lógica de identificação/update/
  -- insert/delete de salvar_divisao_comissao_lancamento(), copiada aqui de propósito (não chamada por
  -- referência) pra manter esta função autocontida e não depender de mudanças futuras naquela RPC. =====
  for v_linha in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb))
  loop
    v_id := nullif(v_linha->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from sale_commission_extras where id = v_id and sale_id = p_sale_id) then
      update sale_commission_extras set
        papel = v_linha->>'papel',
        nome = nullif(v_linha->>'nome', ''),
        user_id = nullif(v_linha->>'user_id', '')::uuid,
        percentual = (v_linha->>'percentual')::numeric,
        valor = (v_linha->>'valor')::numeric,
        sem_cadastro_confirmado = coalesce((v_linha->>'sem_cadastro_confirmado')::boolean, false)
      where id = v_id;
    else
      insert into sale_commission_extras (sale_id, papel, nome, user_id, percentual, valor, sem_cadastro_confirmado)
      values (
        p_sale_id, v_linha->>'papel', nullif(v_linha->>'nome', ''), nullif(v_linha->>'user_id', '')::uuid,
        (v_linha->>'percentual')::numeric, (v_linha->>'valor')::numeric,
        coalesce((v_linha->>'sem_cadastro_confirmado')::boolean, false)
      )
      returning id into v_id;
    end if;
    v_ids_mantidos := v_ids_mantidos || v_id;
  end loop;

  delete from sale_commission_extras
  where sale_id = p_sale_id and not (id = any(v_ids_mantidos));

  -- ===== 3) Recalcula e valida — mesma RPC que "Comissão bruta"/"Saldo da imobiliária"/o gate do
  -- Concluir já usam, agora já refletindo o patch acima. =====
  v_dist := public.calcular_distribuicao_venda(p_sale_id);
  v_comissao_bruta := (v_dist->>'comissao_bruta')::numeric;
  if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível salvar: %', (
      select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
    ) using errcode = '23514';
  end if;

  -- ===== 4) Campos só-da-ocorrência (financiamento) — não têm equivalente em sales, sempre foram
  -- preenchidos direto na ocorrência (criar_ocorrencia_lancamento nunca grava financiamento_*). =====
  update occurrences set
    financiamento = coalesce((p_occ_patch->>'financiamento')::boolean, false),
    financiamento_valor = (p_occ_patch->>'financiamento_valor')::numeric,
    financiamento_banco = nullif(p_occ_patch->>'financiamento_banco', ''),
    financiamento_correspondente = nullif(p_occ_patch->>'financiamento_correspondente', ''),
    financiamento_previsao = nullif(p_occ_patch->>'financiamento_previsao', '')::date,
    oba_credito = coalesce((p_occ_patch->>'oba_credito')::boolean, false)
  where id = v_occ_id;

  -- ===== 5) Sincroniza occurrences (campos derivados de sales) + occurrence_commissions — MESMA
  -- técnica do branch de reenvio de criar_ocorrencia_lancamento() (delete+reinsert das linhas
  -- derivadas de sale_commission_extras, update dos campos espelhados em occurrences). =====
  select nome into v_comprador_nome from sale_parties where sale_id = p_sale_id and papel = 'comprador_1';

  update occurrences set
    codigo_imovel = coalesce(v_sale.imovel_id, v_sale.codigo_interno),
    data_assinatura = v_sale.data_assinatura,
    tempo_venda_dias = v_sale.tempo_venda_dias,
    midia = v_sale.midia,
    valor_anunciado = v_sale.valor_anunciado,
    valor_negociado = v_sale.valor_negociado,
    percentual_comissao = v_sale.percentual_comissao,
    valor_comissao = v_comissao_bruta,
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

  -- ===== 6) Auditoria — só os campos que mudaram, nunca a linha inteira. =====
  select to_jsonb(v_sale) into v_after_sale_j;
  select to_jsonb(o) into v_after_occ_j from occurrences o where o.id = v_occ_id;

  foreach v_field in array v_sale_fields loop
    if (v_before_sale_j -> v_field) is distinct from (v_after_sale_j -> v_field) then
      v_sale_diff := v_sale_diff || jsonb_build_object(v_field, jsonb_build_object('de', v_before_sale_j -> v_field, 'para', v_after_sale_j -> v_field));
    end if;
  end loop;
  foreach v_field in array v_occ_fields loop
    if (v_before_occ_j -> v_field) is distinct from (v_after_occ_j -> v_field) then
      v_occ_diff := v_occ_diff || jsonb_build_object(v_field, jsonb_build_object('de', v_before_occ_j -> v_field, 'para', v_after_occ_j -> v_field));
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'papel', papel, 'nome', nome, 'user_id', user_id,
      'percentual', percentual, 'valor', valor, 'sem_cadastro_confirmado', sem_cadastro_confirmado
    ) order by created_at), '[]'::jsonb)
    into v_after_linhas
  from sale_commission_extras where sale_id = p_sale_id;

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (auth.uid(), p_sale_id, 'lancamento_editado_financeiro', jsonb_build_object(
    'motivo', p_motivo,
    'resumo_alteracoes', v_sale_diff,
    'financiamento_alteracoes', v_occ_diff,
    'comissao_antes', v_before_linhas,
    'comissao_depois', v_after_linhas
  ));

  return v_dist || jsonb_build_object('occurrence_id', v_occ_id, 'linhas', v_after_linhas);
end;
$function$;
