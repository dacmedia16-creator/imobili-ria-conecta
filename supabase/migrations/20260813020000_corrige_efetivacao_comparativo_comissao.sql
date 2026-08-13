-- Correção da regra de efetivação do "Comparativo de Comissão — Padrão 6%". Migration aditiva e
-- corretiva: só CREATE OR REPLACE das duas funções já criadas em
-- 20260813010000_comparativo_comissao_rpc.sql (que continua intocada — não é migration antiga
-- alterada, é substituída pela definição mais recente da mesma função, prática normal). Nenhuma
-- tabela, policy, trigger ou dado é tocado aqui.
--
-- REGRA DE NEGÓCIO CONFIRMADA (substitui a distinção por modalidade da migration anterior):
-- uma venda só é efetivada quando (1) a assinatura e as etapas anteriores foram concluídas E
-- (2) a ocorrência foi de fato enviada ao financeiro. O evento que comprova as DUAS coisas ao
-- mesmo tempo é a primeira entrada em 'ocorrencia_analise_financeiro' — vale igual pra venda
-- tradicional e pra Lançamento, sem diferenciação.
--
-- Por que 'contrato_assinado' NÃO bastava (confirmado lendo vendas.$id.tsx e
-- validate_sale_status_transition ao vivo, não só supondo): marcar o contrato como assinado
-- dispara uma transição automática pra 'ocorrencia_pendente' (comentário no próprio código-fonte:
-- "contrato_assinado avança automaticamente pra ocorrencia_pendente") — mas essa etapa ainda é do
-- GESTOR, que precisa preencher financiamento/pagamento/comissões antes de clicar "Enviar
-- ocorrência ao financeiro" (só aí a venda vira 'ocorrencia_analise_financeiro' de verdade). Ou
-- seja: 'contrato_assinado' captura só a assinatura, não o envio ao financeiro — podem passar
-- horas/dias entre os dois eventos reais.
--
-- Não há atalho que bypasse essa ordem: pela máquina de transição
-- (validate_sale_status_transition), uma venda tradicional só chega em
-- 'ocorrencia_analise_financeiro' vindo de 'ocorrencia_pendente' ou 'ocorrencia_devolvida_gestor',
-- e só chega em 'ocorrencia_pendente' vindo de 'contrato_assinado' — logo, usar só
-- 'ocorrencia_analise_financeiro' como evento único já garante estruturalmente que a assinatura
-- também aconteceu antes, sem precisar checar os dois eventos separadamente.

-- ============================================================================================
-- 1) comparativo_comissao_6pct(): mesma assinatura/tipos de retorno, mesma proteção de acesso
-- (SECURITY INVOKER, search_path fixo, RAISE EXCEPTION pra quem não é admin/super_admin/
-- financeiro, REVOKE de PUBLIC/anon, GRANT só pra authenticated). Único ramo de negócio: só a
-- primeira entrada em 'ocorrencia_analise_financeiro' conta, igual pras duas modalidades — sem
-- mais CASE por modalidade nem no histórico nem no evento_fechamento retornado. MIN(created_at)
-- continua garantindo que reenvio (venda devolvida e reenviada ao financeiro) nunca muda a data
-- original de efetivação, e o JOIN LATERAL sem GROUP BY continua garantindo uma linha por venda.
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
    f.data_efetivacao::date, 'ocorrencia_analise_financeiro'::text
  FROM public.sales s
  JOIN LATERAL (
    SELECT MIN(h.created_at) AS data_efetivacao
    FROM public.sale_status_history h
    WHERE h.sale_id = s.id AND h.para::text = 'ocorrencia_analise_financeiro'
  ) f ON f.data_efetivacao IS NOT NULL
  WHERE s.status::text NOT IN ('cancelada', 'arquivada')
    AND s.valor_negociado IS NOT NULL AND s.valor_negociado > 0
    AND s.valor_total_comissao IS NOT NULL AND s.valor_total_comissao > 0;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.comparativo_comissao_6pct() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.comparativo_comissao_6pct() FROM anon;
GRANT EXECUTE ON FUNCTION public.comparativo_comissao_6pct() TO authenticated;

-- ============================================================================================
-- 2) comparativo_comissao_6pct_inconsistencias(): mesma assinatura/proteção. Ausência isolada de
-- 'contrato_assinado' deixou de ser critério — o único evento que importa agora é
-- 'ocorrencia_analise_financeiro'. O filtro de status continua amplo (inclui 'contrato_assinado' e
-- 'ocorrencia_pendente', não só os status "pós-financeiro") de propósito: numa venda tradicional
-- real, o avanço automático contrato_assinado -> ocorrencia_pendente é instantâneo, então nenhuma
-- venda de verdade deveria ficar "parada" num desses dois status por muito tempo sem seguir adiante
-- — se uma linha aparece lá (ex.: TESTE-VITEST, inserida direto no banco pela suíte de integração,
-- fora da esteira, sempre sem histórico), é sinal de dado fora do fluxo normal, exatamente o tipo
-- de coisa que este indicador existe pra sinalizar. Cancelada/arquivada continuam de fora (não é
-- inconsistência, é o fim de linha esperado do fluxo).
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
        WHERE h.sale_id = s.id AND h.para::text = 'ocorrencia_analise_financeiro'
      ) THEN 'sem_historico_fechamento'
      ELSE 'valores_invalidos'
    END AS motivo
  FROM public.sales s
  WHERE s.status::text IN (
      'contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
      'ocorrencia_devolvida_gestor', 'ocorrencia_concluida'
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.sale_status_history h
        WHERE h.sale_id = s.id AND h.para::text = 'ocorrencia_analise_financeiro'
      )
      OR NOT (s.valor_negociado IS NOT NULL AND s.valor_negociado > 0 AND s.valor_total_comissao IS NOT NULL AND s.valor_total_comissao > 0)
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.comparativo_comissao_6pct_inconsistencias() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.comparativo_comissao_6pct_inconsistencias() FROM anon;
GRANT EXECUTE ON FUNCTION public.comparativo_comissao_6pct_inconsistencias() TO authenticated;
