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

export function confirmarLinhaAlterada(
  resultado: { data: { id: string }[] | null; error: { message: string } | null },
  occId: string,
): void {
  const linhas = exigirConsulta(resultado, "alteração do recebimento");
  if (linhas.length !== 1 || linhas[0].id !== occId) {
    throw new Error("Recebimento não confirmado: nenhuma linha correspondente foi alterada.");
  }
}
