import { describe, expect, it } from "vitest";
import {
  avisoContratoOutroCorretor,
  contratoNaTransferencia,
  erroMotivo,
  lerTransferencia,
  marcadosIniciais,
  origensDoLote,
  papelPodeTransferir,
  resumoLote,
  textoTransferencia,
  type ItemPrevia,
} from "./captacao-transferencia";

const has = (mine: string[]) => (roles: string[]) => roles.some((r) => mine.includes(r));

const item = (id: string, p: Partial<ItemPrevia> = {}): ItemPrevia => ({
  id,
  endereco: `Rua ${id}`,
  bairro: null,
  status: "rascunho",
  manual: false,
  arquivada: false,
  bloqueio: null,
  contrato: "atualizado",
  leads_abertos: 0,
  ...p,
});

describe("transferência de captação — permissão na tela", () => {
  it("gestor/admin transferem; corretor e team leader sozinho não", () => {
    expect(papelPodeTransferir(has(["gestor"]))).toBe(true);
    expect(papelPodeTransferir(has(["admin"]))).toBe(true);
    expect(papelPodeTransferir(has(["corretor"]))).toBe(false);
    expect(papelPodeTransferir(has(["team_leader"]))).toBe(false);
  });
});

describe("contrato na transferência", () => {
  it("em assinatura (ou envelope ativo) bloqueia", () => {
    expect(contratoNaTransferencia({ status: "em_assinatura", manual: false })).toBe("bloqueado");
    expect(contratoNaTransferencia({ status: "rascunho", manual: false }, true)).toBe("bloqueado");
  });
  it("assinado (aprovada ou manual) é mantido", () => {
    expect(contratoNaTransferencia({ status: "aprovada", manual: false })).toBe("mantido");
    expect(contratoNaTransferencia({ status: "rascunho", manual: true })).toBe("mantido");
  });
  it("rascunho e devolvida passam ao novo corretor", () => {
    expect(contratoNaTransferencia({ status: "rascunho", manual: false })).toBe("atualizado");
    expect(contratoNaTransferencia({ status: "devolvida", manual: false } as never)).toBe(
      "atualizado",
    );
  });
});

describe("motivo obrigatório", () => {
  it("vazio ou curto dá erro; motivo válido passa", () => {
    expect(erroMotivo("  ")).not.toBeNull();
    expect(erroMotivo("ab")).not.toBeNull();
    expect(erroMotivo("x".repeat(501))).not.toBeNull();
    expect(erroMotivo("Corretor saiu da imobiliária")).toBeNull();
  });
});

describe("lote com prévia e desmarcados", () => {
  const itens = [
    item("a"),
    item("b", { contrato: "mantido", status: "aprovada", leads_abertos: 2 }),
    item("c", { contrato: "bloqueado", status: "em_assinatura", bloqueio: "Em assinatura" }),
    item("d"),
  ];
  it("vem tudo marcado menos as bloqueadas", () => {
    expect([...marcadosIniciais(itens)].sort()).toEqual(["a", "b", "d"]);
  });
  it("desmarcada não vai; bloqueada nunca vai, mesmo marcada", () => {
    const marcados = new Set(["a", "b", "c"]); // d desmarcada, c forçada
    const r = resumoLote(itens, marcados);
    expect(r.ids).toEqual(["a", "b"]);
    expect(r).toMatchObject({ total: 2, atualizados: 1, mantidos: 1, leads: 2, bloqueadas: 1 });
  });
});

describe("histórico", () => {
  it("lê o detail gravado e monta o texto", () => {
    const d = lerTransferencia(
      JSON.stringify({
        de_nome: "Carlos",
        para_nome: "Bruno",
        motivo: "Saiu",
        contrato: "mantido",
        leads: 1,
      }),
    );
    expect(textoTransferencia(d)).toBe(
      "Transferida de Carlos para Bruno · motivo: Saiu · contrato assinado mantido no nome de quem assinou · 1 lead aberto transferido",
    );
  });
  it("tolera detail estragado", () => {
    expect(lerTransferencia("{x").de_nome).toBe("—");
    expect(lerTransferencia(null).leads).toBe(0);
  });
});

describe("aviso de contrato assinado no nome do antigo", () => {
  const hist = [{ action: "transferida", detail: JSON.stringify({ para_nome: "Bruno" }) }];
  it("avisa na aprovada transferida", () => {
    const a = avisoContratoOutroCorretor(
      { status: "aprovada", manual: false, broker_name: "Carlos", captador_original_id: "u1" },
      hist,
    );
    expect(a).toContain("continua no nome de Carlos");
  });
  it("não avisa sem transferência ou em rascunho", () => {
    expect(
      avisoContratoOutroCorretor(
        { status: "aprovada", manual: false, broker_name: "Carlos", captador_original_id: null },
        [],
      ),
    ).toBeNull();
    expect(
      avisoContratoOutroCorretor(
        { status: "rascunho", manual: false, broker_name: "Bruno", captador_original_id: "u1" },
        hist,
      ),
    ).toBeNull();
  });
});

describe("origens do lote", () => {
  it("um por corretor, sem usar o nome do contrato de captação já transferida", () => {
    const o = origensDoLote(
      [
        { captor_id: "u1", broker_name: "Carlos", captador_original_id: null },
        { captor_id: "u1", broker_name: "Carlos", captador_original_id: null },
        { captor_id: "u2", broker_name: "Carlos", captador_original_id: "u1" },
      ],
      new Map(),
    );
    expect(o).toEqual([
      { id: "u1", nome: "Carlos" },
      { id: "u2", nome: "Corretor sem nome" },
    ]);
  });
});
