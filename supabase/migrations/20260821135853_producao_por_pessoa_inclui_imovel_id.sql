-- producao_por_pessoa_dados() só devolvia codigo_interno pro rótulo da operação, diferente do resto
-- do sistema (que sempre usa imovel_id || codigo_interno || "Venda #<id>"). Vendas Padrão que têm
-- imovel_id preenchido mas nunca tiveram codigo_interno digitado caíam no fallback "Venda #<id>" à
-- toa no relatório "Produção Gerada por Pessoa", divergindo de como a mesma venda aparece em
-- qualquer outra tela do sistema.
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
  lanc_vendedor as (
    select o.sale_id, oc.user_id, coalesce(p.nome, oc.nome) as nome
    from occurrences o
    join occurrence_commissions oc on oc.occurrence_id = o.id and oc.papel = 'corretor_vendedor'
    left join profiles p on p.id = oc.user_id
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
    'vendedor_nome', case when s.modalidade::text = 'lancamento' then lv.nome else coalesce(pv.nome, s.corretor_vendedor) end
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
