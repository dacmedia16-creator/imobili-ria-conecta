-- Fecha somente o acesso anônimo às RPCs financeiras que não são públicas.
-- Mantém EXECUTE direto para authenticated e service_role.
-- As RPCs públicas de posicionamento não são alteradas.

REVOKE EXECUTE ON FUNCTION public.comissao_coordenador_dados(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_sale_comissao(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sincronizar_base_financeira_ocorrencia(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_stats() FROM PUBLIC, anon;
