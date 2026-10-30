import { describe, expect, it, vi } from "vitest";
import {
  apagarArquivoSemUso,
  caminhoDaCaptacao,
  type DependenciasArquivo,
} from "./captacao-remover-documento";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";
const CAP = "33333333-3333-4333-8333-333333333333";
const ARQ = `${ORG}/${CAP}/44444444-4444-4444-8444-444444444444.pdf`;

const deps = (over: Partial<DependenciasArquivo> = {}) => {
  const apagar = vi.fn(async () => ({ erro: null as string | null }));
  return {
    apagar,
    d: {
      orgDoUsuario: async () => ORG,
      caminhoEmUso: async () => false,
      apagarArquivo: apagar,
      ...over,
    } as DependenciasArquivo,
  };
};

describe("caminhoDaCaptacao", () => {
  it("aceita só <org>/<captação>/<uuid>.<ext>", () => {
    expect(caminhoDaCaptacao(ARQ, ORG, CAP)).toBe(true);
    expect(caminhoDaCaptacao(ARQ.replace(".pdf", ".jpg"), ORG, CAP)).toBe(true);
    expect(caminhoDaCaptacao(ARQ, OUTRA, CAP)).toBe(false);
    expect(
      caminhoDaCaptacao(`${ORG}/${CAP}/plano/44444444-4444-4444-8444-444444444444.pdf`, ORG, CAP),
    ).toBe(false);
    expect(caminhoDaCaptacao(`${ORG}/${CAP}/../x.pdf`, ORG, CAP)).toBe(false);
    expect(caminhoDaCaptacao(ARQ.replace(".pdf", ".exe"), ORG, CAP)).toBe(false);
    expect(caminhoDaCaptacao(ARQ, ORG, "x")).toBe(false);
  });
});

describe("apagarArquivoSemUso", () => {
  it("apaga arquivo da captação que ninguém mais usa", async () => {
    const { d, apagar } = deps();
    expect(await apagarArquivoSemUso(d, CAP, ARQ)).toBe("apagado");
    expect(apagar).toHaveBeenCalledWith(ARQ);
  });
  it("não apaga arquivo de outra imobiliária", async () => {
    const { d, apagar } = deps({ orgDoUsuario: async () => OUTRA });
    expect(await apagarArquivoSemUso(d, CAP, ARQ)).toBe("ignorado");
    expect(apagar).not.toHaveBeenCalled();
  });
  it("não apaga sem organização", async () => {
    const { d, apagar } = deps({ orgDoUsuario: async () => null });
    expect(await apagarArquivoSemUso(d, CAP, ARQ)).toBe("ignorado");
    expect(apagar).not.toHaveBeenCalled();
  });
  it("não apaga arquivo ainda registrado em um documento", async () => {
    const { d, apagar } = deps({ caminhoEmUso: async () => true });
    expect(await apagarArquivoSemUso(d, CAP, ARQ)).toBe("ignorado");
    expect(apagar).not.toHaveBeenCalled();
  });
  it("erro do Storage não derruba a remoção", async () => {
    const { d } = deps({ apagarArquivo: async () => ({ erro: "falhou" }) });
    expect(await apagarArquivoSemUso(d, CAP, ARQ)).toBe("ignorado");
  });
});
