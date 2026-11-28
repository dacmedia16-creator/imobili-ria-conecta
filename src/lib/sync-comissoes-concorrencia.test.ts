import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// OFFLINE: executa a função real `syncOccurrenceCommissions` extraída do TSX da venda, com o
// Supabase simulado (RPC lenta). Reproduz o incidente de 27/11: 8 disparos simultâneos de
// sync_occurrence_commissions para a mesma venda disputaram o lock e estouraram o timeout (57014).
const source = readFileSync(
  new URL("../routes/_authenticated/vendas.$id.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "route.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes: ts.Node[] = [];
(function visit(n: ts.Node) {
  nodes.push(n);
  ts.forEachChild(n, visit);
})(ast);
const named = (name: string) =>
  nodes.find(
    (n) =>
      (ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name?.getText(ast) === name,
  );
const js = (text: string) =>
  ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

async function harness() {
  // Import dinâmico: antes da correção o helper não existia e o teste falha pela contagem de
  // chamadas, não por erro de import.
  const helper = await import("./fila-unica-por-chave").catch(() => ({}));
  const rpcCalls: string[] = [];
  let emVoo = 0;
  let picoParalelo = 0;
  const pendentes: Array<() => void> = [];
  const context: Record<string, unknown> = {
    ...helper,
    supabase: {
      rpc: (name: string, args: { _sale_id: string }) => {
        rpcCalls.push(`${name}:${args._sale_id}`);
        emVoo++;
        picoParalelo = Math.max(picoParalelo, emVoo);
        return new Promise((resolve) => {
          pendentes.push(() => {
            emVoo--;
            resolve({ error: null });
          });
        });
      },
    },
  };
  vm.createContext(context);
  for (const name of ["syncOccurrenceCommissionsFila", "syncOccurrenceCommissions"]) {
    const n = named(name);
    if (!n) continue;
    const text = ts.isVariableDeclaration(n) ? n.initializer!.getText(ast) : n.getText(ast);
    vm.runInContext(js(`globalThis.${name} = ${text};`), context);
  }
  const sync = context.syncOccurrenceCommissions as (id: string) => Promise<void>;
  const liberar = async () => {
    // Solta a RPC em andamento e deixa as continuações (fila) rodarem.
    while (pendentes.length) pendentes.shift()!();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { sync, rpcCalls, liberar, pico: () => picoParalelo };
}

describe("sync_occurrence_commissions — disparos simultâneos na mesma venda (incidente 27/11)", () => {
  it("8 disparos simultâneos da mesma venda nunca rodam em paralelo e geram no máximo 1 chamada extra", async () => {
    const h = await harness();
    const todas = Array.from({ length: 8 }, () => h.sync("venda-1"));
    await Promise.resolve();
    expect(h.rpcCalls).toHaveLength(1);
    await h.liberar();
    await h.liberar();
    await Promise.all(todas);
    expect(h.pico()).toBe(1);
    // 1 chamada + no máximo 1 de reforço (para quem disparou depois que a primeira já tinha começado).
    expect(h.rpcCalls.length).toBeLessThanOrEqual(2);
  });

  it("vendas diferentes não se bloqueiam", async () => {
    const h = await harness();
    const a = h.sync("venda-a");
    const b = h.sync("venda-b");
    await Promise.resolve();
    expect(h.rpcCalls).toEqual([
      "sync_occurrence_commissions:venda-a",
      "sync_occurrence_commissions:venda-b",
    ]);
    await h.liberar();
    await Promise.all([a, b]);
  });

  it("depois de terminar, um novo salvamento chama a RPC de novo (não fica preso em cache)", async () => {
    const h = await harness();
    const p1 = h.sync("venda-1");
    await h.liberar();
    await p1;
    const p2 = h.sync("venda-1");
    await h.liberar();
    await p2;
    expect(h.rpcCalls).toHaveLength(2);
  });

  it("o TSX tem um único ponto que chama a RPC (Resumo e 'Puxar da revisão do gestor' passam por ele)", () => {
    const diretas = source.match(/supabase\.rpc\(\s*"sync_occurrence_commissions"/g) ?? [];
    expect(diretas).toHaveLength(1);
    const pull = named("pullFromSaleSplit")!.getText(ast);
    expect(pull).toContain("syncOccurrenceCommissions(saleId)");
  });
});
