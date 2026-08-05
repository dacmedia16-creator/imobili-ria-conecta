-- RPC pra tela "Visão Executiva" (dashboard gerencial): tempo médio por etapa do funil,
-- alertas de venda parada, ranking de corretor/equipe e evolução mensal. SECURITY INVOKER
-- (sem DEFINER) de propósito, igual dashboard_stats() — roda com o RLS do chamador, então
-- um gestor/team_leader só vê o recorte de sales/team_members que já vê hoje, e só admin/
-- super_admin enxerga a empresa inteira.
CREATE OR REPLACE FUNCTION public.visao_executiva_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH stage_map(status, stage) AS (
  VALUES
    ('rascunho','inicio'), ('devolvida_ajuste','inicio'), ('ocorrencia_devolvida_gestor','inicio'),
    ('enviada_revisao','aprovacao'), ('aprovada_gestor','aprovacao'),
    ('enviada_juridico','juridico'), ('em_elaboracao_contrato','juridico'), ('contrato_conferencia_gestor','juridico'),
    ('contrato_conferencia_corretor','juridico'), ('contrato_ok_corretor','juridico'), ('aguardando_assinatura','juridico'),
    ('contrato_assinado','concluida'), ('ocorrencia_pendente','concluida'), ('ocorrencia_analise_financeiro','concluida'), ('ocorrencia_concluida','concluida'),
    ('cancelada','encerrada'), ('arquivada','encerrada')
),
-- Duração de cada status = tempo até a transição seguinte da mesma venda (ou até agora, se
-- ainda é o status atual). Não existe coluna de "saída do status" — é inferida via LEAD.
historico_90d AS (
  SELECT h.sale_id, h.para,
    COALESCE(LEAD(h.created_at) OVER (PARTITION BY h.sale_id ORDER BY h.created_at), now()) - h.created_at AS duracao
  FROM sale_status_history h
  WHERE h.created_at >= now() - interval '90 days'
),
tempo_etapa AS (
  SELECT COALESCE(jsonb_object_agg(stage, media_dias), '{}'::jsonb) AS j FROM (
    SELECT sm.stage, round((avg(extract(epoch FROM hd.duracao)) / 86400.0)::numeric, 1) AS media_dias
    FROM historico_90d hd JOIN stage_map sm ON sm.status = hd.para::text
    GROUP BY sm.stage
  ) t
),
estado_atual AS (
  SELECT DISTINCT ON (sale_id) sale_id, para AS status_atual, created_at AS desde
  FROM sale_status_history ORDER BY sale_id, created_at DESC
),
alerta_assinatura AS (
  SELECT count(*) AS n, COALESCE(round((extract(epoch FROM max(now() - desde)) / 86400.0)::numeric, 0), 0) AS max_dias
  FROM estado_atual WHERE status_atual::text = 'aguardando_assinatura' AND desde < now() - interval '7 days'
),
alerta_financeiro AS (
  SELECT count(*) AS n, COALESCE(round((extract(epoch FROM max(now() - desde)) / 86400.0)::numeric, 0), 0) AS max_dias
  FROM estado_atual WHERE status_atual::text = 'ocorrencia_analise_financeiro' AND desde < now() - interval '5 days'
),
alerta_contrato AS (
  SELECT count(*) AS n, COALESCE(round((extract(epoch FROM max(now() - desde)) / 86400.0)::numeric, 0), 0) AS max_dias
  FROM estado_atual WHERE status_atual::text IN ('contrato_conferencia_gestor','contrato_conferencia_corretor') AND desde < now() - interval '3 days'
),
alerta_retrabalho AS (
  SELECT count(*) AS n FROM (
    SELECT sale_id FROM sale_status_history
    WHERE para::text IN ('devolvida_ajuste','ocorrencia_devolvida_gestor')
    GROUP BY sale_id HAVING count(*) >= 2
  ) t
),
-- Primeira vez que cada venda entrou em contrato_assinado (evita contar 2x se for reassinada).
fechadas_30d AS (
  SELECT DISTINCT ON (sale_id) sale_id, created_at AS fechado_em
  FROM sale_status_history
  WHERE para::text = 'contrato_assinado'
  ORDER BY sale_id, created_at ASC
),
tempo_fechamento AS (
  SELECT f.sale_id, extract(epoch FROM (f.fechado_em - s.created_at)) / 86400.0 AS dias
  FROM fechadas_30d f JOIN sales s ON s.id = f.sale_id
  WHERE f.fechado_em >= now() - interval '30 days'
),
devolucoes_por_venda AS (
  SELECT sale_id, count(*) AS n
  FROM sale_status_history
  WHERE para::text IN ('devolvida_ajuste','ocorrencia_devolvida_gestor')
  GROUP BY sale_id
),
comissao_30d AS (
  SELECT s.corretor_id, sum(o.valor_comissao) AS total
  FROM occurrences o JOIN sales s ON s.id = o.sale_id
  WHERE COALESCE(o.data_assinatura, o.created_at::date) >= (now() - interval '30 days')::date
  GROUP BY s.corretor_id
),
ranking_corretor_base AS (
  SELECT
    s.corretor_id,
    count(*) AS total_vendas,
    count(*) FILTER (WHERE tf.sale_id IS NOT NULL) AS vendas_fechadas,
    avg(tf.dias) AS tempo_medio_dias_raw,
    count(*) FILTER (WHERE dv.n > 0) AS vendas_com_devolucao
  FROM sales s
  LEFT JOIN tempo_fechamento tf ON tf.sale_id = s.id
  LEFT JOIN devolucoes_por_venda dv ON dv.sale_id = s.id
  WHERE s.updated_at >= now() - interval '30 days'
  GROUP BY s.corretor_id
),
-- Um join por corretor (não por venda) pra comissão e equipe não duplicarem ao somar depois.
ranking_corretor_full AS (
  SELECT rcb.*, COALESCE(cm.total,0) AS comissao, tm.team_id
  FROM ranking_corretor_base rcb
  LEFT JOIN comissao_30d cm ON cm.corretor_id = rcb.corretor_id
  LEFT JOIN team_members tm ON tm.membro_id = rcb.corretor_id
),
ranking_corretor AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'corretor_id', corretor_id,
    'vendas_fechadas', vendas_fechadas,
    'tempo_medio_dias', round(tempo_medio_dias_raw::numeric, 1),
    'taxa_devolucao', round((100.0 * vendas_com_devolucao / NULLIF(total_vendas,0))::numeric, 0),
    'comissao', comissao
  ) ORDER BY vendas_fechadas DESC, comissao DESC), '[]'::jsonb) AS j
  FROM ranking_corretor_full
),
ranking_equipe_base AS (
  SELECT team_id,
    sum(total_vendas) AS total_vendas,
    sum(vendas_fechadas) AS vendas_fechadas,
    sum(vendas_com_devolucao) AS vendas_com_devolucao,
    sum(comissao) AS comissao
  FROM ranking_corretor_full
  GROUP BY team_id
),
ranking_equipe AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', reb.team_id,
    'team_nome', t.nome,
    'vendas_fechadas', reb.vendas_fechadas,
    'comissao', reb.comissao,
    'taxa_devolucao', round((100.0 * reb.vendas_com_devolucao / NULLIF(reb.total_vendas,0))::numeric, 0)
  ) ORDER BY reb.vendas_fechadas DESC, reb.comissao DESC), '[]'::jsonb) AS j
  FROM ranking_equipe_base reb
  LEFT JOIN teams t ON t.id = reb.team_id
),
evolucao_mensal AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'vendas_fechadas', vendas_fechadas, 'comissao', comissao) ORDER BY mes), '[]'::jsonb) AS j
  FROM (
    SELECT
      to_char(meses.mes, 'YYYY-MM') AS mes,
      COALESCE(vf.n, 0) AS vendas_fechadas,
      COALESCE(cm.total, 0) AS comissao
    FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') AS meses(mes)
    LEFT JOIN (
      SELECT date_trunc('month', created_at) AS mes, count(DISTINCT sale_id) AS n
      FROM sale_status_history WHERE para::text = 'contrato_assinado'
      GROUP BY 1
    ) vf ON vf.mes = meses.mes
    LEFT JOIN (
      SELECT date_trunc('month', COALESCE(data_assinatura, created_at::date)) AS mes, sum(valor_comissao) AS total
      FROM occurrences GROUP BY 1
    ) cm ON cm.mes = meses.mes
  ) x
)
SELECT jsonb_build_object(
  'tempo_por_etapa', (SELECT j FROM tempo_etapa),
  'alertas', jsonb_build_object(
    'assinatura_pendente', jsonb_build_object('n', (SELECT n FROM alerta_assinatura), 'max_dias', (SELECT max_dias FROM alerta_assinatura)),
    'financeiro_parado', jsonb_build_object('n', (SELECT n FROM alerta_financeiro), 'max_dias', (SELECT max_dias FROM alerta_financeiro)),
    'contrato_parado', jsonb_build_object('n', (SELECT n FROM alerta_contrato), 'max_dias', (SELECT max_dias FROM alerta_contrato)),
    'retrabalho', jsonb_build_object('n', (SELECT n FROM alerta_retrabalho))
  ),
  'ranking_corretor', (SELECT j FROM ranking_corretor),
  'ranking_equipe', (SELECT j FROM ranking_equipe),
  'evolucao_mensal', (SELECT j FROM evolucao_mensal)
);
$function$;

GRANT EXECUTE ON FUNCTION public.visao_executiva_stats() TO authenticated;
