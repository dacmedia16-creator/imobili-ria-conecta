-- Regra financeira oficial: parceria externa não compõe VGV, comissão, produção, ranking ou
-- desempenho da unidade. As duas fontes são somadas: occurrence_partners e
-- occurrence_commissions.sem_cadastro_confirmado.

drop function if exists public.comparativo_comissao_6pct();
create function public.comparativo_comissao_6pct()
returns table (
  sale_id uuid,
  codigo_interno text,
  imovel_id text,
  modalidade text,
  status text,
  corretor_id uuid,
  valor_negociado numeric,
  valor_total_comissao numeric,
  percentual_comissao numeric,
  parceria_externa numeric,
  data_fechamento date,
  evento_fechamento text
)
language plpgsql stable security invoker set search_path = public
as $$
begin
  if not public.has_any_role((select auth.uid()), array['admin','super_admin','financeiro']::public.app_role[]) then
    raise exception 'Acesso não autorizado ao Comparativo de Comissão.' using errcode = '42501';
  end if;

  return query
  select s.id, s.codigo_interno, s.imovel_id, s.modalidade::text, s.status::text, s.corretor_id,
    s.valor_negociado, s.valor_total_comissao, s.percentual_comissao,
    coalesce(px.valor, 0), f.data_efetivacao::date, 'ocorrencia_analise_financeiro'::text
  from public.sales s
  join lateral (
    select min(h.created_at) as data_efetivacao
    from public.sale_status_history h
    where h.sale_id = s.id and h.para::text = 'ocorrencia_analise_financeiro'
  ) f on f.data_efetivacao is not null
  left join lateral (
    select coalesce((select sum(op.valor) from public.occurrences o join public.occurrence_partners op on op.occurrence_id = o.id where o.sale_id = s.id), 0)
         + coalesce((select sum(oc.valor) from public.occurrences o join public.occurrence_commissions oc on oc.occurrence_id = o.id where o.sale_id = s.id and oc.sem_cadastro_confirmado), 0) as valor
  ) px on true
  where s.status::text not in ('cancelada','arquivada')
    and s.valor_negociado > 0 and s.valor_total_comissao > 0;
end;
$$;

revoke execute on function public.comparativo_comissao_6pct() from public, anon;
grant execute on function public.comparativo_comissao_6pct() to authenticated;

