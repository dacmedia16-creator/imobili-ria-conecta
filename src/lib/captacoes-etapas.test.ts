import { describe, expect, it } from "vitest";
import {
  captacaoMinhaVez,
  contarEtapas,
  etapaCaptacao,
  indiceEtapa,
  noFiltroEtapa,
  podeGerirCaptacao,
  type ContextoVez,
} from "./captacoes-painel";

// t_abf93125: etapas visíveis na lista de captações + "Sua vez".
const cap = (status: string, captor_id: string, extra: Record<string, unknown> = {}) =>
  ({ status, captor_id, archived_at: null, ...extra }) as never;

const corretorA: ContextoVez = { userId: "A", admin: false, gestor: false, liderados: new Set() };
// Gestor G lidera A e B (fetchLedMemberIds também inclui o próprio G).
const gestorG: ContextoVez = {
  userId: "G",
  admin: false,
  gestor: true,
  liderados: new Set(["G", "A", "B"]),
};
// Gestor H lidera outra equipe (C), mas a RLS pode mostrar captações de A para ele.
const gestorH: ContextoVez = {
  userId: "H",
  admin: false,
  gestor: true,
  liderados: new Set(["H", "C"]),
};
const admin: ContextoVez = { userId: "Z", admin: true, gestor: false, liderados: new Set() };

describe("etapas da captação", () => {
  it("agrupa os 5 status em 4 etapas", () => {
    expect(etapaCaptacao("rascunho")).toBe("corretor");
    expect(etapaCaptacao("devolvida")).toBe("corretor");
    expect(etapaCaptacao("enviada")).toBe("gestor");
    expect(etapaCaptacao("em_assinatura")).toBe("assinatura");
    expect(etapaCaptacao("aprovada")).toBe("aprovada");
    expect(
      ["rascunho", "enviada", "em_assinatura", "aprovada"].map((s) => indiceEtapa(s as never)),
    ).toEqual([0, 1, 2, 3]);
    expect(indiceEtapa("devolvida")).toBe(0);
  });
});

describe("Sua vez", () => {
  it("corretor: só as próprias em rascunho/devolvida", () => {
    expect(captacaoMinhaVez(cap("rascunho", "A"), corretorA)).toBe(true);
    expect(captacaoMinhaVez(cap("devolvida", "A"), corretorA)).toBe(true);
    expect(captacaoMinhaVez(cap("devolvida", "B"), corretorA)).toBe(false);
    expect(captacaoMinhaVez(cap("enviada", "A"), corretorA)).toBe(false);
    expect(captacaoMinhaVez(cap("em_assinatura", "A"), corretorA)).toBe(false);
    expect(captacaoMinhaVez(cap("aprovada", "A"), corretorA)).toBe(false);
  });

  it("gestor: enviadas da própria equipe e as dele mesmo", () => {
    expect(captacaoMinhaVez(cap("enviada", "A"), gestorG)).toBe(true);
    expect(captacaoMinhaVez(cap("enviada", "G"), gestorG)).toBe(true);
    // Rascunho do liderado é vez do corretor, não do gestor.
    expect(captacaoMinhaVez(cap("rascunho", "A"), gestorG)).toBe(false);
    // Em assinatura: vez do proprietário.
    expect(captacaoMinhaVez(cap("em_assinatura", "A"), gestorG)).toBe(false);
  });

  it("gestor de OUTRA equipe não vê Sua vez (o papel sozinho não basta)", () => {
    expect(podeGerirCaptacao(cap("enviada", "A"), gestorH)).toBe(false);
    expect(captacaoMinhaVez(cap("enviada", "A"), gestorH)).toBe(false);
    expect(captacaoMinhaVez(cap("enviada", "C"), gestorH)).toBe(true);
  });

  it("liderado sem papel de gestor não ganha a vez do gestor", () => {
    const semPapel: ContextoVez = { ...gestorG, gestor: false };
    expect(captacaoMinhaVez(cap("enviada", "A"), semPapel)).toBe(false);
  });

  it("admin: qualquer enviada (igual a exclusive_is_manager)", () => {
    expect(captacaoMinhaVez(cap("enviada", "A"), admin)).toBe(true);
    expect(captacaoMinhaVez(cap("rascunho", "A"), admin)).toBe(false);
  });

  it("arquivada, descartada ou sem usuário nunca é a vez", () => {
    expect(captacaoMinhaVez(cap("enviada", "A", { archived_at: "2026-11-01" }), gestorG)).toBe(
      false,
    );
    expect(captacaoMinhaVez(cap("rascunho", "A", { discarded_at: "2026-11-01" }), corretorA)).toBe(
      false,
    );
    expect(captacaoMinhaVez(cap("rascunho", "A"), { ...corretorA, userId: null })).toBe(false);
  });
});

describe("chips por etapa", () => {
  const lista = [
    cap("rascunho", "A"),
    cap("devolvida", "B"),
    cap("enviada", "A"),
    cap("enviada", "C"),
    cap("em_assinatura", "A"),
    cap("aprovada", "B"),
    cap("aprovada", "A", { archived_at: "2026-11-01" }),
  ];
  it("conta só ativas e a vez de cada um", () => {
    expect(contarEtapas(lista, gestorG)).toEqual({
      minha_vez: 1,
      todas: 6,
      corretor: 2,
      gestor: 2,
      assinatura: 1,
      aprovada: 1,
    });
    expect(contarEtapas(lista, corretorA).minha_vez).toBe(1);
    expect(contarEtapas(lista, gestorH).minha_vez).toBe(1);
  });
  it("filtro bate com o contador", () => {
    const ativas = lista.filter((c: { archived_at: unknown }) => !c.archived_at);
    for (const f of ["minha_vez", "todas", "corretor", "gestor", "assinatura", "aprovada"] as const)
      expect(ativas.filter((c) => noFiltroEtapa(c, f, gestorG))).toHaveLength(
        contarEtapas(lista, gestorG)[f],
      );
  });
});
