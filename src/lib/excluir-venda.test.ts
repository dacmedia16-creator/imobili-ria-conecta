import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import {
  ExclusaoVendaError,
  MSG_CAMINHO_INVALIDO,
  MSG_SEM_PERMISSAO,
  caminhoDaVenda,
  conferirRestantes,
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
const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const OUTRA_VENDA = "44444444-4444-4444-8444-444444444444";
const PATHS = [`${ORG}/${SALE}/comprador_1/cnh/a.png`, `${ORG}/${SALE}/imovel/iptu/b.pdf`];

function cenario(opts?: {
  status?: string;
  papeis?: Record<string, string[]>;
  ativos?: string[];
  storageFalha?: "erro" | "parcial" | "vazio";
  paths?: string[];
  conferenciaFalha?: boolean;
}) {
  const sales = new Map<string, VendaParaExcluir>([
    [
      SALE,
      { id: SALE, corretor_id: DONO, status: opts?.status ?? "rascunho", organization_id: ORG },
    ],
  ]);
  const caminhos = opts?.paths ?? PATHS;
  const bucket = new Set(caminhos);
  const papeis = opts?.papeis ?? {};
  const ativos = new Set(opts?.ativos ?? [DONO, OUTRO, LIDER]);
  const ordem: string[] = [];
  const deps: DependenciasExclusao = {
    lerVenda: async (id) => sales.get(id) ?? null,
    usuarioAtivo: async (u) => ativos.has(u),
    temPapel: async (u, want) => want.some((r) => (papeis[u] ?? []).includes(r)),
    lideraCorretor: async (u, c) => u === LIDER && c === DONO,
    listarCaminhos: async () => [...caminhos],
    removerArquivos: async (paths) => {
      ordem.push("storage");
      if (opts?.storageFalha === "erro") return { removidos: [], erro: "falha de rede" };
      // policy docs_delete: sem a venda, o Storage devolve 200 com a lista vazia
      const alvo = paths.filter((p) => bucket.has(p) && p.split("/").some((seg) => sales.has(seg)));
      const feitos =
        opts?.storageFalha === "parcial"
          ? alvo.slice(0, 1)
          : opts?.storageFalha === "vazio"
            ? []
            : alvo;
      feitos.forEach((p) => bucket.delete(p));
      return { removidos: feitos, erro: null };
    },
    arquivosRestantes: async (paths) => {
      ordem.push("confere");
      if (opts?.conferenciaFalha) throw new Error("bucket indisponível");
      return paths.filter((p) => bucket.has(p));
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
    expect(ordem).toEqual(["storage", "confere", "venda"]);
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
      expect(ordem).toEqual(["storage", "confere"]);
      expect(sales.has(SALE)).toBe(true);
    },
  );

  it("mensagem de falha mostra quantos arquivos ainda restam", () => {
    expect(msgStorage(1, 2)).toContain("1 de 2 ainda no armazenamento");
  });

  it("não conseguiu conferir o bucket: falha fechada, a venda é mantida", async () => {
    const { deps, sales } = cenario({ conferenciaFalha: true });
    await expect(executarExclusaoVenda(deps, DONO, SALE)).rejects.toMatchObject({
      motivo: "storage",
    });
    expect(sales.has(SALE)).toBe(true);
  });

  // t_33a6990f item 2: a conferência é pelo resultado final, então o "tente de novo" destrava.
  it("2ª tentativa dá certo depois de uma remoção parcial", async () => {
    const c = cenario({ storageFalha: "parcial" });
    await expect(executarExclusaoVenda(c.deps, DONO, SALE)).rejects.toMatchObject({
      motivo: "storage",
    });
    expect(c.bucket.size).toBe(1);
    expect(c.sales.has(SALE)).toBe(true);
    // a rede volta: o remove só acha o arquivo que sobrou (o outro já não está no bucket)
    c.deps.removerArquivos = async (paths) => {
      c.ordem.push("storage");
      const feitos = paths.filter((p) => c.bucket.has(p));
      feitos.forEach((p) => c.bucket.delete(p));
      return { removidos: feitos, erro: null };
    };
    await expect(executarExclusaoVenda(c.deps, DONO, SALE)).resolves.toEqual({
      arquivosRemovidos: 2,
    });
    expect(c.bucket.size).toBe(0);
    expect(c.sales.has(SALE)).toBe(false);
  });

  it("2ª tentativa dá certo depois de o banco recusar a venda (remove volta vazio)", async () => {
    const c = cenario();
    const apagarOriginal = c.deps.apagarVenda;
    c.deps.apagarVenda = async () => ({ apagadas: 0, erro: "violates row-level security" });
    await expect(executarExclusaoVenda(c.deps, DONO, SALE)).rejects.toMatchObject({
      motivo: "banco",
    });
    expect(c.bucket.size).toBe(0); // arquivos já foram na 1ª tentativa
    expect(c.sales.has(SALE)).toBe(true);
    c.deps.apagarVenda = apagarOriginal;
    // remove agora devolve lista vazia (nada para apagar) e mesmo assim a venda sai
    await expect(executarExclusaoVenda(c.deps, DONO, SALE)).resolves.toEqual({
      arquivosRemovidos: 2,
    });
    expect(c.sales.has(SALE)).toBe(false);
  });

  // t_33a6990f item 1: storage_path é gravável pelo usuário e o remove roda com service_role.
  it.each([
    ["outra venda da mesma imobiliária", `${ORG}/${OUTRA_VENDA}/comprador_1/cnh/x.png`],
    ["outra imobiliária", `${OUTRA_ORG}/${SALE}/comprador_1/cnh/x.png`],
    ["outra imobiliária e outra venda", `${OUTRA_ORG}/${OUTRA_VENDA}/x.pdf`],
    ["legado de outra venda", `${OUTRA_VENDA}/x.pdf`],
    ["com ..", `${ORG}/${SALE}/../${OUTRA_VENDA}/x.pdf`],
    ["sale_id em posição errada", `x/${ORG}/${SALE}/a.pdf`],
    ["pasta da venda sem arquivo", `${ORG}/${SALE}`],
  ])("caminho de %s: recusa a exclusão inteira, nada é removido", async (_n, intruso) => {
    const c = cenario({ paths: [...PATHS, intruso] });
    const p = executarExclusaoVenda(c.deps, DONO, SALE);
    await expect(p).rejects.toMatchObject({ motivo: "caminho_invalido" });
    await expect(p).rejects.toThrow(MSG_CAMINHO_INVALIDO);
    expect(c.ordem).toEqual([]); // nem remove, nem conferência, nem DELETE
    expect(c.bucket.size).toBe(3);
    expect(c.sales.has(SALE)).toBe(true);
  });

  it("aceita o formato atual e o legado sem org", async () => {
    const legado = `${SALE}/comprador_1/cnh/antigo.png`;
    const c = cenario({ paths: [...PATHS, legado] });
    await expect(executarExclusaoVenda(c.deps, DONO, SALE)).resolves.toEqual({
      arquivosRemovidos: 3,
    });
    expect(c.bucket.size).toBe(0);
  });

  it("caminhoDaVenda: regras do prefixo", () => {
    expect(caminhoDaVenda(`${ORG}/${SALE}/a.pdf`, SALE, ORG)).toBe(true);
    expect(caminhoDaVenda(`${SALE}/a.pdf`, SALE, ORG)).toBe(true);
    expect(caminhoDaVenda(`${ORG}/${SALE}/a.pdf`, SALE, null)).toBe(false);
    expect(caminhoDaVenda(`${ORG}//${SALE}/a.pdf`, SALE, ORG)).toBe(false);
    expect(caminhoDaVenda(`/${SALE}/a.pdf`, SALE, ORG)).toBe(false);
    expect(caminhoDaVenda(`${SALE}/./a.pdf`, SALE, ORG)).toBe(false);
    expect(caminhoDaVenda(`${SALE}\\..\\a.pdf`, SALE, ORG)).toBe(false);
    expect(caminhoDaVenda("", SALE, ORG)).toBe(false);
    const vHex = "abcdef12-3456-4abc-8def-abcdefabcdef";
    const oHex = "fedcba98-7654-4abc-8def-fedcbafedcba";
    expect(caminhoDaVenda(`${oHex}/${vHex}/a.pdf`, vHex, oHex)).toBe(true);
    expect(caminhoDaVenda(`${oHex.toUpperCase()}/${vHex}/a.pdf`, vHex, oHex)).toBe(false);
    expect(caminhoDaVenda(`${vHex.toUpperCase()}/a.pdf`, vHex, oHex)).toBe(false);
  });

  it("conferirRestantes: pagina até página vazia, ignora pastas e falha fechada no erro", async () => {
    const pasta = `${ORG}/${SALE}/imovel`;
    // servidor que devolve só 2 itens por página (ignora o limit pedido)
    const itens = [
      { name: "imovel", pasta: true },
      ...Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.pdf`, pasta: false })),
    ];
    const chamadas: number[] = [];
    const listar = async (_p: string, offset: number) => {
      chamadas.push(offset);
      return itens.slice(offset, offset + 2);
    };
    await expect(
      conferirRestantes([`${pasta}/f4.pdf`, `${pasta}/sumiu.pdf`, `${ORG}/${SALE}/imovel`], listar),
    ).resolves.toEqual([`${pasta}/f4.pdf`]);
    expect(chamadas).toContain(6); // passou da 1ª página curta
    await expect(
      conferirRestantes([`${pasta}/f0.pdf`], async () => {
        throw new Error("rede");
      }),
    ).rejects.toThrow("rede");
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
