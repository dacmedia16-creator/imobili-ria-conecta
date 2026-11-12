// @vitest-environment jsdom
/**
 * Meu Plano 2027 (cartão t_991ba51f): bolinha "i" com o "como preencher" em cada parte dos exercícios,
 * nas duas trilhas. Renderiza as telas com respostas fictícias, sem banco.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { calc, type Respostas } from "./regras";
import { AJUDA } from "./ajuda";
import { ORDEM, tela as telaInfo } from "./telas";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";

const S: Respostas = { "d.ticket": "700.000", "d.conv": "22", "m.faixa": "45", "m.pct": "3" };

function tela(id: string, trilha: "ativacao" | "planejamento" = "planejamento") {
  const ctx = { S, C: calc(S), set: () => undefined, ro: false, inicio: null, trilha };
  return render(createElement(PlanoCtx.Provider, { value: ctx }, createElement(CorpoTela, { id })));
}
const dicas = (c: HTMLElement) => within(c).queryAllByRole("button", { name: /^Como preencher: / });

/** Telas que só mostram contas montadas de outras telas, sem nada para preencher. */
const SEM_CAMPO = new Set(["p52"]);

afterEach(cleanup);

describe("bolinha 'como preencher'", () => {
  for (const t of ["planejamento", "ativacao"] as const)
    it(`toda tela de exercício da trilha ${t} tem pelo menos uma bolinha`, () => {
      for (const id of ORDEM[t]) {
        if (SEM_CAMPO.has(id)) continue;
        const { container, unmount } = tela(id, t);
        expect(dicas(container).length, `${id} · ${telaInfo(id)?.t}`).toBeGreaterThan(0);
        unmount();
      }
    });

  it("todo texto do arquivo é usado em alguma tela, e nenhuma tela pede texto que não existe", () => {
    const usados = new Set<string>();
    for (const id of new Set([...ORDEM.planejamento, ...ORDEM.ativacao])) {
      const { container, unmount } = tela(id);
      for (const b of dicas(container)) {
        const nome = b.getAttribute("aria-label")!.replace("Como preencher: ", "");
        const chave = Object.keys(AJUDA).find(
          (k) => AJUDA[k as keyof typeof AJUDA].nome === nome && k.startsWith(`${id}.`),
        );
        expect(chave, `${id}: "${nome}"`).toBeTruthy();
        usados.add(chave!);
      }
      unmount();
    }
    expect([...usados].sort()).toEqual(Object.keys(AJUDA).sort());
  });

  it("texto curto (1 a 3 frases) e com a fonte indicada", () => {
    for (const [k, a] of Object.entries(AJUDA)) {
      // fim de frase = ponto seguido de maiúscula ("pág. 29" e "ex.: terça" não contam)
      const frases = a.t.split(/[.!?]\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ“])/).filter((x) => x.trim()).length;
      expect(frases, k).toBeGreaterThanOrEqual(1);
      expect(frases, k).toBeLessThanOrEqual(3);
      expect(a.fonte, k).toMatch(/Book págs?\.|texto nosso/);
    }
  });

  it("abre no toque/clique e fecha no Esc, com o texto ligado ao botão (leitor de tela)", () => {
    const { container } = tela("p37");
    const b = within(container).getByRole("button", { name: "Como preencher: Taxa de folga" });
    expect(b.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(b);
    expect(b.getAttribute("aria-expanded")).toBe("true");
    const dica = document.getElementById(b.getAttribute("aria-describedby")!)!;
    expect(dica.getAttribute("role")).toBe("tooltip");
    expect(dica.textContent).toBe(AJUDA["p37.folga"].t);
    fireEvent.keyDown(b, { key: "Escape" });
    expect(b.getAttribute("aria-expanded")).toBe("false");
  });

  it("tocar na bolinha não foca o campo (fica fora do <label>)", () => {
    const { container } = tela("p30");
    const b = within(container).getByRole("button", {
      name: "Como preencher: Minha conversão da captação",
    });
    expect(b.closest("label")).toBeNull();
    // o campo continua com o nome do próprio rótulo, sem o texto da dica
    expect(screen.getByLabelText("2 · Minha conversão da captação (%)")).toBeTruthy();
  });

  it("explicação que já estava na tela foi movida, não duplicada", () => {
    const txt = (id: string) => tela(id).container.textContent ?? "";
    // taxa de folga: só na bolinha
    expect(txt("p37").split("É uma taxa, não o resultado").length - 1).toBe(1);
    cleanup();
    // dia de revisão: só na bolinha
    expect(txt("p36").split("Trate como reunião com cliente").length - 1).toBe(0);
    cleanup();
    // "De onde vem cada número" continua na tela de metas, sem cópia na bolinha
    const m = txt("p32");
    expect(m).toContain("De onde vem cada número");
    expect(Object.values(AJUDA).some((a) => a.t.includes("De onde vem cada número"))).toBe(false);
  });
});