create or replace function public.producao_por_pessoa_dados()
returns jsonb language sql stable set search_path = public
as $$
  with concl as (
    select distinct on (h.sale_id) h.sale_id, h.created_at as concluida_em
    from sale_status_history h where h.para::text = 'ocorrencia_concluida'
    order by h.sale_id, h.created_at desc
  ),
  lanc_vendedor_base as (
    select o.sale_id, oc.user_id, coalesce(p.nome, oc.nome) as nome,
      greatest(coalesce(oc.valor, 0), 0)::numeric as valor,
      count(*) over (partition by o.sale_id) as qtd_vendedores,
      sum(greatest(coalesce(oc.valor, 0), 0)) over (partition by o.sale_id) as total_vendedores
    from occurrences o
    join occurrence_commissions oc on oc.occurrence_id = o.id
      and oc.papel = 'corretor_vendedor' and not coalesce(oc.sem_cadastro_confirmado, false)
    left join profiles p on p.id = oc.user_id
  ),
  lanc_vendedor as (
    select sale_id, user_id, nome,
      case when total_vendedores > 0 then valor / total_vendedores
           else 1::numeric / nullif(qtd_vendedores, 0) end as fracao
    from lanc_vendedor_base
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_id', s.id, 'imovel_id', s.imovel_id, 'codigo_interno', s.codigo_interno,
    'modalidade', s.modalidade::text, 'concluida_em', c.concluida_em,
    'valor_negociado', s.valor_negociado,
    'comissao_bruta', (public.calcular_distribuicao_venda(s.*)->>'comissao_bruta')::numeric,
    'parceria_externa', coalesce(px.valor, 0),
    'captador_id', s.corretor_captador_id, 'captador_nome', coalesce(pc.nome, s.corretor_captador),
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
  left join lateral (
    select coalesce((select sum(op.valor) from occurrence_partners op where op.occurrence_id = o.id), 0)
         + coalesce((select sum(oc.valor) from occurrence_commissions oc where oc.occurrence_id = o.id and oc.sem_cadastro_confirmado), 0) as valor
  ) px on true
  where s.status::text not in ('cancelada','arquivada')
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

grant execute on function public.producao_por_pessoa_dados() to authenticated;

-- Fonte única auxiliar para painéis que precisam ratear o VGV sem duplicar a regra de parceria.
create or replace function public.metricas_venda_sem_parceria()
returns table (sale_id uuid, vgv numeric, comissao_bruta numeric, parceria_externa numeric)
language sql stable security invoker set search_path = public
as $$
  select s.id, coalesce(s.valor_negociado, 0), coalesce(s.valor_total_comissao, 0),
    coalesce((select sum(op.valor) from occurrences o join occurrence_partners op on op.occurrence_id = o.id where o.sale_id = s.id), 0)
    + coalesce((select sum(oc.valor) from occurrences o join occurrence_commissions oc on oc.occurrence_id = o.id where o.sale_id = s.id and oc.sem_cadastro_confirmado), 0)
  from sales s
  where s.status::text not in ('cancelada','arquivada');
$$;

revoke execute on function public.metricas_venda_sem_parceria() from public, anon;
grant execute on function public.metricas_venda_sem_parceria() to authenticated;

create or replace function public.comissoes_carteira_sem_parceria()
returns jsonb language sql stable security invoker set search_path = public
as $$
  with parceria as (
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
      from occurrence_commissions oc join occurrences oi on oi.id = oc.occurrence_id
      join sales si on si.id = oi.sale_id
      where oc.user_id is not null and not coalesce(oc.sem_cadastro_confirmado, false)
        and si.status::text not in ('cancelada','arquivada') group by oc.user_id
    ) q), '{}'::jsonb)
  )
  from occurrences o join sales s on s.id = o.sale_id
  left join parceria p on p.occurrence_id = o.id
  left join todas t on t.occurrence_id = o.id
  where s.status::text not in ('cancelada','arquivada')
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

revoke execute on function public.comissoes_carteira_sem_parceria() from public, anon;
grant execute on function public.comissoes_carteira_sem_parceria() to authenticated;

create or replace function public.resumo_operacao_sem_parceria_30d()
returns jsonb language sql stable security invoker set search_path = public
as $$
  with fechadas as (
    select distinct on (h.sale_id) h.sale_id, h.created_at fechado_em
    from sale_status_history h
    where h.para::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida')
    order by h.sale_id, h.created_at asc
  ), base as (
    select s.id, greatest(coalesce(s.valor_negociado, 0), 0) vgv,
      greatest(coalesce((public.calcular_distribuicao_venda(s.*)->>'comissao_bruta')::numeric, 0), 0) bruta,
      coalesce((select sum(op.valor) from occurrences o join occurrence_partners op on op.occurrence_id = o.id where o.sale_id = s.id), 0)
      + coalesce((select sum(oc.valor) from occurrences o join occurrence_commissions oc on oc.occurrence_id = o.id where o.sale_id = s.id and oc.sem_cadastro_confirmado), 0) parceria
    from fechadas f join sales s on s.id = f.sale_id
    where f.fechado_em >= now() - interval '30 days'
      and s.status::text not in ('cancelada','arquivada')
  ), propria as (
    select *, greatest(bruta - parceria, 0) comissao_propria,
      case when bruta > 0 then vgv * least(greatest(bruta - parceria, 0) / bruta, 1) else 0 end vgv_proprio
    from base
  )
  select jsonb_build_object(
    'vgv_proprio', coalesce(sum(vgv_proprio), 0),
    'comissao_propria', coalesce(sum(comissao_propria), 0)
  ) from propria
  where has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[]);
$$;

revoke execute on function public.resumo_operacao_sem_parceria_30d() from public, anon;
grant execute on function public.resumo_operacao_sem_parceria_30d() to authenticated;
