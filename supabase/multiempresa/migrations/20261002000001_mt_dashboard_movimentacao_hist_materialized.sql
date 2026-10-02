-- Versiona dashboard_movimentacao_periodo otimizada, já aplicada em produção em 02/10/2026.
-- Mudança: sale_status_history é lida UMA vez numa CTE "hist as materialized", reutilizada pelos
-- marcos e pela última transição do período (antes eram 4 varreduras). Regra e resultado inalterados.
-- Idempotente (CREATE OR REPLACE). md5(pg_get_functiondef) esperado: b9a06e0eeff9ca5c3f8b34ea3fd9bc8d.
-- Rollback: .down.sql (definição anterior, sem a CTE materializada).
BEGIN;

CREATE OR REPLACE FUNCTION public.dashboard_movimentacao_periodo(_inicio timestamp with time zone, _fim timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if _inicio is null or _fim is null then
    raise exception 'dashboard_movimentacao_periodo: _inicio e _fim sao obrigatorios (nao podem ser nulos).';
  end if;
  if _fim <= _inicio then
    raise exception 'dashboard_movimentacao_periodo: _fim (%) deve ser maior que _inicio (%).', _fim, _inicio;
  end if;

  return (
    with hist as materialized (
      select sale_id, para, created_at from sale_status_history
    ),
    marco_futura as (
      select sale_id, min(created_at) as em
      from hist
      where para::text in (
        'enviada_revisao', 'devolvida_ajuste', 'aprovada_gestor', 'enviada_juridico',
        'em_elaboracao_contrato', 'contrato_conferencia_gestor', 'contrato_conferencia_corretor',
        'contrato_ok_corretor', 'aguardando_assinatura'
      )
      group by sale_id
    ),
    marco_confirmada as (
      select sale_id, min(created_at) as em
      from hist
      where para::text in (
        'contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
        'ocorrencia_devolvida_gestor', 'ocorrencia_concluida'
      )
      group by sale_id
    ),
    marco_encerrada as (
      select sale_id, min(created_at) as em
      from hist
      where para::text in ('cancelada', 'arquivada')
      group by sale_id
    ),
    ultima_transicao_periodo as (
      select distinct on (sale_id) sale_id, para
      from hist
      where created_at >= _inicio and created_at < _fim
      order by sale_id, created_at desc
    ),
    assinadas_periodo as (
      select v.sale_id
      from public.vendas_comerciais_validas() v
      where v.venda_em >= _inicio and v.venda_em < _fim
    ),
    movimentadas as (
      -- confirmadas: pela data da assinatura
      select s.id, s.valor_negociado, s.modalidade,
        case when s.modalidade = 'lancamento' then 'confirmada_lancamento' else 'confirmada_contrato' end as grupo
      from assinadas_periodo a
      join sales s on s.id = a.sale_id
      union all
      -- futuras e encerradas: pela última transição do período (regra anterior, inalterada)
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
          when ut.para::text in ('cancelada', 'arquivada') then 'encerrada'
        end as grupo
      from ultima_transicao_periodo ut
      join sales s on s.id = ut.sale_id
      where ut.para::text in (
        'enviada_revisao', 'devolvida_ajuste', 'aprovada_gestor', 'enviada_juridico',
        'em_elaboracao_contrato', 'contrato_conferencia_gestor', 'contrato_conferencia_corretor',
        'contrato_ok_corretor', 'aguardando_assinatura', 'cancelada', 'arquivada'
      )
    ),
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
      'confirmadas_quantidade', (select count(*) from movimentadas where grupo in ('confirmada_contrato', 'confirmada_lancamento')),
      'confirmadas_vgv', coalesce((select sum(valor_negociado) from movimentadas where grupo in ('confirmada_contrato', 'confirmada_lancamento')), 0),
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
$function$

;

-- ACL igual à produção: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.dashboard_movimentacao_periodo(timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_movimentacao_periodo(timestamp with time zone, timestamp with time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.dashboard_movimentacao_periodo(timestamp with time zone, timestamp with time zone) TO authenticated, service_role, mt_1b_definer;

COMMIT;
