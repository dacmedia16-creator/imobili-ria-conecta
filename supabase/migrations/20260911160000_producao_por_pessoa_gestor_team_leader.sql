-- Permite que Gestores e Team Leaders consultem o relatório Produção por pessoa.
-- A RPC continua somente leitura, retorna apenas vendas concluídas e mantém a
-- checagem de papel no banco, independente da visibilidade do menu.

create or replace function public.producao_por_pessoa_dados()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with concl as (
    select distinct on (h.sale_id) h.sale_id, h.created_at as concluida_em
    from sale_status_history h
    where h.para::text = 'ocorrencia_concluida'
    order by h.sale_id, h.created_at desc
  ),
  lanc_vendedor_base as (
    select
      o.sale_id,
      oc.user_id,
      coalesce(p.nome, oc.nome) as nome,
      greatest(coalesce(oc.valor, 0), 0)::numeric as valor,
      count(*) over (partition by o.sale_id) as qtd_vendedores,
      sum(greatest(coalesce(oc.valor, 0), 0)) over (partition by o.sale_id) as total_vendedores
    from occurrences o
    join occurrence_commissions oc
      on oc.occurrence_id = o.id
     and oc.papel = 'corretor_vendedor'
    left join profiles p on p.id = oc.user_id
  ),
  lanc_vendedor as (
    select
      sale_id,
      user_id,
      nome,
      case
        when total_vendedores > 0 then valor / total_vendedores
        else 1::numeric / nullif(qtd_vendedores, 0)
      end as fracao
    from lanc_vendedor_base
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
    'concluida_em', c.concluida_em,
    'valor_negociado', s.valor_negociado,
    'comissao_bruta', (public.calcular_distribuicao_venda(s.*)->>'comissao_bruta')::numeric,
    'captador_id', case
      when s.modalidade::text = 'padrao' then coalesce(s.corretor_captador_id, fc.user_id)
      else s.corretor_captador_id
    end,
    'captador_nome', case
      when s.corretor_captador_id is not null then coalesce(pc.nome, s.corretor_captador)
      when s.modalidade::text = 'padrao' then fc.nome
      else null
    end,
    'vendedor_id', case
      when s.modalidade::text = 'lancamento' then lv.user_id
      else coalesce(s.corretor_vendedor_id, fv.user_id)
    end,
    'vendedor_nome', case
      when s.modalidade::text = 'lancamento' then lv.nome
      when s.corretor_vendedor_id is not null then coalesce(pv.nome, s.corretor_vendedor)
      else fv.nome
    end,
    'vendedor_fracao', case
      when s.modalidade::text = 'lancamento' then coalesce(lv.fracao, 1)
      else null
    end
  )), '[]'::jsonb)
  from sales s
  join occurrences o on o.sale_id = s.id and o.status = 'concluida'
  join concl c on c.sale_id = s.id
  left join profiles pc on pc.id = s.corretor_captador_id
  left join profiles pv on pv.id = s.corretor_vendedor_id
  left join lanc_vendedor lv on lv.sale_id = s.id
  left join ponta_fallback fc on fc.sale_id = s.id and fc.lado = 'captador'
  left join ponta_fallback fv on fv.sale_id = s.id and fv.lado = 'vendedor'
  where s.status::text not in ('cancelada', 'arquivada')
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$;

grant execute on function public.producao_por_pessoa_dados() to authenticated;
