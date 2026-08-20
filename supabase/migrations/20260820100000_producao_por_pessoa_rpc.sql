-- RPC pro relatório novo "Produção Gerada por Pessoa" (pedido do usuário, validado por simulação em
-- chat com dados reais antes de virar código). Mede quanto cada pessoa gerou pra operação — VGV e
-- comissão BRUTA da venda, nunca o valor líquido individual pago a corretor/gestor (occurrence_commissions
-- é só usada aqui pra achar QUEM é o vendedor de uma venda de Lançamento, nunca pro valor).
--
-- Regra de divisão (aplicada no front-end, src/lib/producao-por-pessoa-calc.ts): cada venda completa
-- = 1 venda. Padrão: 0,5 pra quem captou + 0,5 pra quem vendeu, cada ponta com metade do VGV e da
-- comissão. Lançamento: não tem captação (sales.corretor_captador_id/corretor_vendedor_id sempre
-- nulos nessa modalidade — confirmado por simulação), conta 1 venda inteira na ponta "venda".
--
-- Comissão bruta "oficial": reusa calcular_distribuicao_venda(sales) — não reimplementa a fórmula
-- (percentual_comissao * valor_negociado, com fallback pra valor_total_comissao) pra não repetir o
-- bug de divergência já corrigido em 20260819110000_calcular_distribuicao_venda_conflito_comissao.
--
-- Pessoa da ponta "venda" em Lançamento: só existe em occurrence_commissions.papel = 'corretor_vendedor'
-- (join por occurrence_id) — sales não guarda captador/vendedor nessa modalidade.
--
-- Período de referência: última entrada em 'ocorrencia_concluida' no histórico (mesmo critério do
-- relatório "Comissão por Coordenador") — só conta produção já confirmada financeiramente. Vendas
-- canceladas/arquivadas nunca entram.
--
-- Acesso: financeiro/admin/super_admin — mesmo papel dos outros relatórios financeiros.
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

grant execute on function public.producao_por_pessoa_dados() to authenticated;
