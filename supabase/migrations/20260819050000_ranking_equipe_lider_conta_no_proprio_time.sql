-- Pedido do usuário: a linha "Sem equipe" do ranking por equipe estava inflada porque agregava
-- VÁRIAS pessoas sem nenhuma relação entre si numa única linha (14 vendas, R$60.689,26 em produção,
-- somando 8 corretores diferentes). Causa raiz: todo líder de equipe NÃO é membro da própria equipe
-- em team_members (confirmado: 100% dos líderes em produção), então as vendas pessoais dele (como
-- corretor) nunca contavam pro time que ele lidera — caíam em "sem equipe" junto com quem realmente
-- não tem equipe nenhuma.
--
-- Correção: a "unidade" de uma pessoa passa a ser, nesta ordem —
--   1) o team_id onde ela é membro explícito (team_members), se houver;
--   2) senão, o id do time que ela lidera (teams.lider_id = ela), se houver;
--   3) senão, null (sem equipe de verdade).
-- Resultado: cada linha do ranking por equipe volta a representar uma unidade real (time completo,
-- incluindo o líder, ou uma pessoa genuinamente sem vínculo) — sem duplicar ninguém. O total geral
-- não muda, é só redistribuição (validado em produção: R$113.722,13 antes e depois).
--
-- Aplica a mesma correção nas duas RPCs que precisam concordar sobre "de qual equipe é cada um":
-- visao_executiva_stats() (o ranking em si) e visao_executiva_detalhe_comissao() (o drill-down do
-- ranking, adicionado em 20260819040000) — senão o clique no nome mostraria um conjunto de vendas
-- diferente do que a soma da linha sugere.

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
-- NOVO: "unidade" de cada pessoa que apareceu em alguma venda do período — time onde é membro
-- explícito, senão o time que ela lidera, senão nenhum (sem equipe de verdade).
corretor_unidade AS (
  SELECT p.corretor_id, COALESCE(tm.team_id, tl.id) AS team_id
  FROM (SELECT DISTINCT user_id AS corretor_id FROM participante_venda) p
  LEFT JOIN team_members tm ON tm.membro_id = p.corretor_id
  LEFT JOIN teams tl ON tl.lider_id = p.corretor_id
),
ranking_corretor_full AS (
  SELECT rcb.*, cu.team_id
  FROM ranking_corretor_base rcb
  LEFT JOIN corretor_unidade cu ON cu.corretor_id = rcb.corretor_id
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
  SELECT DISTINCT cu.team_id, pv.sale_id, pv.teve_devolucao
  FROM participante_venda pv
  LEFT JOIN corretor_unidade cu ON cu.corretor_id = pv.user_id
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

-- Espelha a mesma resolução de "unidade" no drill-down (senão o clique numa linha do ranking por
-- equipe mostraria um conjunto de vendas diferente da soma que a linha exibe).
create or replace function public.visao_executiva_detalhe_comissao(
  _corretor_id uuid default null,
  _team_id uuid default null,
  _sem_equipe boolean default false
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with fechadas_30d as (
    select distinct on (sale_id) sale_id, created_at as fechado_em
    from sale_status_history
    where para::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida')
    order by sale_id, created_at asc
  ),
  vendas_periodo as (
    select f.sale_id, f.fechado_em
    from fechadas_30d f
    join sales s on s.id = f.sale_id
    where f.fechado_em >= now() - interval '30 days'
      and s.status::text not in ('cancelada','arquivada')
  ),
  participantes as (
    select oc.user_id as corretor_id, vp.sale_id, sum(oc.valor) as valor_comissao, vp.fechado_em
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join vendas_periodo vp on vp.sale_id = o.sale_id
    where oc.user_id is not null
    group by oc.user_id, vp.sale_id, vp.fechado_em
  ),
  unidade as (
    select p.corretor_id, coalesce(tm.team_id, tl.id) as team_id
    from (select distinct corretor_id from participantes) p
    left join team_members tm on tm.membro_id = p.corretor_id
    left join teams tl on tl.lider_id = p.corretor_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_id', s.id,
    'codigo_interno', s.codigo_interno,
    'imovel_id', s.imovel_id,
    'modalidade', s.modalidade,
    'valor_negociado', s.valor_negociado,
    'valor_comissao', p.valor_comissao,
    'fechado_em', p.fechado_em,
    'corretor_id', p.corretor_id
  ) order by p.valor_comissao desc), '[]'::jsonb)
  from participantes p
  join sales s on s.id = p.sale_id
  left join unidade u on u.corretor_id = p.corretor_id
  where
    (_corretor_id is not null and p.corretor_id = _corretor_id)
    or (_team_id is not null and u.team_id = _team_id)
    or (_sem_equipe and u.team_id is null)
$function$;
