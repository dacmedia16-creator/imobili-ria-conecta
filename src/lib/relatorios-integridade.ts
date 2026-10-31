export function exigirConsulta<T>(
  resultado: { data: T | null; error: { message: string } | null },
  origem: string,
): T {
  if (resultado.error || resultado.data == null) {
    throw new Error(
      `Relatórios incompletos (${origem}): ${resultado.error?.message ?? "resposta sem dados"}`,
    );
  }
  return resultado.data;
}

/**
 * Baixa em lote: confere, item a item, se o banco devolveu exatamente a linha alterada.
 * Erro, zero linhas (RLS silenciosa) ou linha diferente contam como falha — nunca como sucesso.
 */
export function conferirBaixaEmLote(
  resultados: { data: { id: string }[] | null; error: { message: string } | null }[],
  occIds: string[],
): { confirmadas: number; falhas: number } {
  let confirmadas = 0;
  resultados.forEach((resultado, i) => {
    try {
      confirmarLinhaAlterada(resultado, occIds[i]);
      confirmadas += 1;
    } catch {
      // conta como falha abaixo
    }
  });
  return { confirmadas, falhas: occIds.length - confirmadas };
}

export function confirmarLinhaAlterada(
  resultado: { data: { id: string }[] | null; error: { message: string } | null },
  occId: string,
): void {
  const linhas = exigirConsulta(resultado, "alteração do recebimento");
  if (linhas.length !== 1 || linhas[0].id !== occId) {
    throw new Error("Recebimento não confirmado: nenhuma linha correspondente foi alterada.");
  }
}
