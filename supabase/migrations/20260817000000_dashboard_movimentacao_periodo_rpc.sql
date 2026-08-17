-- "Movimentação do período" do dashboard — RPC nova e paralela, não altera dashboard_stats() nem
-- visao_executiva_stats().
--
-- Diferença central em relação ao funil da Etapa 2A: o funil conta o status ATUAL de cada venda
-- (sales.status). Esta RPC conta MOVIMENTOS — quando cada venda entrou pela primeira vez em cada
-- grupo de negócio, segundo sale_status_history. Por isso uma mesma venda pode aparecer tanto em
-- "futuras" quanto em "confirmadas" no mesmo período: são dois eventos distintos, não uma soma de
-- baldes mutuamente exclusivos.
--
-- Marco de cada movimento = primeira transição (MIN(created_at) em sale_status_history) para
-- QUALQUER status do grupo de negócio correspondente (classificarGrupoVenda, src/lib/status.ts) —
-- não um único status fixo. Isso é obrigatório para "confirmada": a modalidade Lançamento pula
-- contrato_assinado por design (vai direto pra ocorrencia_analise_financeiro) e nunca teria marco
-- nenhum se a regra dependesse só de 'contrato_assinado', ficando permanentemente invisível nesse
-- movimento.
--
-- sem_data_* é independente do período: conta, entre as vendas HOJE no grupo (por status atual),
-- quantas não têm nenhum marco de entrada nesse grupo no histórico — um sinal de qualidade de
-- dado (histórico incompleto/legado), não uma contagem do período selecionado.
create or replace function public.dashboard_movimentacao_periodo(_inicio timestamptz, _fim timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
begin
  if _inicio is null or _fim is null then
    raise exception 'dashboard_movimentacao_periodo: _inicio e _fim são obrigatórios (não podem ser nulos).';
  end if;
  if _fim <= _inicio then
    raise exception 'dashboard_movimentacao_periodo: _fim (%) deve ser maior que _inicio (%).', _fim, _inicio;
  end if;

  return (
    with marco_futura as (
      select sale_id, min(created_at) as em
      from sale_status_history
      where para::text in (
        'enviada_revisao', 'devolvida_ajuste', 'aprovada_gestor', 'enviada_juridico',
        'em_elaboracao_contrato', 'contrato_conferencia_gestor', 'contrato_conferencia_corretor',
        'contrato_ok_corretor', 'aguardando_assinatura'
      )
      group by sale_id
    ),
    marco_confirmada as (
      select sale_id, min(created_at) as em
      from sale_status_history
      where para::text in (
        'contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
        'ocorrencia_devolvida_gestor', 'ocorrencia_concluida'
      )
      group by sale_id
    ),
    marco_encerrada as (
      select sale_id, min(created_at) as em
      from sale_status_history
      where para::text in ('cancelada', 'arquivada')
      group by sale_id
    ),
    futuras as (
      select s.id, s.valor_negociado
      from sales s
      join marco_futura mf on mf.sale_id = s.id
      where mf.em >= _inicio and mf.em < _fim
    ),
    confirmadas as (
      select s.id, s.valor_negociado
      from sales s
      join marco_confirmada mc on mc.sale_id = s.id
      where mc.em >= _inicio and mc.em < _fim
    ),
    encerradas as (
      select s.id
      from sales s
      join marco_encerrada me on me.sale_id = s.id
      where me.em >= _inicio and me.em < _fim
    ),
    -- Grupos por status ATUAL (não por período) — só para os contadores sem_data_*.
    grupo_futura_atual as (
      select id from sales where status::text in (
        'enviada_revisao', 'devolvida_ajuste', 'aprovada_gestor', 'enviada_juridico',
        'em_elaboracao_contrato', 'contrato_conferencia_gestor', 'contrato_conferencia_corretor',
        'contrato_ok_corretor', 'aguardando_assinatura'
      )
    ),
    grupo_confirmada_atual as (
      select id from sales where status::text in (
        'contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
        'ocorrencia_devolvida_gestor', 'ocorrencia_concluida'
      )
    ),
    grupo_encerrada_atual as (
      select id from sales where status::text in ('cancelada', 'arquivada')
    )
    select jsonb_build_object(
      'futuras_quantidade', (select count(*) from futuras),
      'futuras_vgv', coalesce((select sum(valor_negociado) from futuras), 0),
      'confirmadas_quantidade', (select count(*) from confirmadas),
      'confirmadas_vgv', coalesce((select sum(valor_negociado) from confirmadas), 0),
      'encerradas_quantidade', (select count(*) from encerradas),
      'sem_data_futura', (
        select count(*) from grupo_futura_atual g
        where not exists (select 1 from marco_futura mf where mf.sale_id = g.id)
      ),
      'sem_data_confirmada', (
        select count(*) from grupo_confirmada_atual g
        where not exists (select 1 from marco_confirmada mc where mc.sale_id = g.id)
      ),
      'sem_data_encerrada', (
        select count(*) from grupo_encerrada_atual g
        where not exists (select 1 from marco_encerrada me where me.sale_id = g.id)
      )
    )
  );
end;
$function$;

-- Só authenticated — sem anon. Diferente do padrão herdado por dashboard_stats(), que tem GRANT a
-- anon por acidente histórico (ver migration de revert de EXECUTE em supabase/migrations); esta
-- função não existia quando aquele acidente aconteceu, então já nasce restrita, sem nada a
-- reverter. Não é usada dentro de nenhuma policy de RLS — diferente das funções daquele
-- incidente — então restringir seu EXECUTE não tem risco de quebrar leitura/escrita em outras
-- tabelas.
revoke all on function public.dashboard_movimentacao_periodo(timestamptz, timestamptz) from public;
grant execute on function public.dashboard_movimentacao_periodo(timestamptz, timestamptz) to authenticated;
