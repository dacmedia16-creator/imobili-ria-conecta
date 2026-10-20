/**
 * Cache curto de consultas, por instância (ex.: uma por abertura da tela de Vendas).
 *
 * - Chamadas com a mesma chave enquanto a primeira ainda está em andamento reaproveitam a
 *   mesma promessa (não dispara a consulta duas vezes em paralelo).
 * - O resultado vale por `ttlMs`; depois disso, a próxima chamada busca de novo.
 * - Erros não ficam guardados: a próxima chamada tenta novamente. Exceção: erros para os quais
 *   `guardarErro(erro)` devolve `true` (ex.: falta de permissão, que não muda em segundos) ficam
 *   guardados pelo mesmo `ttlMs`, para não repetir uma consulta que vai falhar de novo.
 *
 * shortcut: dentro da janela de `ttlMs` os números podem ficar até esse tempo defasados;
 * chame `limpar()` depois de qualquer alteração feita pela própria tela.
 */
export type CacheConsultas = {
  buscar<T>(chave: string, consulta: () => Promise<T>): Promise<T>;
  limpar(): void;
};

export type OpcoesCacheConsultas = {
  agora?: () => number;
  guardarErro?: (erro: unknown) => boolean;
};

export function criarCacheConsultas(
  ttlMs: number,
  opcoes: OpcoesCacheConsultas = {},
): CacheConsultas {
  const agora = opcoes.agora ?? Date.now;
  const guardarErro = opcoes.guardarErro ?? (() => false);
  const entradas = new Map<string, { promessa: Promise<unknown>; criadaEm: number }>();
  return {
    buscar<T>(chave: string, consulta: () => Promise<T>): Promise<T> {
      const existente = entradas.get(chave);
      if (existente && agora() - existente.criadaEm < ttlMs)
        return existente.promessa as Promise<T>;
      const promessa = consulta();
      entradas.set(chave, { promessa, criadaEm: agora() });
      promessa.catch((erro: unknown) => {
        if (guardarErro(erro)) return;
        if (entradas.get(chave)?.promessa === promessa) entradas.delete(chave);
      });
      return promessa;
    },
    limpar() {
      entradas.clear();
    },
  };
}

/** Erro de permissão do Postgres/PostgREST (RAISE ... ERRCODE '42501' → HTTP 403). */
export function ehErroDePermissao(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const e = erro as { code?: unknown; status?: unknown };
  return e.code === "42501" || e.status === 403;
}
