-- dashboard_movimentacao_periodo() (corrigida em 20260819010000 pra fechar duplicidade) agrupava
-- "confirmada" por status (contrato_assinado, ocorrencia_*) sem olhar a modalidade da venda. Isso
-- misturava dois eventos de negócio bem diferentes no mesmo número:
--   - venda padrão: só entra em "confirmada" depois de `aguardando_assinatura -> contrato_assinado`,
--     transição que o trigger validate_sale_status_transition só libera com o documento do contrato
--     assinado anexado (ver 20260719140000) -- ou seja, É contrato assinado de verdade.
--   - venda de Lançamento (parceria com construtora): pula direto de `rascunho` pra
--     `ocorrencia_analise_financeiro` (única transição que o papel 'lancamento' pode fazer, ver
--     20260811030000) -- NUNCA passa por contrato_assinado, por desenho (modalidade "sem
--     documentos, sem jurídico, sem contrato").
-- Auditoria pedida pelo usuário (2026-08-18) achou 6 de 15 "confirmadas" de Agosto/2026 sendo
-- Lançamento sem contrato nenhum -- o card estava implicando "contrato assinado" pra vendas que
-- nunca tiveram contrato. Divide o balde "confirmada" em dois, por modalidade; "futura" e
-- "encerrada" não têm essa ambiguidade hoje (Lançamento nunca passa por "futura", e as únicas
-- "encerradas" atuais são padrão) -- não precisam de split.
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
    -- Última transição de cada venda DENTRO do período — decide o único grupo em que ela é
    -- contada (requisito: "cada venda contada uma única vez, conforme seu status mais recente no
    -- período selecionado").
    ultima_transicao_periodo as (
      select distinct on (sale_id) sale_id, para
      from sale_status_history
      where created_at >= _inicio and created_at < _fim
      order by sale_id, created_at desc
    ),
    movimentadas as (
      select
        s.id,
        s.valor_negociado,
        s.modalidade,
        case
          when ut.para::text in (
            'enviada_revisao', 'devolvida_ajuste', 'aprovada_gestor', 'enviada_juridico',
            'em_elaboracao_contrato', 'contrato_conferencia_gestor', 'contrato_conferencia_corretor',
            'contrato_ok_corretor', 'aguardando_assinatura'
          ) then 'futura'
          -- "confirmada" agora se divide por modalidade: 'contrato' = contrato assinado de verdade
          -- (padrão, e qualquer modalidade futura que não seja 'lancamento'); 'lancamento' = enviado
          -- direto ao financeiro sem contrato. Não faço isso condicional a um IN de modalidades
          -- porque só existem essas 2 hoje (CHECK sales_modalidade_check) -- se um 3º valor for
          -- adicionado, o objetivo é decidir explicitamente pra qual balde ele vai, não herdar
          -- "contrato" por omissão silenciosa.
          when ut.para::text in (
            'contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
            'ocorrencia_devolvida_gestor', 'ocorrencia_concluida'
          ) and s.modalidade = 'lancamento' then 'confirmada_lancamento'
          when ut.para::text in (
            'contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
            'ocorrencia_devolvida_gestor', 'ocorrencia_concluida'
          ) then 'confirmada_contrato'
          when ut.para::text in ('cancelada', 'arquivada') then 'encerrada'
        end as grupo
      from ultima_transicao_periodo ut
      join sales s on s.id = ut.sale_id
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
      'futuras_quantidade', (select count(*) from movimentadas where grupo = 'futura'),
      'futuras_vgv', coalesce((select sum(valor_negociado) from movimentadas where grupo = 'futura'), 0),
      'confirmadas_contrato_quantidade', (select count(*) from movimentadas where grupo = 'confirmada_contrato'),
      'confirmadas_contrato_vgv', coalesce((select sum(valor_negociado) from movimentadas where grupo = 'confirmada_contrato'), 0),
      'confirmadas_lancamento_quantidade', (select count(*) from movimentadas where grupo = 'confirmada_lancamento'),
      'confirmadas_lancamento_vgv', coalesce((select sum(valor_negociado) from movimentadas where grupo = 'confirmada_lancamento'), 0),
      'encerradas_quantidade', (select count(*) from movimentadas where grupo = 'encerrada'),
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
