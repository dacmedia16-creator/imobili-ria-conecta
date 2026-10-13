// Data de assinatura mostrada na ocorrência (detalhe da venda padrão).
// Regra única (Denis, 13/10/2026): venda padrão usa o ÚLTIMO contrato_assinado (fuso SP), já calculado
// por public.data_assinatura_oficial; Lançamento usa sales.data_assinatura (editado no LancamentoDetail).
// Na venda padrão o campo da ocorrência fica somente leitura e nunca entra no payload de salvamento,
// para não sobrescrever nem apagar occurrences.data_assinatura.

export const TEXTO_ORIGEM_DATA_ASSINATURA =
  "Data em que a venda foi marcada como contrato assinado.";
export const TEXTO_SEM_HISTORICO_ASSINATURA =
  "Sem registro de contrato assinado no histórico; exibindo a data já gravada na ocorrência.";

export function dataAssinaturaOcorrenciaTravada(modalidade: string | null | undefined): boolean {
  return modalidade !== "lancamento";
}

/** Remove data_assinatura da lista de campos salvos quando o campo está travado. */
export function camposSalvaveisOcorrencia<K extends string>(
  campos: readonly K[],
  modalidade: string | null | undefined,
): K[] {
  if (!dataAssinaturaOcorrenciaTravada(modalidade)) return [...campos];
  return campos.filter((k) => k !== "data_assinatura");
}

/**
 * Ao salvar a ocorrência da venda padrão, alinha occurrences.data_assinatura à data oficial
 * (Painel Financeiro e Relatórios leem o campo gravado). Retorna a data a gravar, ou null quando
 * não há nada a alinhar: Lançamento, consulta oficial falhou/sem histórico, ou já está igual.
 */
export function dataAssinaturaParaAlinhar(
  modalidade: string | null | undefined,
  oficial: string | null | undefined,
  gravadaNaOcorrencia: string | null | undefined,
): string | null {
  if (!dataAssinaturaOcorrenciaTravada(modalidade)) return null;
  if (!oficial) return null;
  return oficial !== (gravadaNaOcorrencia ?? null) ? oficial : null;
}

/** Valor exibido no campo travado: a data oficial; sem ela, a data já gravada (mesma reserva da RPC). */
export function dataAssinaturaExibida(
  oficial: string | null | undefined,
  gravadaNaOcorrencia: string | null | undefined,
): string {
  return oficial ?? gravadaNaOcorrencia ?? "";
}
