// @vitest-environment jsdom
/**
 * Meu Plano 2027 (cartão t_1bce8b3d): número da carteira alvo (book pág. 30) e quadro de KRIs (PDF 11).
 * Renderiza as telas com respostas fictícias, sem banco.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { calc, type Respostas } from "./regras";
import { progresso } from "./telas";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";

const S: Respostas = {
  "d.conv": "42",
  "d.ticket": "700.000",
  "d.ativos": "15",
  "d.dias": "90",
  "op.0": "3.000",
  "es.aliq": "10",
  "m.faixa": "60",
  "m.pct": "3",
};

function tela(id: string, R: Respostas = S) {
  const ctx = {
    S: R,
    C: calc(R),
    set: () => undefined,
    ro: true,
    inicio: null,
    trilha: "planejamento" as const,
  };
  return render(createElement(PlanoCtx.Provider, { value: ctx }, createElement(CorpoTela, { id })));
}

afterEach(cleanup);

describe("carteira alvo: número de CREs ativas (book pág. 30)", () => {
  it("campo numérico acima das 3 opções", () => {
    const { container } = tela("p31");
    const txt = container.textContent ?? "";
    const campo = txt.indexOf("Quantas CREs ativas quero manter ao longo de 2027");
    expect(campo).toBeGreaterThan(-1);
    expect(campo).toBeLessThan(txt.indexOf("11 a 15 CREs ativas"));
    expect(container.querySelector('input[data-k="m.carteira"]')).toBeTruthy();
  });

  it("é só registro: não muda nenhuma conta nem o % preenchido", () => {
    const com = { ...S, "m.carteira": "17" };
    expect(calc(com)).toEqual(calc(S));
    expect(progresso(com, "planejamento")).toEqual(progresso(S, "planejamento"));
    expect(progresso(com, "ativacao")).toEqual(progresso(S, "ativacao"));
  });
});
