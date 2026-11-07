import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { numerosPartesExtras, removerParteDaVenda } from "./partes-venda";
import { partesComExigenciaPessoal, validarDocsAprovadosParaJuridico } from "./status";

// Caso real t_b0d45ab1: vendedor_3 foi "removido" arquivando os documentos, mas a linha da parte
// (com nome) ficou gravada. A validação cobrava os documentos e a aba Documentos não mostrava o bloco.
const parties = {
  vendedor_1: { nome: "V1", tipo_pessoa: "fisica" },
  vendedor_2: { nome: "V2", tipo_pessoa: "fisica" },
  vendedor_3: { nome: "V3", tipo_pessoa: "fisica" },
  comprador_1: { nome: "C1", tipo_pessoa: "fisica" },
  comprador_2: { nome: "C2", tipo_pessoa: "fisica" },
} as Record<string, { nome: string | null; tipo_pessoa: string }>;
const docsAtivos = ["vendedor_1", "vendedor_2", "comprador_1", "comprador_2"].map((parte) => ({
  parte,
}));

describe("numerosPartesExtras — bloco da aba Documentos segue a validação", () => {
  it("mostra o bloco de uma parte com nome mesmo sem documento ativo (antes sumia)", () => {
    expect(partesComExigenciaPessoal(parties, docsAtivos)).toContain("vendedor_3");
    expect(numerosPartesExtras("vendedor", parties, docsAtivos)).toEqual([2, 3]);
    expect(numerosPartesExtras("comprador", parties, docsAtivos)).toEqual([2]);
  });

  it("toda parte cobrada no envio tem bloco visível", () => {
    const cobradas = partesComExigenciaPessoal(parties, docsAtivos).filter(
      (p) => !p.endsWith("_1"),
    );
    const visiveis = [
      ...numerosPartesExtras("vendedor", parties, docsAtivos).map((n) => `vendedor_${n}`),
      ...numerosPartesExtras("comprador", parties, docsAtivos).map((n) => `comprador_${n}`),
    ];
    expect(visiveis.sort()).toEqual(cobradas.sort());
  });
});

describe("partesComExigenciaPessoal — ignora parte vazia", () => {
  it("parte sem nome (ou só espaços) e sem documento não é cobrada", () => {
    const p = {
      ...parties,
      vendedor_4: { nome: "  ", tipo_pessoa: "fisica" },
      comprador_3: { nome: null, tipo_pessoa: "fisica" },
    };
    const r = partesComExigenciaPessoal(p, docsAtivos);
    expect(r).not.toContain("vendedor_4");
    expect(r).not.toContain("comprador_3");
  });

  it("depois de remover a parte, o envio ao jurídico não cobra mais os documentos dela", () => {
    const semV3 = { ...parties } as Record<string, never>;
    delete (semV3 as Record<string, unknown>).vendedor_3;
    const pend = validarDocsAprovadosParaJuridico(semV3, [], true);
    expect(pend.some((x) => x.campo.endsWith("_vendedor_3"))).toBe(false);
    const antes = validarDocsAprovadosParaJuridico(parties as Record<string, never>, [], true);
    expect(antes.some((x) => x.campo === "doc_rg_vendedor_3")).toBe(true);
  });
});

// Cliente falso: registra as chamadas em ordem e responde com o que o teste mandar.
function fakeDb(opts: { docs?: { id: string }[]; falhaEm?: string } = {}) {
  const calls: string[] = [];
  const builder = (tabela: string) => {
    const filtros: string[] = [];
    let op = "select";
    const b = {
      select: () => ((op = "select"), b),
      delete: () => ((op = "delete"), b),
      eq: (c: string, v: string) => (filtros.push(`${c}=${v}`), b),
      is: (c: string, v: null) => (filtros.push(`${c} is ${v}`), b),
      then: (res: (r: unknown) => unknown) => {
        const chave = `${op} ${tabela} ${filtros.join("&")}`;
        calls.push(chave);
        const error = opts.falhaEm && chave.startsWith(opts.falhaEm) ? { message: "falhou" } : null;
        return Promise.resolve(
          op === "select" ? { data: error ? null : (opts.docs ?? []), error } : { error },
        ).then(res);
      },
    };
    return b;
  };
  const db = {
    from: builder,
    rpc: (fn: string, args: { _document_id: string }) => {
      const chave = `rpc ${fn} ${args._document_id}`;
      calls.push(chave);
      const error = opts.falhaEm && chave.startsWith(opts.falhaEm) ? { message: "falhou" } : null;
      return Promise.resolve({ error });
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, calls };
}

describe("removerParteDaVenda — remove sem deixar pendência", () => {
  it("arquiva os documentos ativos, apaga a parte e a conta bancária, nessa ordem", async () => {
    const { db, calls } = fakeDb({ docs: [{ id: "d1" }, { id: "d2" }] });
    const r = await removerParteDaVenda(db, "S", "vendedor_3");
    expect(r).toEqual({ error: null, docsArquivados: ["d1", "d2"] });
    expect(calls).toEqual([
      "select sale_documents sale_id=S&parte=vendedor_3&deleted_at is null",
      "rpc archive_sale_document d1",
      "rpc archive_sale_document d2",
      "delete sale_parties sale_id=S&papel=vendedor_3",
      "delete sale_bank_accounts sale_id=S&parte=vendedor_3",
    ]);
  });

  it("recusa remover a parte 1 ou papel fora do padrão, sem tocar no banco", async () => {
    for (const papel of ["vendedor_1", "comprador_1", "imovel", "recebimento"]) {
      const { db, calls } = fakeDb();
      const r = await removerParteDaVenda(db, "S", papel);
      expect(r.error).toBeTruthy();
      expect(calls).toEqual([]);
    }
  });

  it("se arquivar um documento falhar, para antes de apagar a parte (pode repetir depois)", async () => {
    const { db, calls } = fakeDb({ docs: [{ id: "d1" }], falhaEm: "rpc archive_sale_document d1" });
    const r = await removerParteDaVenda(db, "S", "vendedor_3");
    expect(r.error).toBe("falhou");
    expect(calls.some((c) => c.startsWith("delete"))).toBe(false);
  });

  it("parte sem documentos ativos (caso real) só apaga a parte e a conta", async () => {
    const { db, calls } = fakeDb({ docs: [] });
    const r = await removerParteDaVenda(db, "S", "vendedor_3");
    expect(r.error).toBeNull();
    expect(calls.filter((c) => c.startsWith("delete"))).toHaveLength(2);
  });
});
