-- dashboard_stats() somava occ_pendentes_total/occ_concluidas_total/comissao_prevista_total/
-- comissao_concluida_total direto de occurrences, sem join com sales — uma venda cancelada ou
-- arquivada continuava contando nesses totais e no ranking "Comissão por corretor". Mesma falha em
-- metas_progresso(): a CTE comissao_corretor não excluía sales.status cancelada/arquivada, então o
-- progresso de meta de um corretor podia incluir comissão de venda cancelada.
create or replace function public.dashboard_stats()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  SELECT jsonb_build_object(
    'funil', (
      SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) FROM (
        SELECT status::text AS status, count(*) AS cnt FROM sales GROUP BY status
      ) t
    ),
    'minhas_vendas', (SELECT count(*) FROM sales WHERE corretor_id = auth.uid()),
    'minhas_pendencias', (SELECT count(*) FROM sales WHERE corretor_id = auth.uid() AND status::text IN ('rascunho','devolvida_ajuste')),
    'meus_contratos_conferir', (SELECT count(*) FROM sales WHERE corretor_id = auth.uid() AND status::text = 'contrato_conferencia_corretor'),
    'meus_assinados', (SELECT count(*) FROM sales WHERE corretor_id = auth.uid() AND status::text IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida')),
    'minha_comissao_prevista', COALESCE((SELECT sum(valor_total_comissao) FROM sales WHERE corretor_id = auth.uid() AND status::text NOT IN ('ocorrencia_concluida','arquivada','cancelada')), 0),
    'gestor_aguardando_revisao', (SELECT count(*) FROM sales WHERE status::text = 'enviada_revisao'),
    'gestor_contratos_conferir', (SELECT count(*) FROM sales WHERE status::text IN ('contrato_conferencia_gestor','contrato_ok_corretor')),
    'gestor_ocorrencias_enviar', (SELECT count(*) FROM sales WHERE status::text IN ('ocorrencia_pendente','ocorrencia_devolvida_gestor')),
    'gestor_devolvidas', (SELECT count(*) FROM sales WHERE status::text IN ('devolvida_ajuste','ocorrencia_devolvida_gestor')),
    'juridico_aprovadas_gestor', (SELECT count(*) FROM sales WHERE status::text = 'aprovada_gestor'),
    'juridico_em_elaboracao', (SELECT count(*) FROM sales WHERE status::text = 'em_elaboracao_contrato'),
    'juridico_aguardando_assinatura', (SELECT count(*) FROM sales WHERE status::text = 'aguardando_assinatura'),
    'juridico_assinados', (SELECT count(*) FROM sales WHERE status::text = 'contrato_assinado'),
    'fin_ocorrencias_analise', (SELECT count(*) FROM sales WHERE status::text = 'ocorrencia_analise_financeiro'),
    'fin_devolvidas', (SELECT count(*) FROM sales WHERE status::text = 'ocorrencia_devolvida_gestor'),
    'occ_pendentes_total', (SELECT count(*) FROM occurrences o JOIN sales s ON s.id = o.sale_id WHERE o.status <> 'concluida' AND s.status::text NOT IN ('cancelada','arquivada')),
    'occ_concluidas_total', (SELECT count(*) FROM occurrences o JOIN sales s ON s.id = o.sale_id WHERE o.status = 'concluida' AND s.status::text NOT IN ('cancelada','arquivada')),
    'comissao_prevista_total', COALESCE((SELECT sum(o.valor_comissao) FROM occurrences o JOIN sales s ON s.id = o.sale_id WHERE o.status <> 'concluida' AND s.status::text NOT IN ('cancelada','arquivada')), 0),
    'comissao_concluida_total', COALESCE((SELECT sum(o.valor_comissao) FROM occurrences o JOIN sales s ON s.id = o.sale_id WHERE o.status = 'concluida' AND s.status::text NOT IN ('cancelada','arquivada')), 0),
    'comissao_por_corretor', (
      SELECT COALESCE(jsonb_object_agg(corretor_id, total), '{}'::jsonb) FROM (
        SELECT s.corretor_id::text AS corretor_id, sum(o.valor_comissao) AS total
        FROM occurrences o JOIN sales s ON s.id = o.sale_id
        WHERE s.status::text NOT IN ('cancelada','arquivada')
        GROUP BY s.corretor_id
      ) t
    )
  );
$function$;

create or replace function public.metas_progresso(_mes date)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
WITH mes_alvo AS (SELECT date_trunc('month', _mes)::date AS mes),
comissao_corretor AS (
  SELECT s.corretor_id, sum(o.valor_comissao) AS total
  FROM occurrences o
  JOIN sales s ON s.id = o.sale_id
  CROSS JOIN mes_alvo
  WHERE date_trunc('month', COALESCE(o.data_assinatura, o.created_at::date))::date = mes_alvo.mes
    AND s.status::text NOT IN ('cancelada','arquivada')
  GROUP BY s.corretor_id
),
comissao_equipe AS (
  SELECT tm.team_id, sum(cc.total) AS total
  FROM comissao_corretor cc
  JOIN team_members tm ON tm.membro_id = cc.corretor_id
  GROUP BY tm.team_id
)
SELECT jsonb_build_object(
  'corretor', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'corretor_id', m.corretor_id, 'meta_comissao', m.meta_comissao, 'comissao_realizada', COALESCE(cc.total, 0)
    ))
    FROM metas m
    LEFT JOIN comissao_corretor cc ON cc.corretor_id = m.corretor_id
    WHERE m.tipo = 'corretor' AND m.mes = (SELECT mes FROM mes_alvo)
  ), '[]'::jsonb),
  'equipe', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'team_id', m.team_id, 'meta_comissao', m.meta_comissao, 'comissao_realizada', COALESCE(ce.total, 0)
    ))
    FROM metas m
    LEFT JOIN comissao_equipe ce ON ce.team_id = m.team_id
    WHERE m.tipo = 'equipe' AND m.mes = (SELECT mes FROM mes_alvo)
  ), '[]'::jsonb)
);
$function$;
