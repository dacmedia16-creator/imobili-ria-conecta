/**
 * Cache curto de consultas, por instância (ex.: uma por abertura da tela de Vendas).
 *
 * - Chamadas com a mesma chave enquanto a primeira ainda está em andamento reaproveitam a
 *   mesma promessa (não dispara a consulta duas vezes em paralelo).
 * - O resultado vale por `ttlMs`; depois disso, a próxima chamada busca de novo.
 * - Erros não ficam guardados: a próxima chamada tenta novamente.
 *
 * shortcut: dentro da janela de `ttlMs` os números podem ficar até esse tempo defasados;
 * chame `limpar()` depois de qualquer alteração feita pela própria tela.
 */
export type CacheConsultas = {
  buscar<T>(chave: string, consulta: () => Promise<T>): Promise<T>;
  limpar(): void;
};

export function criarCacheConsultas(ttlMs: number, agora: () => number = Date.now): CacheConsultas {
  const entradas = new Map<string, { promessa: Promise<unknown>; criadaEm: number }>();
  return {
    buscar<T>(chave: string, consulta: () => Promise<T>): Promise<T> {
      const existente = entradas.get(chave);
      if (existente && agora() - existente.criadaEm < ttlMs)
        return existente.promessa as Promise<T>;
      const promessa = consulta();
      entradas.set(chave, { promessa, criadaEm: agora() });
      promessa.catch(() => {
        if (entradas.get(chave)?.promessa === promessa) entradas.delete(chave);
      });
      return promessa;
    },
    limpar() {
      entradas.clear();
    },
  };
}
