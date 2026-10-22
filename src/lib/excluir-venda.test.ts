import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import {
  ExclusaoVendaError,
  MSG_SEM_PERMISSAO,
  executarExclusaoVenda,
  msgStorage,
  type DependenciasExclusao,
  type VendaParaExcluir,
} from "./excluir-venda";

// t_42d1f0bb: "Excluir venda" apagava a venda antes do storage; a policy docs_delete (exige a venda)
// fazia o remove voltar vazio sem erro e os arquivos ficavam órfãos. Dublê em memória do banco +
// bucket, com a mesma regra da policy docs_delete: só remove arquivo de venda que ainda existe.
const DONO = "u-dono";
const OUTRO = "u-outro";
const LIDER = "u-lider";
const SALE = "11111111-1111-4111-8111-111111111111";
const PATHS = [`org/${SALE}/comprador_1/cnh/a.png`, `org/${SALE}/imovel/iptu/b.pdf`];

function cenario(opts?: {
  status?: string;
  papeis?: Record<string, string[]>;
  ativos?: string[];
  storageFalha?: "erro" | "parcial" | "vazio";
}) {
  const sales = new Map<string, VendaParaExcluir>([
    [SALE, { id: SALE, corretor_id: DONO, status: opts?.status ?? "rascunho" }],
  ]);
  const bucket = new Set(PATHS);
  const papeis = opts?.papeis ?? {};
  const ativos = new Set(opts?.ativos ?? [DONO, OUTRO, LIDER]);
  const ordem: string[] = [];
  const deps: DependenciasExclusao = {
    lerVenda: async (id) => sales.get(id) ?? null,
    usuarioAtivo: async (u) => ativos.has(u),
    temPapel: async (u, want) => want.some((r) => (papeis[u] ?? []).includes(r)),
    lideraCorretor: async (u, c) => u === LIDER && c === DONO,
    listarCaminhos: async () => [...PATHS],
    removerArquivos: async (paths) => {
      ordem.push("storage");
      if (opts?.storageFalha === "erro") return { removidos: [], erro: "falha de rede" };
      // policy docs_delete: sem a venda, o Storage devolve 200 com a lista vazia
      const alvo = paths.filter((p) => bucket.has(p) && sales.has(p.split("/")[1]));
      const feitos =
        opts?.storageFalha === "parcial"
          ? alvo.slice(0, 1)
          : opts?.storageFalha === "vazio"
            ? []
            : alvo;
      feitos.forEach((p) => bucket.delete(p));
      return { removidos: feitos, erro: null };
    },
    apagarVenda: async (id) => {
      ordem.push("venda");
      return { apagadas: sales.delete(id) ? 1 : 0, erro: null };
    },
  };
  return { deps, sales, bucket, ordem };
}

describe("executarExclusaoVenda (t_42d1f0bb)", () => {
  it("venda com documentos: apaga os arquivos ANTES da venda e o storage fica com 0 arquivos", async () => {
    const { deps, sales, bucket, ordem } = cenario();
    await expect(executarExclusaoVenda(deps, DONO, SALE)).resolves.toEqual({
      arquivosRemovidos: 2,
    });
    expect(ordem).toEqual(["storage", "venda"]);
    expect(bucket.size).toBe(0);
    expect(sales.has(SALE)).toBe(false);
  });

  it.each(["erro", "parcial", "vazio"] as const)(
    "falha no storage (%s): a venda é mantida e o usuário recebe erro claro",
    async (storageFalha) => {
      const { deps, sales, ordem } = cenario({ storageFalha });
      const p = executarExclusaoVenda(deps, DONO, SALE);
      await expect(p).rejects.toBeInstanceOf(ExclusaoVendaError);
      await expect(p).rejects.toMatchObject({ motivo: "storage" });
      await expect(p).rejects.toThrow("A venda NÃO foi excluída");
      expect(ordem).toEqual(["storage"]);
      expect(sales.has(SALE)).toBe(true);
    },
  );

  it("mensagem de falha mostra a contagem removida x esperada", () => {
    expect(msgStorage(1, 2)).toContain("1 de 2 removidos");
  });

  it("usuário sem permissão continua bloqueado e nada é apagado", async () => {
    const casos: Array<[string, Parameters<typeof cenario>[0]]> = [
      [OUTRO, { papeis: { [OUTRO]: ["corretor"] } }],
      [OUTRO, { papeis: { [OUTRO]: ["financeiro", "juridico", "staff"] } }],
      [OUTRO, { papeis: { [OUTRO]: ["gestor"] } }], // líder de outra equipe
      [DONO, { status: "enviada_revisao" }], // fora do rascunho ninguém exclui
      [DONO, { ativos: [] }], // usuário inativo
    ];
    for (const [quem, opts] of casos) {
      const { deps, sales, bucket, ordem } = cenario(opts);
      await expect(executarExclusaoVenda(deps, quem, SALE)).rejects.toThrow(MSG_SEM_PERMISSAO);
      expect(ordem).toEqual([]);
      expect(sales.has(SALE)).toBe(true);
      expect(bucket.size).toBe(2);
    }
  });

  it("criador, líder da equipe do criador e admin conseguem excluir", async () => {
    for (const [quem, papeis] of [
      [DONO, {}],
      [LIDER, { [LIDER]: ["team_leader"] }],
      [OUTRO, { [OUTRO]: ["super_admin"] }],
    ] as const) {
      const { deps, bucket, sales } = cenario({ papeis: papeis as Record<string, string[]> });
      await executarExclusaoVenda(deps, quem, SALE);
      expect(bucket.size).toBe(0);
      expect(sales.size).toBe(0);
    }
  });

  it("venda inexistente ou invisível: erro e nada é apagado", async () => {
    const { deps, ordem } = cenario();
    await expect(executarExclusaoVenda(deps, DONO, "outra")).rejects.toMatchObject({
      motivo: "nao_encontrada",
    });
    expect(ordem).toEqual([]);
  });

  it("banco recusa a venda depois do storage: erro claro (não mostra sucesso)", async () => {
    const { deps } = cenario();
    deps.apagarVenda = async () => ({ apagadas: 0, erro: null });
    await expect(executarExclusaoVenda(deps, DONO, SALE)).rejects.toMatchObject({
      motivo: "banco",
    });
  });

  it("telas usam a exclusão pelo servidor e não chamam mais storage.remove depois da venda", () => {
    for (const f of ["vendas.index.tsx", "vendas.$id.tsx"]) {
      const src = readFileSync(new URL(`../routes/_authenticated/${f}`, import.meta.url), "utf8");
      expect(src).toContain("excluirVenda({ data: { saleId:");
      expect(src).not.toContain("deleteSaleCascade");
    }
    const perm = readFileSync(new URL("./permissions.ts", import.meta.url), "utf8");
    expect(perm).not.toMatch(/storage\s*\.from\("sale-documents"\)\s*\.remove/);
  });
});
