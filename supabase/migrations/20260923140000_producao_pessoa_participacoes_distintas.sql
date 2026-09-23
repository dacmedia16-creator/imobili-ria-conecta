-- Mantém a cardinalidade operacional em uma linha por venda e transporta a ponta de
-- venda como participações explícitas. Isso impede que um join 1:N em
-- occurrence_commissions multiplique VGV/comissão da operação.
--
-- A lista vendedor_participacoes é usada para ratear a atribuição no consumidor. As métricas
-- operacionais continuam baseadas em sales/vendas (uma operação por sale_id).
create or replace function public.producao_por_pessoa_dados()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $function$
  with vendas as (
    select sale_id, venda_em
    from public.vendas_comerciais_validas()
  ),
  ocorrencia_atual as (
    select distinct on (o.sale_id)
      o.sale_id,
      o.id as occurrence_id
    from occurrences o
    where o.sale_id is not null
    order by o.sale_id, o.updated_at desc nulls last, o.created_at desc nulls last, o.id desc
  ),
  vendedor_base as (
    select
      oa.sale_id,
      oc.user_id,
      coalesce(p.nome, oc.nome) as nome,
      sum(greatest(coalesce(oc.valor, 0), 0))::numeric as valor
    from ocorrencia_atual oa
    join occurrence_commissions oc
      on oc.occurrence_id = oa.occurrence_id
     and oc.papel = 'corretor_vendedor'
     and not coalesce(oc.sem_cadastro_confirmado, false)
    left join profiles p on p.id = oc.user_id
    group by oa.sale_id, oc.user_id, coalesce(p.nome, oc.nome)
  ),
  vendedor_rateio as (
    select
      sale_id,
      user_id,
      nome,
      case
        when sum(valor) over (partition by sale_id) > 0 then
          valor / sum(valor) over (partition by sale_id)
        else
          1::numeric / count(*) over (partition by sale_id)
      end as fracao
    from vendedor_base
  ),
  vendedores_por_venda as (
    select
      sale_id,
      jsonb_agg(
        jsonb_build_object(
          'user_id', user_id,
          'nome', nome,
          'fracao', fracao
        )
        order by nome nulls last, user_id nulls last
      ) as participacoes,
      (array_agg(user_id order by nome nulls last, user_id nulls last))[1] as primeiro_user_id,
      (array_agg(nome order by nome nulls last, user_id nulls last))[1] as primeiro_nome,
      (array_agg(fracao order by nome nulls last, user_id nulls last))[1] as primeira_fracao
    from vendedor_rateio
    group by sale_id
  ),
  ponta_candidatos as (
    select s.id as sale_id, 'captador'::text as lado, p.id as user_id, p.nome
    from sales s
    join profiles p on p.id = s.lider_captador_id

    union

    select s.id as sale_id, 'vendedor'::text as lado, p.id as user_id, p.nome
    from sales s
    join profiles p on p.id = s.lider_vendedor_id

    union

    select
      o.sale_id,
      case
        when oc.papel = 'lider_captador' then 'captador'
        when oc.papel = 'lider_vendedor' then 'vendedor'
        else oc.lado
      end as lado,
      p.id as user_id,
      p.nome
    from occurrences o
    join occurrence_commissions oc on oc.occurrence_id = o.id
    join profiles p on p.id = oc.user_id
    where oc.papel in ('lider_captador', 'lider_vendedor')
       or (oc.papel in ('gestor', 'team_leader') and oc.lado in ('captador', 'vendedor'))
  ),
  ponta_fallback as (
    select
      sale_id,
      lado,
      case when count(distinct user_id) = 1 then min(user_id::text)::uuid end as user_id,
      case when count(distinct user_id) = 1 then min(nome) end as nome
    from ponta_candidatos
    where lado in ('captador', 'vendedor')
    group by sale_id, lado
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_id', s.id,
    'imovel_id', s.imovel_id,
    'codigo_interno', s.codigo_interno,
    'modalidade', s.modalidade::text,
    'efetivada_em', v.venda_em,
    'concluida_em', v.venda_em,
    'valor_negociado', s.valor_negociado,
    'comissao_bruta', (public.calcular_distribuicao_venda(s.*)->>'comissao_bruta')::numeric,
    'parceria_externa', coalesce(px.valor, 0),
    'parceria_externa_captacao', coalesce(s.parceria_externa_captacao, false),
    'parceria_externa_venda', coalesce(s.parceria_externa_venda, false),
    'captador_id', case
      when s.modalidade::text = 'padrao' then coalesce(s.corretor_captador_id, fc.user_id)
      else s.corretor_captador_id
    end,
    'captador_nome', case
      when s.corretor_captador_id is not null then coalesce(pc.nome, s.corretor_captador)
      when s.modalidade::text = 'padrao' then fc.nome
      else null
    end,
    'vendedor_participacoes', coalesce(vpv.participacoes, '[]'::jsonb),
    'vendedor_id', case
      when s.modalidade::text = 'lancamento' then vpv.primeiro_user_id
      else coalesce(s.corretor_vendedor_id, fv.user_id)
    end,
    'vendedor_nome', case
      when s.modalidade::text = 'lancamento' then vpv.primeiro_nome
      when s.corretor_vendedor_id is not null then coalesce(pv.nome, s.corretor_vendedor)
      else fv.nome
    end,
    'vendedor_fracao', case
      when s.modalidade::text = 'lancamento' then coalesce(vpv.primeira_fracao, 1)
      else null
    end
  )), '[]'::jsonb)
  from vendas v
  join sales s on s.id = v.sale_id
  left join profiles pc on pc.id = s.corretor_captador_id
  left join profiles pv on pv.id = s.corretor_vendedor_id
  left join vendedores_por_venda vpv on vpv.sale_id = s.id
  left join ponta_fallback fc on fc.sale_id = s.id and fc.lado = 'captador'
  left join ponta_fallback fv on fv.sale_id = s.id and fv.lado = 'vendedor'
  left join lateral (
    select
      coalesce((
        select sum(op.valor)
        from occurrences o
        join occurrence_partners op on op.occurrence_id = o.id
        where o.sale_id = s.id
      ), 0)
      + coalesce((
        select sum(oc.valor)
        from occurrences o
        join occurrence_commissions oc on oc.occurrence_id = o.id
        where o.sale_id = s.id and oc.sem_cadastro_confirmado
      ), 0) as valor
  ) px on true
  where s.status::text not in ('cancelada', 'arquivada')
    and s.valor_negociado > 0
    and s.valor_total_comissao > 0
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$;

revoke execute on function public.producao_por_pessoa_dados() from public, anon, service_role;
grant execute on function public.producao_por_pessoa_dados() to authenticated;
