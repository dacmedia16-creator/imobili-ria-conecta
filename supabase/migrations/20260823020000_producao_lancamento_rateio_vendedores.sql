-- Evita duplicidade no relatório "Produção por Pessoa" quando um Lançamento tem mais de um
-- corretor vendedor. A comissão financeira persistida não é alterada: esta RPC apenas calcula a
-- fração de produção de cada vendedor proporcionalmente ao valor da sua comissão. Se os valores
-- forem nulos/zero, divide igualmente entre os vendedores para ainda fechar exatamente uma venda.
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
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_id', s.id,
    'imovel_id', s.imovel_id,
    'codigo_interno', s.codigo_interno,
    'modalidade', s.modalidade::text,
    'concluida_em', c.concluida_em,
    'valor_negociado', s.valor_negociado,
    'comissao_bruta', (public.calcular_distribuicao_venda(s.*)->>'comissao_bruta')::numeric,
    'captador_id', s.corretor_captador_id,
    'captador_nome', coalesce(pc.nome, s.corretor_captador),
    'vendedor_id', case when s.modalidade::text = 'lancamento' then lv.user_id else s.corretor_vendedor_id end,
    'vendedor_nome', case when s.modalidade::text = 'lancamento' then lv.nome else coalesce(pv.nome, s.corretor_vendedor) end,
    'vendedor_fracao', case when s.modalidade::text = 'lancamento' then coalesce(lv.fracao, 1) else null end
  )), '[]'::jsonb)
  from sales s
  join occurrences o on o.sale_id = s.id and o.status = 'concluida'
  join concl c on c.sale_id = s.id
  left join profiles pc on pc.id = s.corretor_captador_id
  left join profiles pv on pv.id = s.corretor_vendedor_id
  left join lanc_vendedor lv on lv.sale_id = s.id
  where s.status::text not in ('cancelada', 'arquivada')
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$function$;

grant execute on function public.producao_por_pessoa_dados() to authenticated;
