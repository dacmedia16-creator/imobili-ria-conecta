-- Script DESCARTÁVEL, só para o Supabase local (Docker via `supabase start`). Demonstra o efeito
-- da correção 20260819010000: reproduz o cenário exato do bug reportado (venda avança de grupo
-- pra grupo dentro do mesmo período e era contada em cada balde) e compara a query ANTIGA (marco
-- por grupo, colada aqui como referência histórica) com a função NOVA já instalada no banco.

DO $$
DECLARE
  v_corretor uuid := '35963fd4-2195-4b29-aadf-501458d5a3c1';
  v_a uuid; v_b uuid; v_c uuid;
BEGIN
  DELETE FROM public.sales WHERE corretor_id = v_corretor AND codigo_interno LIKE 'ANTES-DEPOIS-%';

  -- A: entra em futura e avança pra confirmada, tudo dentro do período de teste (jan/2020)
  INSERT INTO public.sales (corretor_id, status, valor_negociado, codigo_interno)
  VALUES (v_corretor, 'contrato_assinado', 500000, 'ANTES-DEPOIS-A') RETURNING id INTO v_a;
  INSERT INTO public.sale_status_history (sale_id, para, created_at) VALUES
    (v_a, 'enviada_revisao', '2020-01-02T00:00:00Z'),
    (v_a, 'contrato_assinado', '2020-01-10T00:00:00Z');

  -- B: confirmada e depois cancelada, tudo dentro do período
  INSERT INTO public.sales (corretor_id, status, valor_negociado, codigo_interno)
  VALUES (v_corretor, 'cancelada', 700000, 'ANTES-DEPOIS-B') RETURNING id INTO v_b;
  INSERT INTO public.sale_status_history (sale_id, para, created_at) VALUES
    (v_b, 'contrato_assinado', '2020-01-01T00:00:00Z'),
    (v_b, 'cancelada', '2020-01-15T00:00:00Z');

  -- C: só entra em futura, fica lá (sem avançar) dentro do período
  INSERT INTO public.sales (corretor_id, status, valor_negociado, codigo_interno)
  VALUES (v_corretor, 'enviada_revisao', 300000, 'ANTES-DEPOIS-C') RETURNING id INTO v_c;
  INSERT INTO public.sale_status_history (sale_id, para, created_at) VALUES
    (v_c, 'enviada_revisao', '2020-01-05T00:00:00Z');
END $$;

-- ===== ANTES (lógica antiga: marco = 1ª transição pra QUALQUER status do grupo, dentro do
-- período — permite a mesma venda contar em 2 grupos) =====
WITH marco_futura AS (
  SELECT sale_id, min(created_at) AS em FROM sale_status_history
  WHERE para::text IN ('enviada_revisao','devolvida_ajuste','aprovada_gestor','enviada_juridico',
    'em_elaboracao_contrato','contrato_conferencia_gestor','contrato_conferencia_corretor',
    'contrato_ok_corretor','aguardando_assinatura')
  GROUP BY sale_id
),
marco_confirmada AS (
  SELECT sale_id, min(created_at) AS em FROM sale_status_history
  WHERE para::text IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro',
    'ocorrencia_devolvida_gestor','ocorrencia_concluida')
  GROUP BY sale_id
),
marco_encerrada AS (
  SELECT sale_id, min(created_at) AS em FROM sale_status_history
  WHERE para::text IN ('cancelada','arquivada') GROUP BY sale_id
)
SELECT
  'ANTES (buggy)' AS versao,
  (SELECT count(*) FROM sales s JOIN marco_futura mf ON mf.sale_id = s.id
    WHERE s.codigo_interno LIKE 'ANTES-DEPOIS-%' AND mf.em >= '2020-01-01' AND mf.em < '2020-02-01') AS futuras_qtd,
  (SELECT count(*) FROM sales s JOIN marco_confirmada mc ON mc.sale_id = s.id
    WHERE s.codigo_interno LIKE 'ANTES-DEPOIS-%' AND mc.em >= '2020-01-01' AND mc.em < '2020-02-01') AS confirmadas_qtd,
  (SELECT count(*) FROM sales s JOIN marco_encerrada me ON me.sale_id = s.id
    WHERE s.codigo_interno LIKE 'ANTES-DEPOIS-%' AND me.em >= '2020-01-01' AND me.em < '2020-02-01') AS encerradas_qtd;

-- ===== DEPOIS (função já instalada no banco, com a correção) =====
SELECT
  'DEPOIS (corrigido)' AS versao,
  r.futuras_quantidade, r.confirmadas_quantidade, r.encerradas_quantidade
FROM (
  SELECT
    (jsonb_extract_path(public.dashboard_movimentacao_periodo('2020-01-01T00:00:00Z','2020-02-01T00:00:00Z'), 'futuras_quantidade'))::int AS futuras_quantidade,
    (jsonb_extract_path(public.dashboard_movimentacao_periodo('2020-01-01T00:00:00Z','2020-02-01T00:00:00Z'), 'confirmadas_quantidade'))::int AS confirmadas_quantidade,
    (jsonb_extract_path(public.dashboard_movimentacao_periodo('2020-01-01T00:00:00Z','2020-02-01T00:00:00Z'), 'encerradas_quantidade'))::int AS encerradas_quantidade
) r;

-- ===== Prova direta de "cada venda em exatamente 1 grupo" na versão corrigida =====
WITH ultima_transicao AS (
  SELECT DISTINCT ON (sale_id) sale_id, para
  FROM sale_status_history
  WHERE created_at >= '2020-01-01' AND created_at < '2020-02-01'
    AND sale_id IN (SELECT id FROM sales WHERE codigo_interno LIKE 'ANTES-DEPOIS-%')
  ORDER BY sale_id, created_at DESC
)
SELECT s.codigo_interno, ut.para AS status_mais_recente_no_periodo,
  CASE
    WHEN ut.para::text IN ('enviada_revisao','devolvida_ajuste','aprovada_gestor','enviada_juridico',
      'em_elaboracao_contrato','contrato_conferencia_gestor','contrato_conferencia_corretor',
      'contrato_ok_corretor','aguardando_assinatura') THEN 'futura'
    WHEN ut.para::text IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro',
      'ocorrencia_devolvida_gestor','ocorrencia_concluida') THEN 'confirmada'
    WHEN ut.para::text IN ('cancelada','arquivada') THEN 'encerrada'
  END AS grupo_unico
FROM ultima_transicao ut JOIN sales s ON s.id = ut.sale_id
WHERE s.codigo_interno LIKE 'ANTES-DEPOIS-%'
ORDER BY s.codigo_interno;
