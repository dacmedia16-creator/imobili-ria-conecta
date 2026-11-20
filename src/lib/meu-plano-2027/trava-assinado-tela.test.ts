// @vitest-environment jsdom
/**
 * Plano assinado na TELA (t_850a0d39): com `travado`, todo campo de meta/cálculo fica desabilitado em todas as
 * telas e os campos de acompanhamento (p43, p44, p50, p51) continuam editáveis. Sem `travado` (em preenchimento
 * ou reaberto), nada muda.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { calc, type Respostas } from "./regras";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";
import { ORDEM } from "./telas";
import { TELAS_LIVRES, campoLivre } from "./trava-assinado";

const S: Respostas = {
  "d.conv": "42",
  "d.ticket": "700.000",
  "d.ativos": "15",
  "op.0": "3.000",
  "es.aliq": "10",
  "m.faixa": "60",
  "m.pct": "3",
  "mt.tCapt": "12",
  "mt.tVenda": "8",
};

function tela(id: string, travado: boolean) {
  const ctx = { S, C: calc(S), set: () => undefined, ro: false, travado, inicio: null };
  return render(createElement(PlanoCtx.Provider, { value: ctx }, createElement(CorpoTela, { id })));
}
const campos = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLInputElement>("[data-k]")].map((el) => ({
    k: el.getAttribute("data-k")!,
    disabled: el.disabled,
  }));

window.scrollTo = () => undefined;
afterEach(cleanup);

describe("plano assinado na tela", () => {
  it("assinado: em todas as telas, só os campos livres ficam editáveis", () => {
    let travados = 0;
    let livres = 0;
    for (const id of ORDEM) {
      const { container, unmount } = tela(id, true);
      for (const x of campos(container)) {
        expect(x.disabled, `${id} ${x.k}`).toBe(!campoLivre(x.k));
        if (x.disabled) travados++;
        else livres++;
      }
      unmount();
    }
    expect(travados).toBeGreaterThan(100);
    expect(livres).toBeGreaterThan(30);
  });

  it("telas de acompanhamento seguem 100% editáveis", () => {
    for (const id of TELAS_LIVRES) {
      const { container, unmount } = tela(id, true);
      const xs = campos(container);
      expect(xs.length, id).toBeGreaterThan(0);
      expect(
        xs.filter((x) => x.disabled),
        id,
      ).toEqual([]);
      unmount();
    }
  });

  it("assinado: some o botão 'Voltar tudo para a sugestão' da distribuição mês a mês", () => {
    const { container } = tela("p32", true);
    expect(container.querySelector("[data-testid^='dist-limpar-']")).toBeNull();
  });

  it("em preenchimento/reaberto: nenhum campo desabilitado", () => {
    for (const id of ORDEM) {
      const { container, unmount } = tela(id, false);
      expect(
        campos(container).filter((x) => x.disabled),
        id,
      ).toEqual([]);
      unmount();
    }
  });
});
