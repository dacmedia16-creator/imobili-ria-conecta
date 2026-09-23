-- Fecha o acesso anônimo às RPCs operacionais que não são públicas.
-- Mantém EXECUTE para authenticated, service_role e postgres.
-- As RPCs públicas e as funções que fazem sua própria checagem não são alteradas.

REVOKE EXECUTE ON FUNCTION public.marcar_contrato_assinado_e_criar_ocorrencia(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_occurrence_commissions(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sincronizar_previsao_ocorrencia_pendente(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon;
