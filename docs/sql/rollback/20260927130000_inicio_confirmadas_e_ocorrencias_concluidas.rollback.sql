-- Rollback do grupo 2: definições implantadas antes (pg_get_functiondef em 27/09/2026).

-- args: _inicio timestamp with time zone, _fim timestamp with time zone
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

-- args: 
CREATE OR REPLACE FUNCTION public.relatorio_ocorrencias_concluidas()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  resultado jsonb;
BEGIN
  IF caller_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = caller_id AND p.ativo IS TRUE
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = caller_id
        AND ur.role = ANY (ARRAY[
          'corretor', 'gestor', 'team_leader', 'financeiro',
          'admin', 'super_admin', 'juridico', 'lancamento'
        ]::public.app_role[])
    )
  THEN
    RAISE EXCEPTION 'Acesso não autorizado ao relatório de ocorrências concluídas'
      USING ERRCODE = '42501';
  END IF;

  WITH concluidas AS MATERIALIZED (
    SELECT o.id, o.sale_id, o.valor_comissao, o.data_assinatura
    FROM public.occurrences o
    WHERE o.status = 'concluida'
  ), participantes AS MATERIALIZED (
    -- Uma ocorrência pode citar corretores diferentes do responsável pela venda.
    -- DISTINCT por ocorrência/pessoa evita duplicar o mesmo filtro quando a pessoa
    -- recebe por mais de um papel ou lado da operação.
    SELECT oc.occurrence_id, oc.user_id, max(oc.nome) AS nome
    FROM public.occurrence_commissions oc
    WHERE oc.user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM concluidas o WHERE o.id = oc.occurrence_id)
    GROUP BY oc.occurrence_id, oc.user_id
  ), vendas AS MATERIALIZED (
    SELECT s.id, s.codigo_interno, s.imovel_id, s.corretor_id
    FROM public.sales s
    WHERE EXISTS (SELECT 1 FROM concluidas o WHERE o.sale_id = s.id)
  ), pessoas AS (
    -- Roster atual canônico + nomes históricos, inclusive de pessoas inativas.
    -- EXISTS evita duplicação por múltiplos papéis, vínculos, vendas ou comissões.
    SELECT p.id, p.nome
    FROM public.profiles p
    WHERE EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id
        AND ur.role = ANY (ARRAY[
          'corretor', 'gestor', 'team_leader', 'lancamento'
        ]::public.app_role[])
    )
    OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.membro_id = p.id)
    OR EXISTS (SELECT 1 FROM public.teams t WHERE t.lider_id = p.id)
    OR EXISTS (SELECT 1 FROM public.team_co_leaders cl WHERE cl.user_id = p.id)
    OR EXISTS (SELECT 1 FROM vendas s WHERE s.corretor_id = p.id)
    OR EXISTS (SELECT 1 FROM participantes pc WHERE pc.user_id = p.id)
  ), equipes AS (
    SELECT t.id, t.nome, t.parent_team_id, t.lider_id FROM public.teams t
  ), membros AS (
    SELECT DISTINCT tm.membro_id, tm.team_id FROM public.team_members tm
  ), auxiliares AS (
    SELECT DISTINCT cl.user_id, cl.team_id FROM public.team_co_leaders cl
  )
  SELECT pg_catalog.jsonb_build_object(
    'occs', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) ORDER BY o.id) FROM concluidas o), '[]'::jsonb),
    'sales', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) ORDER BY s.id) FROM vendas s), '[]'::jsonb),
    'participants', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(pc) ORDER BY pc.occurrence_id, pc.user_id) FROM participantes pc), '[]'::jsonb),
    'profiles', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.id) FROM pessoas p), '[]'::jsonb),
    'teams', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.id) FROM equipes t), '[]'::jsonb),
    'members', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(tm) ORDER BY tm.membro_id, tm.team_id) FROM membros tm), '[]'::jsonb),
    'coLeaders', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(cl) ORDER BY cl.user_id, cl.team_id) FROM auxiliares cl), '[]'::jsonb)
  ) INTO resultado;

  RETURN resultado;
END;
$function$
;
