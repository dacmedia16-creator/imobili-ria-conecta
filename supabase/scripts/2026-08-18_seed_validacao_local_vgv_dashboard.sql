-- Script DESCARTÁVEL, só para o Supabase local (Docker via `supabase start`), NUNCA rodar em
-- produção. Usado para validar a correção da apresentação de VGV no Dashboard
-- (fix/dashboard-vgv-sem-sobreposicao): popula um conjunto controlado de vendas cobrindo os 4
-- grupos de negócio (preparação / futura / confirmada / encerrada), em Venda Normal e em
-- Lançamento (que pula contrato_assinado), para reconciliar quantidade e VGV por grupo.
--
-- Pré-requisito: já ter criado os 2 usuários de teste via Admin API do GoTrue local
-- (corretor.teste.vgv@local.test e financeiro.teste.vgv@local.test) e atribuído os papéis
-- corretor/financeiro/admin em user_roles — feito manualmente nesta sessão de validação, não
-- incluído aqui porque exige a Admin API (fora do alcance de SQL puro).

DO $$
DECLARE
  v_corretor uuid := '8679db29-628b-407e-b17e-d6592c478d24';
BEGIN
  -- Limpa qualquer execução anterior deste script (idempotente)
  DELETE FROM public.sales WHERE corretor_id = v_corretor AND codigo_interno LIKE 'VALIDACAO-VGV-%';

  -- ===== Venda Normal (modalidade = 'padrao') =====
  INSERT INTO public.sales (corretor_id, status, modalidade, valor_negociado, codigo_interno) VALUES
    (v_corretor, 'rascunho',                     'padrao', 100000, 'VALIDACAO-VGV-N-PREPARACAO-1'),
    (v_corretor, 'enviada_revisao',               'padrao', 200000, 'VALIDACAO-VGV-N-FUTURA-1'),
    (v_corretor, 'aguardando_assinatura',         'padrao', 150000, 'VALIDACAO-VGV-N-FUTURA-2'),
    (v_corretor, 'contrato_assinado',             'padrao', 500000, 'VALIDACAO-VGV-N-CONFIRMADA-1'),
    (v_corretor, 'ocorrencia_concluida',          'padrao', 300000, 'VALIDACAO-VGV-N-CONFIRMADA-2'),
    (v_corretor, 'cancelada',                     'padrao',  90000, 'VALIDACAO-VGV-N-ENCERRADA-1'),
    (v_corretor, 'arquivada',                     'padrao',  80000, 'VALIDACAO-VGV-N-ENCERRADA-2');

  -- ===== Lançamento (modalidade = 'lancamento') — fluxo pula contrato_assinado =====
  INSERT INTO public.sales (corretor_id, status, modalidade, valor_negociado, codigo_interno) VALUES
    (v_corretor, 'rascunho',                       'lancamento', 120000, 'VALIDACAO-VGV-L-PREPARACAO-1'),
    (v_corretor, 'ocorrencia_analise_financeiro',   'lancamento', 350000, 'VALIDACAO-VGV-L-CONFIRMADA-1'),
    (v_corretor, 'ocorrencia_concluida',            'lancamento', 275000, 'VALIDACAO-VGV-L-CONFIRMADA-2');
END $$;

-- ===== Reconciliação: reproduz classificarGrupoVenda (src/lib/status.ts) em SQL =====
WITH classificado AS (
  SELECT
    id, status, modalidade, valor_negociado,
    CASE
      WHEN status = 'rascunho' THEN 'preparacao'
      WHEN status IN ('enviada_revisao','devolvida_ajuste','aprovada_gestor','enviada_juridico',
                       'em_elaboracao_contrato','contrato_conferencia_gestor',
                       'contrato_conferencia_corretor','contrato_ok_corretor','aguardando_assinatura')
        THEN 'futura'
      WHEN status IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro',
                       'ocorrencia_devolvida_gestor','ocorrencia_concluida')
        THEN 'confirmada'
      WHEN status IN ('cancelada','arquivada') THEN 'encerrada'
    END AS grupo
  FROM public.sales
  WHERE codigo_interno LIKE 'VALIDACAO-VGV-%'
)
SELECT '1) IDs, status e valor por grupo' AS etapa, id, status, modalidade, valor_negociado, grupo
FROM classificado ORDER BY grupo, modalidade, id;

