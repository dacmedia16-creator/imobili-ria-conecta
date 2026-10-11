-- Faz o intervalo escolhido na tela Desempenho valer também para comissões, gráfico e metas.

create or replace function public.comissoes_carteira_periodo(_de date, _ate date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with efetivadas as (
    select h.sale_id, min(h.created_at) efetivada_em
    from sale_status_history h
    where h.para::text = 'ocorrencia_analise_financeiro'
    group by h.sale_id
  ), parceria as (
    select occurrence_id, sum(valor) valor from (
      select occurrence_id, coalesce(valor, 0) valor from occurrence_partners
      union all
      select occurrence_id, coalesce(valor, 0) from occurrence_commissions
      where sem_cadastro_confirmado
    ) x group by occurrence_id
  ), todas as (
    select occurrence_id, sum(coalesce(valor, 0)) valor
    from occurrence_commissions group by occurrence_id
  )
  select jsonb_build_object(
    'comissao_prevista_total', coalesce(sum(greatest(o.valor_comissao - coalesce(p.valor, 0), 0)) filter (where o.status <> 'concluida'), 0),
    'comissao_concluida_total', coalesce(sum(greatest(o.valor_comissao - coalesce(p.valor, 0), 0)) filter (where o.status = 'concluida'), 0),
    'comissao_parceria_externa_prevista_total', coalesce(sum(coalesce(p.valor, 0)) filter (where o.status <> 'concluida'), 0),
    'comissao_parceria_externa_concluida_total', coalesce(sum(coalesce(p.valor, 0)) filter (where o.status = 'concluida'), 0),
    'liquido_imobiliaria_prevista_total', coalesce(sum(greatest(o.valor_comissao - coalesce(t.valor, 0) - coalesce((select sum(op.valor) from occurrence_partners op where op.occurrence_id = o.id), 0), 0)) filter (where o.status <> 'concluida'), 0),
    'liquido_imobiliaria_concluida_total', coalesce(sum(greatest(o.valor_comissao - coalesce(t.valor, 0) - coalesce((select sum(op.valor) from occurrence_partners op where op.occurrence_id = o.id), 0), 0)) filter (where o.status = 'concluida'), 0),
    'comissao_por_corretor', coalesce((select jsonb_object_agg(user_id, total) from (
      select oc.user_id::text user_id, sum(oc.valor) total
      from occurrence_commissions oc
      join occurrences oi on oi.id = oc.occurrence_id
      join efetivadas ei on ei.sale_id = oi.sale_id
      join sales si on si.id = oi.sale_id
      where oc.user_id is not null and not coalesce(oc.sem_cadastro_confirmado, false)
        and ei.efetivada_em >= _de::timestamptz and ei.efetivada_em < (_ate + 1)::timestamptz
        and si.status::text not in ('cancelada','arquivada') group by oc.user_id
    ) q), '{}'::jsonb)
  )
  from occurrences o
  join efetivadas e on e.sale_id = o.sale_id
  join sales s on s.id = o.sale_id
  left join parceria p on p.occurrence_id = o.id
  left join todas t on t.occurrence_id = o.id
  where _de <= _ate
    and e.efetivada_em >= _de::timestamptz and e.efetivada_em < (_ate + 1)::timestamptz
    and s.status::text not in ('cancelada','arquivada')
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

create or replace function public.desempenho_contexto_periodo(_de date, _ate date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with stage_map(status, stage) as (values
    ('rascunho','inicio'), ('devolvida_ajuste','inicio'), ('ocorrencia_devolvida_gestor','inicio'),
    ('enviada_revisao','aprovacao'), ('aprovada_gestor','aprovacao'),
    ('enviada_juridico','juridico'), ('em_elaboracao_contrato','juridico'),
    ('contrato_conferencia_gestor','juridico'), ('contrato_conferencia_corretor','juridico'),
    ('contrato_ok_corretor','juridico'), ('aguardando_assinatura','juridico'),
    ('contrato_assinado','concluida'), ('ocorrencia_pendente','concluida'),
    ('ocorrencia_analise_financeiro','concluida'), ('ocorrencia_concluida','concluida')
  ), historico as (
    select h.sale_id, h.para,
      least(coalesce(lead(h.created_at) over (partition by h.sale_id order by h.created_at), (_ate + 1)::timestamptz), (_ate + 1)::timestamptz)
        - greatest(h.created_at, _de::timestamptz) duracao
    from sale_status_history h
    where h.created_at < (_ate + 1)::timestamptz
  ), tempo as (
    select coalesce(jsonb_object_agg(stage, media), '{}'::jsonb) valor from (
      select sm.stage, round((avg(extract(epoch from h.duracao)) / 86400.0)::numeric, 1) media
      from historico h join stage_map sm on sm.status = h.para::text
      where h.duracao > interval '0 seconds' group by sm.stage
    ) x
  ), efetivadas as (
    select h.sale_id, min(h.created_at) efetivada_em
    from sale_status_history h where h.para::text = 'ocorrencia_analise_financeiro'
    group by h.sale_id
  ), evolucao as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', to_char(m.mes, 'YYYY-MM'),
      'vendas_fechadas', coalesce(v.vendas, 0),
      'comissao', coalesce(v.comissao, 0)
    ) order by m.mes), '[]'::jsonb) valor
    from generate_series(date_trunc('month', _de::timestamp), date_trunc('month', _ate::timestamp), interval '1 month') m(mes)
    left join (
      select date_trunc('month', e.efetivada_em) mes, count(distinct e.sale_id) vendas,
        coalesce(sum(oc.valor) filter (where oc.user_id is not null), 0) comissao
      from efetivadas e join sales s on s.id = e.sale_id
      left join occurrences o on o.sale_id = e.sale_id
      left join occurrence_commissions oc on oc.occurrence_id = o.id
      where e.efetivada_em >= _de::timestamptz and e.efetivada_em < (_ate + 1)::timestamptz
        and s.status::text not in ('cancelada','arquivada') group by 1
    ) v on v.mes = m.mes
  ), whatsapp as (
    select count(*) eventos, coalesce(sum((payload->>'enviados')::int), 0) enviados,
      coalesce(sum((payload->>'falhas')::int), 0) falhas,
      count(*) filter (where (payload->>'falhas')::int > 0) eventos_com_falha
    from activity_logs
    where acao = 'whatsapp_notification_result'
      and created_at >= _de::timestamptz and created_at < (_ate + 1)::timestamptz
  )
  select jsonb_build_object(
    'tempo_por_etapa', (select valor from tempo),
    'evolucao_mensal', (select valor from evolucao),
    'whatsapp', case when has_any_role(auth.uid(), array['super_admin']::app_role[]) then
      (select jsonb_build_object('eventos', eventos, 'enviados', enviados, 'falhas', falhas, 'eventos_com_falha', eventos_com_falha) from whatsapp)
      else null end
  )
  where _de <= _ate and has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

