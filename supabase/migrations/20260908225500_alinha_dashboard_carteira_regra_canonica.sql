-- Alinha os totais financeiros do Dashboard e da carteira por período à fonte canônica.
-- A parceria externa soma as duas formas históricas de registro da ocorrência.
-- O líquido da imobiliária vem de calcular_distribuicao_venda(sales), que também inclui o prêmio
-- na modalidade Lançamento, sem manter uma segunda fórmula financeira nestas funções.

create or replace function public.dashboard_stats()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with parceria_por_occ as (
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
      public.calcular_distribuicao_venda(s.*) as resultado
    from occurrences o
    join sales s on s.id = o.sale_id
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
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from occurrences o
      join sales s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_concluida_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from occurrences o
      join sales s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
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

create or replace function public.comissoes_carteira_periodo(_de date, _ate date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with efetivadas as (
    select sale_id, venda_em as efetivada_em from public.vendas_comerciais_validas()
  ), parceria as (
    select occurrence_id, sum(valor) valor from (
      select occurrence_id, coalesce(valor, 0) valor from occurrence_partners
      union all
      select occurrence_id, coalesce(valor, 0) from occurrence_commissions
      where sem_cadastro_confirmado
    ) x group by occurrence_id
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
      select oc.user_id::text user_id, sum(oc.valor) total
      from occurrence_commissions oc
      join occurrences oi on oi.id = oc.occurrence_id
      join efetivadas ei on ei.sale_id = oi.sale_id
      where oc.user_id is not null and not coalesce(oc.sem_cadastro_confirmado, false)
        and ei.efetivada_em >= _de::timestamptz and ei.efetivada_em < (_ate + 1)::timestamptz
      group by oc.user_id
    ) q), '{}'::jsonb)
  )
  from occurrences o
  join efetivadas e on e.sale_id = o.sale_id
  join sales s on s.id = o.sale_id
  cross join lateral (select public.calcular_distribuicao_venda(s.*) as resultado) d
  left join parceria p on p.occurrence_id = o.id
  where _de <= _ate
    and e.efetivada_em >= _de::timestamptz and e.efetivada_em < (_ate + 1)::timestamptz
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

revoke execute on function public.comissoes_carteira_periodo(date,date) from public, anon;
grant execute on function public.comissoes_carteira_periodo(date,date) to authenticated;
