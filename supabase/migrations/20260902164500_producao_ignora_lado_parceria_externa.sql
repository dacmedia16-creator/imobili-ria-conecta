-- O relatório Produção por pessoa não deve tratar o lado coberto por parceria externa como
-- participante interno sem vínculo. Expõe os dois indicadores explícitos já gravados em sales
-- para que a camada de cálculo omita somente a ponta externa.

create or replace function public.producao_por_pessoa_dados()
returns jsonb language sql stable set search_path = public
as $$
  with lanc_vendedor_base as (
    select o.sale_id, oc.user_id, coalesce(p.nome, oc.nome) as nome,
      greatest(coalesce(oc.valor, 0), 0)::numeric as valor,
      count(*) over (partition by o.sale_id) as qtd_vendedores,
      sum(greatest(coalesce(oc.valor, 0), 0)) over (partition by o.sale_id) as total_vendedores
    from occurrences o
    join occurrence_commissions oc on oc.occurrence_id = o.id
      and oc.papel = 'corretor_vendedor'
      and not coalesce(oc.sem_cadastro_confirmado, false)
    left join profiles p on p.id = oc.user_id
  ), lanc_vendedor as (
    select sale_id, user_id, nome,
      case when total_vendedores > 0 then valor / total_vendedores
           else 1::numeric / nullif(qtd_vendedores, 0) end as fracao
    from lanc_vendedor_base
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_id', s.id, 'imovel_id', s.imovel_id, 'codigo_interno', s.codigo_interno,
    'modalidade', s.modalidade::text, 'efetivada_em', v.venda_em,
    'concluida_em', v.venda_em, 'valor_negociado', s.valor_negociado,
    'comissao_bruta', s.valor_total_comissao, 'parceria_externa', coalesce(px.valor, 0),
    'parceria_externa_captacao', coalesce(s.parceria_externa_captacao, false),
    'parceria_externa_venda', coalesce(s.parceria_externa_venda, false),
    'captador_id', s.corretor_captador_id, 'captador_nome', coalesce(pc.nome, s.corretor_captador),
    'vendedor_id', case when s.modalidade::text = 'lancamento' then lv.user_id else s.corretor_vendedor_id end,
    'vendedor_nome', case when s.modalidade::text = 'lancamento' then lv.nome else coalesce(pv.nome, s.corretor_vendedor) end,
    'vendedor_fracao', case when s.modalidade::text = 'lancamento' then coalesce(lv.fracao, 1) else null end
  )), '[]'::jsonb)
  from public.vendas_comerciais_validas() v
  join sales s on s.id = v.sale_id
  left join profiles pc on pc.id = s.corretor_captador_id
  left join profiles pv on pv.id = s.corretor_vendedor_id
  left join lanc_vendedor lv on lv.sale_id = s.id
  left join lateral (
    select
      coalesce((select sum(op.valor) from occurrences o join occurrence_partners op on op.occurrence_id = o.id where o.sale_id = s.id), 0)
      + coalesce((select sum(oc.valor) from occurrences o join occurrence_commissions oc on oc.occurrence_id = o.id where o.sale_id = s.id and oc.sem_cadastro_confirmado), 0) as valor
  ) px on true
  where s.valor_negociado > 0 and s.valor_total_comissao > 0
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

revoke execute on function public.producao_por_pessoa_dados() from public, anon;
grant execute on function public.producao_por_pessoa_dados() to authenticated;
