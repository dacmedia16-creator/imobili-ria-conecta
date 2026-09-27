-- Rollback de 20260927160000: devolve as 3 RPCs às definições anteriores (grupo 1/grupo 3 desta branch;
-- participacoes_comerciais_validas = pg_get_functiondef implantado em 27/09/2026) e remove o
-- histórico. Se as migrations 120000/140000 também forem revertidas, aplique os rollbacks delas depois.
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
    case when p.conta_equipe then coalesce(tm.team_id, tl.id) end as team_id
  from por_pessoa p
  left join team_members tm on tm.membro_id = p.user_id
  left join lateral (
    select t.id from teams t join team_members m on m.team_id = t.id
    where t.lider_id = p.user_id
    group by t.id, t.created_at order by t.created_at limit 1
  ) tl on tm.team_id is null;
$function$
;

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
    select p.corretor_id, coalesce(tm.team_id, tl.id) as team_id
    from (select distinct user_id as corretor_id from participante_venda) p
    left join team_members tm on tm.membro_id = p.corretor_id
    left join lateral (
      select equipe.id
      from teams equipe
      join team_members membros on membros.team_id = equipe.id
      where equipe.lider_id = p.corretor_id
      group by equipe.id, equipe.created_at
      order by equipe.created_at
      limit 1
    ) tl on tm.team_id is null
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
      u.team_id,
      p.sale_id,
      bool_or(p.teve_devolucao) as teve_devolucao,
      sum(p.valor_equipe_na_venda) as comissao
    from participante_venda p
    join unidade u on u.corretor_id = p.user_id
    where p.conta_equipe and u.team_id is not null
    group by u.team_id, p.sale_id
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
$function$
;

CREATE OR REPLACE FUNCTION public.comissao_coordenador_dados(p_mes date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with occs as (
    select o.id as occurrence_id, s.modalidade::text as modalidade
    from public.vendas_comerciais_validas() v
    join public.sales s on s.id = v.sale_id
    join public.occurrences o on o.sale_id = s.id
    where o.status = 'concluida'
      and s.status::text not in ('cancelada', 'arquivada')
      and v.venda_em >= (date_trunc('month', p_mes)::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((date_trunc('month', p_mes) + interval '1 month')::timestamp at time zone 'America/Sao_Paulo')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrence_id', oc.occurrence_id,
    'modalidade', occs.modalidade,
    'papel', oc.papel,
    'user_id', oc.user_id,
    'nome', p.nome,
    'valor', oc.valor,
    'sem_cadastro_confirmado', coalesce(oc.sem_cadastro_confirmado, false),
    'cargo_gestor', exists (select 1 from public.user_roles r where r.user_id = oc.user_id and r.role = 'gestor'),
    'cargo_team_leader', exists (select 1 from public.user_roles r where r.user_id = oc.user_id and r.role = 'team_leader'),
    'lideres_equipe', coalesce((
      select jsonb_agg(distinct t.lider_id)
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      where tm.membro_id = oc.user_id and t.lider_id is not null
    ), '[]'::jsonb)
  ) order by oc.occurrence_id, oc.papel, oc.user_id nulls last, oc.valor), '[]'::jsonb)
  from public.occurrence_commissions oc
  join occs on occs.occurrence_id = oc.occurrence_id
  left join public.profiles p on p.id = oc.user_id
  where public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::public.app_role[]);
$function$
;

DROP TRIGGER IF EXISTS trg_team_members_historico ON public.team_members;
DROP FUNCTION IF EXISTS public.registrar_historico_team_members();
DROP FUNCTION IF EXISTS public.equipe_vigencias();
DROP FUNCTION IF EXISTS public.equipe_vigente(uuid, timestamptz);
DROP TABLE IF EXISTS public.team_membership_history;
