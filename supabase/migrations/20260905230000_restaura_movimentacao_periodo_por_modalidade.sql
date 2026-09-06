-- Adapta a correção histórica 159c4e3 ao contrato atual do dashboard sem restaurar a regra
-- comercial antiga. A migration 20260901215000 passou a obter vendas confirmadas exclusivamente
-- de vendas_comerciais_validas(); esta versão preserva essa fonte canônica e apenas volta a
-- devolver quantidade/VGV separados entre venda padrão e Lançamento.
--
-- Os campos agregados confirmadas_quantidade/confirmadas_vgv continuam no retorno por
-- retrocompatibilidade. Como sales_modalidade_check admite somente 'padrao' e 'lancamento', os
-- dois grupos separados recompõem exatamente o total agregado.
create or replace function public.dashboard_movimentacao_periodo(_inicio timestamptz, _fim timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if _inicio is null or _fim is null or _fim <= _inicio then
    raise exception 'Período inválido para dashboard_movimentacao_periodo.';
  end if;

  return (
    with marco_futura as (
      select sale_id, min(created_at) em
      from sale_status_history
      where para::text in (
        'enviada_revisao',
        'devolvida_ajuste',
        'aprovada_gestor',
        'enviada_juridico',
        'em_elaboracao_contrato',
        'contrato_conferencia_gestor',
        'contrato_conferencia_corretor',
        'contrato_ok_corretor',
        'aguardando_assinatura'
      )
      group by sale_id
    ), marco_confirmada as (
      select sale_id, venda_em em
      from public.vendas_comerciais_validas()
    ), marco_encerrada as (
      select sale_id, min(created_at) em
      from sale_status_history
      where para::text in ('cancelada', 'arquivada')
      group by sale_id
    ), futuras as (
      select s.id, s.valor_negociado
      from sales s
      join marco_futura m on m.sale_id = s.id
      where m.em >= _inicio and m.em < _fim
    ), confirmadas as (
      select s.id, s.valor_negociado, s.modalidade
      from sales s
      join marco_confirmada m on m.sale_id = s.id
      where m.em >= _inicio and m.em < _fim
    ), encerradas as (
      select s.id
      from sales s
      join marco_encerrada m on m.sale_id = s.id
      where m.em >= _inicio and m.em < _fim
    ), grupo_futura_atual as (
      select id
      from sales
      where status::text in (
        'enviada_revisao',
        'devolvida_ajuste',
        'aprovada_gestor',
        'enviada_juridico',
        'em_elaboracao_contrato',
        'contrato_conferencia_gestor',
        'contrato_conferencia_corretor',
        'contrato_ok_corretor',
        'aguardando_assinatura'
      )
    ), grupo_confirmada_atual as (
      select sale_id id
      from public.vendas_comerciais_validas()
    ), grupo_encerrada_atual as (
      select id
      from sales
      where status::text in ('cancelada', 'arquivada')
    )
    select jsonb_build_object(
      'futuras_quantidade', (select count(*) from futuras),
      'futuras_vgv', coalesce((select sum(valor_negociado) from futuras), 0),
      'confirmadas_quantidade', (select count(*) from confirmadas),
      'confirmadas_vgv', coalesce((select sum(valor_negociado) from confirmadas), 0),
      'confirmadas_contrato_quantidade', (
        select count(*) from confirmadas where modalidade::text = 'padrao'
      ),
      'confirmadas_contrato_vgv', coalesce((
        select sum(valor_negociado) from confirmadas where modalidade::text = 'padrao'
      ), 0),
      'confirmadas_lancamento_quantidade', (
        select count(*) from confirmadas where modalidade::text = 'lancamento'
      ),
      'confirmadas_lancamento_vgv', coalesce((
        select sum(valor_negociado) from confirmadas where modalidade::text = 'lancamento'
      ), 0),
      'encerradas_quantidade', (select count(*) from encerradas),
      'sem_data_futura', (
        select count(*)
        from grupo_futura_atual g
        where not exists (select 1 from marco_futura m where m.sale_id = g.id)
      ),
      'sem_data_confirmada', (
        select count(*)
        from grupo_confirmada_atual g
        where not exists (select 1 from marco_confirmada m where m.sale_id = g.id)
      ),
      'sem_data_encerrada', (
        select count(*)
        from grupo_encerrada_atual g
        where not exists (select 1 from marco_encerrada m where m.sale_id = g.id)
      )
    )
  );
end;
$$;

revoke all on function public.dashboard_movimentacao_periodo(timestamptz, timestamptz) from public;
grant execute on function public.dashboard_movimentacao_periodo(timestamptz, timestamptz) to authenticated;