create or replace function public.metas_progresso_periodo(_de date, _ate date)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with efetivadas as (
    select h.sale_id, min(h.created_at) efetivada_em
    from sale_status_history h where h.para::text = 'ocorrencia_analise_financeiro'
    group by h.sale_id
  ), comissao_corretor as (
    select oc.user_id corretor_id, sum(oc.valor) total
    from efetivadas e join sales s on s.id = e.sale_id
    join occurrences o on o.sale_id = e.sale_id
    join occurrence_commissions oc on oc.occurrence_id = o.id
    where oc.user_id is not null
      and e.efetivada_em >= _de::timestamptz and e.efetivada_em < (_ate + 1)::timestamptz
      and s.status::text not in ('cancelada','arquivada') group by oc.user_id
  ), unidade as (
    select cc.corretor_id, coalesce(tm.team_id, tl.id) team_id, cc.total
    from comissao_corretor cc left join team_members tm on tm.membro_id = cc.corretor_id
    left join teams tl on tl.lider_id = cc.corretor_id
  ), comissao_equipe as (
    select team_id, sum(total) total from unidade group by team_id
  ), metas_periodo as (
    select * from metas
    where mes >= date_trunc('month', _de)::date and mes <= date_trunc('month', _ate)::date
  )
  select jsonb_build_object(
    'corretor', coalesce((select jsonb_agg(jsonb_build_object(
      'corretor_id', m.corretor_id, 'meta_comissao', m.meta, 'comissao_realizada', coalesce(cc.total, 0)
    )) from (select corretor_id, sum(meta_comissao) meta from metas_periodo where tipo = 'corretor' group by corretor_id) m
      left join comissao_corretor cc on cc.corretor_id = m.corretor_id), '[]'::jsonb),
    'equipe', coalesce((select jsonb_agg(jsonb_build_object(
      'team_id', m.team_id, 'meta_comissao', m.meta, 'comissao_realizada', coalesce(ce.total, 0)
    )) from (select team_id, sum(meta_comissao) meta from metas_periodo where tipo = 'equipe' group by team_id) m
      left join comissao_equipe ce on ce.team_id = m.team_id), '[]'::jsonb)
  ) where _de <= _ate and has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

revoke execute on function public.comissoes_carteira_periodo(date, date) from public, anon;
revoke execute on function public.desempenho_contexto_periodo(date, date) from public, anon;
revoke execute on function public.metas_progresso_periodo(date, date) from public, anon;
grant execute on function public.comissoes_carteira_periodo(date, date) to authenticated;
grant execute on function public.desempenho_contexto_periodo(date, date) to authenticated;
grant execute on function public.metas_progresso_periodo(date, date) to authenticated;
