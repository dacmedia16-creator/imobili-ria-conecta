// Mantém as consultas com RLS do cliente; nunca publica um agregado com linhas truncadas.
export async function consultarTodasLinhas<T>(
  origem: string,
  pagina: (
    inicio: number,
    fim: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
    count: number | null;
  }>,
  tamanho = 500,
): Promise<T[]> {
  const linhas: T[] = [];
  let total: number | null = null;
  for (let inicio = 0; ; inicio += tamanho) {
    const resultado = await pagina(inicio, inicio + tamanho - 1);
    if (resultado.error || resultado.data == null || resultado.count == null) {
      throw new Error(
        `Dados financeiros incompletos (${origem}): ${resultado.error?.message ?? "resposta sem linhas/contagem"}`,
      );
    }
    if (total != null && resultado.count !== total) {
      throw new Error(
        `Dados financeiros incompletos (${origem}): contagem alterada durante a paginação.`,
      );
    }
    total = resultado.count;
    linhas.push(...resultado.data);
    if (linhas.length >= total) {
      if (linhas.length !== total)
        throw new Error(`Dados financeiros incompletos (${origem}): contagem divergente.`);
      return linhas;
    }
    if (resultado.data.length !== tamanho) {
      throw new Error(`Dados financeiros incompletos (${origem}): página truncada.`);
    }
  }
}
