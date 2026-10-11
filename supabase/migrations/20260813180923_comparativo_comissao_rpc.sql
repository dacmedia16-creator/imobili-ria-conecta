-- RPCs somente leitura para a página "Comparativo de Comissão — Padrão 6%" (/comparativo-comissao).
-- Não alteram nenhuma tabela, não recalculam nem persistem nada em sales/occurrences — só leem.
--
-- Restrição de acesso: SECURITY INVOKER (roda com o RLS de quem chama — sales_select já libera
-- financeiro/admin/super_admin a ver todas as vendas, então não precisa de DEFINER pra esses três
-- papéis). Mas como gestor/team_leader/juridico/corretor também têm visibilidade PARCIAL de sales
-- via RLS (própria equipe, próprias vendas, etapas específicas), depender só da RLS deixaria esses
-- papéis chamarem a RPC e receberem uma resposta parcial — o pedido exige bloqueio total pra eles
-- nesta página específica. Por isso as duas funções abaixo checam o papel explicitamente e barram
-- com RAISE EXCEPTION antes de tocar em qualquer tabela, independente do que a RLS deixaria ver.
--
-- REVOKE explícito: CREATE FUNCTION concede EXECUTE a PUBLIC por padrão, e este projeto Supabase
-- também concede EXECUTE direto a anon/authenticated (confirmado em auditoria via
-- information_schema.routine_privileges — REVOKE ... FROM PUBLIC sozinho não bastaria, ver o
-- precedente documentado em 20260727040000/20260727050000). Sem o REVOKE abaixo, um caller anônimo
-- conseguiria CHAMAR a função (e receber só o erro de acesso negado, nunca dado real, já que
-- has_any_role(NULL, ...) é fail-closed) — mas deixar isso implícito depende só da lógica interna
-- se manter correta pra sempre. Explícito é mais seguro e documenta a intenção.
--
-- Nenhuma das duas funções é usada dentro de policy RLS, trigger ou outra função do fluxo
-- operacional (confirmado por grep no repo inteiro) — revogar EXECUTE de anon aqui não corre o
-- risco do incidente de 20260727040000 (que quebrou RLS ao revogar EXECUTE de funções internas
-- tipo has_role/is_active_user, usadas DENTRO de policies de outras tabelas).

-- ============================================================================================
-- 1) comparativo_comissao_6pct(): linhas elegíveis do comparativo, uma por venda.
--
-- Data de fechamento por modalidade (não usa created_at/updated_at da venda em nenhum caso):
--   - modalidade <> 'lancamento' (venda tradicional): primeira entrada em 'contrato_assinado'.
--   - modalidade = 'lancamento': primeira entrada em 'ocorrencia_analise_financeiro' — o fluxo do
--     Lançamento pula todo o bloco de contrato (rascunho -> ocorrencia_analise_financeiro é o único
--     hop que ele usa, ver 20260811030000_lancamento_rls.sql), então nunca vai ter
--     'contrato_assinado' no histórico; isso é o comportamento normal da modalidade, não uma
--     pendência de dados. O envio pro financeiro é o evento equivalente de "fechou e virou pra
--     conferência". Não altera as transições do Lançamento pra criar um 'contrato_assinado'
--     artificial nem retroage em histórico antigo — só lê o que já existe.
--
-- MIN(created_at) sobre o evento certo dedupe automaticamente reentradas no mesmo status (ex.:
-- venda devolvida e reenviada duas vezes pra 'ocorrencia_analise_financeiro') — sempre a primeira,
-- e sempre uma linha por venda (JOIN LATERAL correlacionado por sale_id, agregado sem GROUP BY).
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.comparativo_comissao_6pct()
RETURNS TABLE (
  sale_id uuid,
  codigo_interno text,
  imovel_id text,
  modalidade text,
  status text,
  corretor_id uuid,
  valor_negociado numeric,
  valor_total_comissao numeric,
  percentual_comissao numeric,
  data_fechamento date,
  evento_fechamento text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin','financeiro']::public.app_role[]) THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Comparativo de Comissão.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, s.codigo_interno, s.imovel_id, s.modalidade, s.status::text, s.corretor_id,
    s.valor_negociado, s.valor_total_comissao, s.percentual_comissao,
    f.data_fechamento::date, f.evento_fechamento
  FROM public.sales s
  JOIN LATERAL (
    SELECT
      MIN(h.created_at) AS data_fechamento,
      (CASE WHEN s.modalidade = 'lancamento' THEN 'ocorrencia_analise_financeiro' ELSE 'contrato_assinado' END) AS evento_fechamento
    FROM public.sale_status_history h
    WHERE h.sale_id = s.id
      AND h.para::text = (CASE WHEN s.modalidade = 'lancamento' THEN 'ocorrencia_analise_financeiro' ELSE 'contrato_assinado' END)
  ) f ON f.data_fechamento IS NOT NULL
  WHERE s.status::text NOT IN ('cancelada', 'arquivada')
    AND s.valor_negociado IS NOT NULL AND s.valor_negociado > 0
    AND s.valor_total_comissao IS NOT NULL AND s.valor_total_comissao > 0;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.comparativo_comissao_6pct() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.comparativo_comissao_6pct() FROM anon;
GRANT EXECUTE ON FUNCTION public.comparativo_comissao_6pct() TO authenticated;

-- ============================================================================================
-- 2) comparativo_comissao_6pct_inconsistencias(): RPC separada (não amplia a principal) só pro
-- contador "Inconsistências encontradas" do Comparativo — venda que já passou (ou deveria ter
-- passado) pelo evento de fechamento da própria modalidade mas não tem o histórico esperado, ou
-- que chegou lá com valor_negociado/valor_total_comissao inválido. Nunca inclui uma venda de
-- Lançamento só por não ter 'contrato_assinado' (isso é normal pra essa modalidade, ver acima) —
-- só o evento certo de cada modalidade conta. Cancelada/arquivada não entram aqui (não é
-- inconsistência, é o fim de linha esperado do fluxo). Somente leitura, mesmas proteções da RPC 1).
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.comparativo_comissao_6pct_inconsistencias()
RETURNS TABLE (
  sale_id uuid,
  codigo_interno text,
  modalidade text,
  motivo text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin','financeiro']::public.app_role[]) THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Comparativo de Comissão.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, s.codigo_interno, s.modalidade,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM public.sale_status_history h
        WHERE h.sale_id = s.id
          AND h.para::text = (CASE WHEN s.modalidade = 'lancamento' THEN 'ocorrencia_analise_financeiro' ELSE 'contrato_assinado' END)
      ) THEN 'sem_historico_fechamento'
      ELSE 'valores_invalidos'
    END AS motivo
  FROM public.sales s
  WHERE
    (
      (s.modalidade = 'lancamento' AND s.status::text IN ('ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor', 'ocorrencia_concluida'))
      OR
      (s.modalidade <> 'lancamento' AND s.status::text IN ('contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor', 'ocorrencia_concluida'))
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.sale_status_history h
        WHERE h.sale_id = s.id
          AND h.para::text = (CASE WHEN s.modalidade = 'lancamento' THEN 'ocorrencia_analise_financeiro' ELSE 'contrato_assinado' END)
      )
      OR NOT (s.valor_negociado IS NOT NULL AND s.valor_negociado > 0 AND s.valor_total_comissao IS NOT NULL AND s.valor_total_comissao > 0)
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.comparativo_comissao_6pct_inconsistencias() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.comparativo_comissao_6pct_inconsistencias() FROM anon;
GRANT EXECUTE ON FUNCTION public.comparativo_comissao_6pct_inconsistencias() TO authenticated;
