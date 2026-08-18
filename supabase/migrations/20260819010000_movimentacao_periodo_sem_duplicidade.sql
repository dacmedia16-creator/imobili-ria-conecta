-- Corrige dashboard_movimentacao_periodo() (criada em 20260817000000): a versão anterior contava
-- MARCOS por grupo (1ª transição de cada venda pra QUALQUER status daquele grupo, em qualquer
-- momento do histórico, filtrado só pela data desse marco) — isso deixava a mesma venda contada em
-- "futuras" E em "confirmadas" no mesmo período sempre que ela avançasse de um grupo pro outro
-- dentro da janela selecionada (2 marcos, 2 baldes, mesma venda). Reportado como bug de duplicidade
-- pelo usuário depois de ver "30 entraram como futuras" > "23 vendas futuras" na Situação atual.
--
-- Nova regra: cada venda é contada em EXATAMENTE UM balde por período — o grupo de negócio do seu
-- status MAIS RECENTE (última linha de sale_status_history) dentro da janela [_inicio, _fim). Se
-- ela entrou em futura e depois avançou pra confirmada no mesmo período, conta só em confirmada. Se
-- foi encerrada depois de confirmada, conta só em encerrada. `DISTINCT ON (sale_id) ... ORDER BY
-- created_at DESC` garante 1 linha por venda (a transição mais recente dentro do período).
--
-- sem_data_* (sinal de qualidade de dado, independente do período) NÃO muda nesta correção — ainda
-- usa os marcos de 1ª entrada em cada grupo, em qualquer momento do histórico, só pra saber se uma
-- venda no grupo atual tem algum registro de entrada nesse grupo. Esse número não tem o problema de
-- duplicidade reportado (não soma quantidade/VGV, é sempre um count por venda-status-atual).
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
        case
          when ut.para::text in (
            'enviada_revisao', 'devolvida_ajuste', 'aprovada_gestor', 'enviada_juridico',
            'em_elaboracao_contrato', 'contrato_conferencia_gestor', 'contrato_conferencia_corretor',
            'contrato_ok_corretor', 'aguardando_assinatura'
          ) then 'futura'
          when ut.para::text in (
            'contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
            'ocorrencia_devolvida_gestor', 'ocorrencia_concluida'
          ) then 'confirmada'
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
      'confirmadas_quantidade', (select count(*) from movimentadas where grupo = 'confirmada'),
      'confirmadas_vgv', coalesce((select sum(valor_negociado) from movimentadas where grupo = 'confirmada'), 0),
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
