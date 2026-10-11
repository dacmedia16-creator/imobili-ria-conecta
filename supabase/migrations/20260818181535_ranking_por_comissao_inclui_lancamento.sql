-- Pedido do usuário: ranking de corretores e equipes ORDENADO POR COMISSÃO (não mais por vendas
-- fechadas), incluindo vendas de Lançamento. Baseado em
-- 20260809140000_visao_executiva_stats_restaura_sem_equipe.sql (versão anterior em produção), com
-- 2 mudanças:
--
-- 1) fechadas_30d passa a considerar "fechada" = 1ª entrada no grupo de negócio CONFIRMADA (mesma
--    classificação usada em dashboard.tsx/status.ts e na correção da Movimentação do período), não
--    só o status técnico 'contrato_assinado'. Isso inclui Lançamento, que nunca passa por
--    contrato_assinado (vai direto de rascunho pra ocorrencia_analise_financeiro) — antes desta
--    correção o ranking (por corretor e por equipe) e o resumo_operacional excluíam 100% das vendas
--    de Lançamento porque dependiam dessa CTE. Efeito colateral desejado: resumo_operacional
--    (VGV/comissão bruta/receita líquida) passa a incluir Lançamento também — mesma "venda fechada",
--    mesma janela de 30 dias, consistência entre os dois blocos que já compartilhavam essa CTE.
--
-- 2) ranking_corretor e ranking_equipe agora ordenam por comissao DESC (antes: vendas_fechadas
--    DESC, comissao só como desempate) — o ranking em si já sai do banco na ordem certa; o
--    RankingTable (visao-executiva.tsx) também foi atualizado pra ordenar por comissão no cliente,
--    espelhando esta mudança. Nenhuma outra lógica de agregação muda — ranking_corretor/equipe
--    continuam somando por occurrence_commissions.user_id (cada pessoa só pela fatia dela).
create or replace function public.visao_executiva_stats()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
WITH stage_map(status, stage) AS (
  VALUES
    ('rascunho','inicio'), ('devolvida_ajuste','inicio'), ('ocorrencia_devolvida_gestor','inicio'),
    ('enviada_revisao','aprovacao'), ('aprovada_gestor','aprovacao'),
    ('enviada_juridico','juridico'), ('em_elaboracao_contrato','juridico'), ('contrato_conferencia_gestor','juridico'),
    ('contrato_conferencia_corretor','juridico'), ('contrato_ok_corretor','juridico'), ('aguardando_assinatura','juridico'),
    ('contrato_assinado','concluida'), ('ocorrencia_pendente','concluida'), ('ocorrencia_analise_financeiro','concluida'), ('ocorrencia_concluida','concluida'),
    ('cancelada','encerrada'), ('arquivada','encerrada')
),
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
-- ALTERADO: "fechada" = 1ª transição pra QUALQUER status do grupo confirmada (contrato_assinado OU
-- qualquer ocorrencia_*), não só contrato_assinado. Inclui Lançamento (entra direto em
-- ocorrencia_analise_financeiro).
fechadas_30d AS (
  SELECT DISTINCT ON (sale_id) sale_id, created_at AS fechado_em
  FROM sale_status_history
  WHERE para::text IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida')
  ORDER BY sale_id, created_at ASC
),
vendas_periodo AS (
  SELECT f.sale_id, f.fechado_em, s.created_at AS sale_created_at, s.valor_negociado
  FROM fechadas_30d f
  JOIN sales s ON s.id = f.sale_id
  WHERE f.fechado_em >= now() - interval '30 days'
    AND s.status::text NOT IN ('cancelada','arquivada')
),
tempo_por_venda AS (
  SELECT sale_id, extract(epoch FROM (fechado_em - sale_created_at)) / 86400.0 AS dias FROM vendas_periodo
),
devolucoes_por_venda AS (
  SELECT sale_id, count(*) AS n
  FROM sale_status_history
  WHERE para::text IN ('devolvida_ajuste','ocorrencia_devolvida_gestor')
  GROUP BY sale_id
),
participante_venda AS (
  SELECT
    oc.user_id,
    vp.sale_id,
    sum(oc.valor) AS valor_na_venda,
    max(tpv.dias) AS dias,
    bool_or(COALESCE(dv.n, 0) > 0) AS teve_devolucao
  FROM occurrence_commissions oc
  JOIN occurrences o ON o.id = oc.occurrence_id
  JOIN vendas_periodo vp ON vp.sale_id = o.sale_id
  LEFT JOIN tempo_por_venda tpv ON tpv.sale_id = vp.sale_id
  LEFT JOIN devolucoes_por_venda dv ON dv.sale_id = vp.sale_id
  WHERE oc.user_id IS NOT NULL
  GROUP BY oc.user_id, vp.sale_id
),
ranking_corretor_base AS (
  SELECT
    user_id AS corretor_id,
    count(*) AS vendas_fechadas,
    avg(dias) AS tempo_medio_dias_raw,
    count(*) FILTER (WHERE teve_devolucao) AS vendas_com_devolucao,
    sum(valor_na_venda) AS comissao
  FROM participante_venda
  GROUP BY user_id
),
ranking_corretor_full AS (
  SELECT rcb.*, tm.team_id
  FROM ranking_corretor_base rcb
  LEFT JOIN team_members tm ON tm.membro_id = rcb.corretor_id
),
ranking_corretor AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'corretor_id', corretor_id,
    'vendas_fechadas', vendas_fechadas,
    'tempo_medio_dias', round(tempo_medio_dias_raw::numeric, 1),
    'taxa_devolucao', round((100.0 * vendas_com_devolucao / NULLIF(vendas_fechadas,0))::numeric, 0),
    'comissao', comissao
  ) ORDER BY comissao DESC, vendas_fechadas DESC), '[]'::jsonb) AS j
  FROM ranking_corretor_full
),
equipe_vendas_distintas AS (
  SELECT DISTINCT tm.team_id, pv.sale_id, pv.teve_devolucao
  FROM participante_venda pv
  LEFT JOIN team_members tm ON tm.membro_id = pv.user_id
),
ranking_equipe_vendas AS (
  SELECT team_id,
    count(*) AS vendas_fechadas,
    count(*) FILTER (WHERE teve_devolucao) AS vendas_com_devolucao
  FROM equipe_vendas_distintas
  GROUP BY team_id
),
ranking_equipe_base AS (
  SELECT rev.team_id, rev.vendas_fechadas, rev.vendas_com_devolucao,
    COALESCE((SELECT sum(rcf.comissao) FROM ranking_corretor_full rcf WHERE rcf.team_id IS NOT DISTINCT FROM rev.team_id), 0) AS comissao
  FROM ranking_equipe_vendas rev
),
ranking_equipe AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', reb.team_id,
    'team_nome', t.nome,
    'vendas_fechadas', reb.vendas_fechadas,
    'comissao', reb.comissao,
    'taxa_devolucao', round((100.0 * reb.vendas_com_devolucao / NULLIF(reb.vendas_fechadas,0))::numeric, 0)
  ) ORDER BY reb.comissao DESC, reb.vendas_fechadas DESC), '[]'::jsonb) AS j
  FROM ranking_equipe_base reb
  LEFT JOIN teams t ON t.id = reb.team_id
),
resumo_operacional AS (
  SELECT
    COALESCE(sum(vp.valor_negociado), 0) AS vgv,
    COALESCE(sum((dist.d->>'comissao_bruta')::numeric), 0) AS comissao_bruta_operacao,
    COALESCE(sum((dist.d->>'parceria_externa')::numeric), 0) AS parceria_externa,
    COALESCE(sum((dist.d->>'saldo_inicial_imobiliaria')::numeric), 0) AS parte_unidade,
    COALESCE(sum((dist.d->>'saldo_liquido_imobiliaria')::numeric), 0) AS receita_liquida_imobiliaria,
    count(DISTINCT vp.sale_id) AS quantidade_vendas
  FROM vendas_periodo vp
  CROSS JOIN LATERAL (SELECT public.calcular_distribuicao_venda(vp.sale_id) AS d) dist
),
captacoes_periodo AS (
  SELECT count(DISTINCT id) AS quantidade_captacoes
  FROM sales
  WHERE created_at >= now() - interval '30 days'
    AND status::text NOT IN ('cancelada','arquivada')
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
      SELECT date_trunc('month', h.created_at) AS mes, count(DISTINCT h.sale_id) AS n
      FROM sale_status_history h
      JOIN sales s ON s.id = h.sale_id
      WHERE h.para::text = 'contrato_assinado' AND s.status::text NOT IN ('cancelada','arquivada')
      GROUP BY 1
    ) vf ON vf.mes = meses.mes
    LEFT JOIN (
      SELECT date_trunc('month', COALESCE(o.data_assinatura, o.created_at::date)) AS mes, sum(o.valor_comissao) AS total
      FROM occurrences o
      JOIN sales s ON s.id = o.sale_id
      WHERE s.status::text NOT IN ('cancelada','arquivada')
      GROUP BY 1
    ) cm ON cm.mes = meses.mes
  ) x
),
whatsapp_saude AS (
  SELECT
    count(*) AS eventos,
    COALESCE(sum((payload->>'enviados')::int), 0) AS enviados,
    COALESCE(sum((payload->>'falhas')::int), 0) AS falhas,
    count(*) FILTER (WHERE (payload->>'falhas')::int > 0) AS eventos_com_falha
  FROM activity_logs
  WHERE acao = 'whatsapp_notification_result' AND created_at >= now() - interval '30 days'
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
  'resumo_operacional', jsonb_build_object(
    'vgv', (SELECT vgv FROM resumo_operacional),
    'comissao_bruta_operacao', (SELECT comissao_bruta_operacao FROM resumo_operacional),
    'parceria_externa', (SELECT parceria_externa FROM resumo_operacional),
    'parte_unidade', (SELECT parte_unidade FROM resumo_operacional),
    'receita_liquida_imobiliaria', (SELECT receita_liquida_imobiliaria FROM resumo_operacional),
    'quantidade_vendas', (SELECT quantidade_vendas FROM resumo_operacional),
    'quantidade_captacoes', (SELECT quantidade_captacoes FROM captacoes_periodo)
  ),
  'evolucao_mensal', (SELECT j FROM evolucao_mensal),
  'whatsapp', CASE WHEN has_any_role(auth.uid(), ARRAY['super_admin']::app_role[]) THEN
    (SELECT jsonb_build_object('eventos', eventos, 'enviados', enviados, 'falhas', falhas, 'eventos_com_falha', eventos_com_falha) FROM whatsapp_saude)
  ELSE NULL END
);
$function$;
