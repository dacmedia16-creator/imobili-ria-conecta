/**
 * Single-flight por chave (ex.: id da venda). Enquanto uma execução da mesma chave está em
 * andamento, novos disparos NÃO abrem outra execução em paralelo: todos que chegam durante o voo
 * compartilham UMA execução de reforço, que só começa quando a atual termina (dado salvo depois do
 * início da primeira também é sincronizado). Resultado: no máximo 1 em andamento + 1 na fila por
 * chave, nunca N chamadas disputando o mesmo lock no banco (incidente de 27/11, erro 57014).
 *
 * shortcut: vale só dentro da mesma aba/navegador. Duas abas ou dois usuários ainda podem disparar
 * ao mesmo tempo; isso só uma trava no banco resolveria.
 */
export function criarFilaUnicaPorChave<K>(executar: (chave: K) => Promise<void>) {
  const emVoo = new Map<K, Promise<void>>();
  const reforco = new Map<K, Promise<void>>();

  const iniciar = (chave: K): Promise<void> => {
    const p: Promise<void> = (async () => executar(chave))().finally(() => {
      if (emVoo.get(chave) === p) emVoo.delete(chave);
    });
    emVoo.set(chave, p);
    return p;
  };

  return (chave: K): Promise<void> => {
    const naFila = reforco.get(chave);
    if (naFila) return naFila;
    const atual = emVoo.get(chave);
    if (!atual) return iniciar(chave);
    const proxima = atual
      .catch(() => undefined)
      .then(() => {
        reforco.delete(chave);
        return iniciar(chave);
      });
    reforco.set(chave, proxima);
    return proxima;
  };
}
