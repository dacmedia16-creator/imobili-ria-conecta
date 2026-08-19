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