WITH classificado AS (
  SELECT id, status, modalidade, valor_negociado,
    CASE
      WHEN status = 'rascunho' THEN 'preparacao'
      WHEN status IN ('enviada_revisao','devolvida_ajuste','aprovada_gestor','enviada_juridico',
                       'em_elaboracao_contrato','contrato_conferencia_gestor',
                       'contrato_conferencia_corretor','contrato_ok_corretor','aguardando_assinatura')
        THEN 'futura'
      WHEN status IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro',
                       'ocorrencia_devolvida_gestor','ocorrencia_concluida')
        THEN 'confirmada'
      WHEN status IN ('cancelada','arquivada') THEN 'encerrada'
    END AS grupo
  FROM public.sales WHERE codigo_interno LIKE 'VALIDACAO-VGV-%'
)
SELECT '2) quantidade e VGV por grupo' AS etapa, grupo,
  count(*) AS quantidade, sum(valor_negociado) AS vgv
FROM classificado GROUP BY grupo ORDER BY grupo;

-- 3) Confirma que nenhum ID aparece em mais de um grupo (cada linha do CASE é mutuamente
-- exclusiva por construção — esta query prova isso contando quantos grupos cada ID poderia
-- satisfazer simultaneamente; deve ser sempre 1).
WITH classificado AS (
  SELECT id,
    (CASE WHEN status = 'rascunho' THEN 1 ELSE 0 END) +
    (CASE WHEN status IN ('enviada_revisao','devolvida_ajuste','aprovada_gestor','enviada_juridico',
                           'em_elaboracao_contrato','contrato_conferencia_gestor',
                           'contrato_conferencia_corretor','contrato_ok_corretor','aguardando_assinatura')
          THEN 1 ELSE 0 END) +
    (CASE WHEN status IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro',
                           'ocorrencia_devolvida_gestor','ocorrencia_concluida') THEN 1 ELSE 0 END) +
    (CASE WHEN status IN ('cancelada','arquivada') THEN 1 ELSE 0 END) AS grupos_simultaneos
  FROM public.sales WHERE codigo_interno LIKE 'VALIDACAO-VGV-%'
)
SELECT '3) IDs com mais de 1 grupo simultâneo (esperado: 0 linhas)' AS etapa, id, grupos_simultaneos
FROM classificado WHERE grupos_simultaneos <> 1;

-- 4) VGV ativo total = VGV em andamento (futura) + VGV confirmado — sem duplicidade
WITH classificado AS (
  SELECT status, valor_negociado,
    CASE
      WHEN status = 'rascunho' THEN 'preparacao'
      WHEN status IN ('enviada_revisao','devolvida_ajuste','aprovada_gestor','enviada_juridico',
                       'em_elaboracao_contrato','contrato_conferencia_gestor',
                       'contrato_conferencia_corretor','contrato_ok_corretor','aguardando_assinatura')
        THEN 'futura'
      WHEN status IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro',
                       'ocorrencia_devolvida_gestor','ocorrencia_concluida')
        THEN 'confirmada'
      WHEN status IN ('cancelada','arquivada') THEN 'encerrada'
    END AS grupo
  FROM public.sales WHERE codigo_interno LIKE 'VALIDACAO-VGV-%'
)
SELECT
  '4) conferência aritmética' AS etapa,
  sum(valor_negociado) FILTER (WHERE grupo = 'futura') AS vgv_em_andamento,
  sum(valor_negociado) FILTER (WHERE grupo = 'confirmada') AS vgv_confirmado,
  sum(valor_negociado) FILTER (WHERE grupo IN ('futura','confirmada')) AS vgv_ativo_total_direto,
  (COALESCE(sum(valor_negociado) FILTER (WHERE grupo = 'futura'), 0)
   + COALESCE(sum(valor_negociado) FILTER (WHERE grupo = 'confirmada'), 0)) AS vgv_ativo_total_somado,
  sum(valor_negociado) FILTER (WHERE grupo = 'preparacao') AS vgv_preparacao_fora_do_total,
  sum(valor_negociado) FILTER (WHERE grupo = 'encerrada') AS vgv_encerrada_fora_do_total
FROM classificado;

-- 5) Venda Normal x Lançamento separados (requisito 6 da validação)
WITH classificado AS (
  SELECT modalidade, valor_negociado,
    CASE
      WHEN status = 'rascunho' THEN 'preparacao'
      WHEN status IN ('enviada_revisao','devolvida_ajuste','aprovada_gestor','enviada_juridico',
                       'em_elaboracao_contrato','contrato_conferencia_gestor',
                       'contrato_conferencia_corretor','contrato_ok_corretor','aguardando_assinatura')
        THEN 'futura'
      WHEN status IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro',
                       'ocorrencia_devolvida_gestor','ocorrencia_concluida')
        THEN 'confirmada'
      WHEN status IN ('cancelada','arquivada') THEN 'encerrada'
    END AS grupo
  FROM public.sales WHERE codigo_interno LIKE 'VALIDACAO-VGV-%'
)
SELECT '5) por modalidade' AS etapa, modalidade, grupo, count(*) AS quantidade, sum(valor_negociado) AS vgv
FROM classificado GROUP BY modalidade, grupo ORDER BY modalidade, grupo;
