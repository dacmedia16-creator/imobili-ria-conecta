// @vitest-environment jsdom
/**
 * Ícone "i" dos painéis de metas 2027 (cartão t_065a0ff9): textos centralizados em explicacoes.ts.
 * Confere: cada texto tem no máximo 2 frases e diz o período; toda explicação é usada em algum painel (e todo
 * "i" dos painéis aponta para uma explicação que existe); o "i" é um botão com aria-label, abre com toque/clique,
 * abre ao passar o mouse e fecha ao tocar fora.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { EXPLICACOES, explicacao, todasExplicacoes, type ChaveExplicacao } from "./explicacoes";
import { InfoDica } from "@/components/metas-2027/InfoDica";
import { ContextoInfo } from "@/components/metas-2027/contexto-info";

const TELAS = [
  "src/components/minha-carreira/PainelMetasCorretor.tsx",
  "src/components/metas-2027/PainelMetasGestor.tsx",
  "src/components/metas-2027/PainelMetasImobiliaria.tsx",
];
const fonte = TELAS.map((f) => readFileSync(f, "utf8")).join("\n");
const frases = (t: string) => t.split(/[.!?](?:\s|$)/).filter((x) => x.trim().length > 0).length;

afterEach(cleanup);

describe("textos do ícone i", () => {
  it("cada texto tem título e no máximo 2 frases, antes e durante 2027", () => {
    for (const ctx of [
      { ano: 2026, anoPlano: 2027 },
      { ano: 2027, anoPlano: 2027 },
    ])
      for (const [k, x] of todasExplicacoes(ctx)) {
        expect(x.titulo.length, k).toBeGreaterThan(0);
        expect(frases(x.texto), `${k}: ${x.texto}`).toBeLessThanOrEqual(2);
        expect(x.texto.length, k).toBeLessThan(330);
      }
  });

  it("toda explicação aparece em algum painel e todo i dos painéis existe no arquivo de textos", () => {
    const usadas = new Set(
      [...fonte.matchAll(/(?:chave|info)=(?:\{)?"([a-z_]+)"/g)].map((m) => m[1]),
    );
    expect([...usadas].filter((k) => !(k in EXPLICACOES))).toEqual([]);
    expect(Object.keys(EXPLICACOES).filter((k) => !usadas.has(k))).toEqual([]);
  });

  it("o ponto de conferência fica explícito: meta só dos assinados, realizado de todos e do ano dos dados", () => {
    const antes = { ano: 2026, anoPlano: 2027 };
    expect(explicacao("equipe_meta_assinados", antes).texto).toMatch(/ASSINADOS/);
    expect(explicacao("equipe_meta_assinados", antes).texto).toMatch(
      /em preenchimento.*não entram/,
    );
    const com = explicacao("equipe_comissao_ano", antes);
    expect(com.titulo).toBe("Comissão em 2026");
    expect(com.texto).toMatch(/TODAS as pessoas.*com ou sem plano assinado/);
    expect(com.texto).toMatch(/não é a bruta/);
    expect(com.texto).toMatch(/ainda não é o realizado da meta 2027/);
    expect(explicacao("equipe_comissao_ano", { ano: 2027, anoPlano: 2027 }).texto).not.toMatch(
      /ainda não é/,
    );
    const v = explicacao("equipe_vendas", antes).texto;
    expect(v).toMatch(/1º número é o realizado de 2026/);
    expect(v).toMatch(/2º é a meta de transações de 2027/);
    expect(explicacao("equipe_vgv", antes).texto).toMatch(/conta 1 vez/);
  });
});

function abrir(chave: ChaveExplicacao) {
  render(
    createElement(
      ContextoInfo.Provider,
      { value: { ano: 2026, anoPlano: 2027 } },
      createElement(
        "div",
        null,
        createElement("p", null, "fora"),
        createElement(InfoDica, { chave }),
      ),
    ),
  );
  return screen.getByRole("button", { name: /O que é: Meta 2027 \(assinados\)/ });
}

describe("componente InfoDica", () => {
  it("é um botão com aria-label; abre no toque/clique e fecha ao tocar fora", async () => {
    const b = abrir("equipe_meta_assinados");
    expect(b.getAttribute("type")).toBe("button");
    expect(screen.queryByTestId("info-balao")).toBeNull();
    fireEvent.click(b);
    const balao = await screen.findByTestId("info-balao");
    expect(balao.textContent).toMatch(/planos 2027 já ASSINADOS/);
    // Radix registra o "tocar fora" no próximo ciclo.
    await act(() => new Promise((r) => setTimeout(r, 0)));
    fireEvent.pointerDown(screen.getByText("fora"));
    await waitFor(() => expect(screen.queryByTestId("info-balao")).toBeNull());
  });

  it("toque de novo no i fecha; Esc também fecha", async () => {
    const b = abrir("equipe_meta_assinados");
    fireEvent.click(b);
    await screen.findByTestId("info-balao");
    fireEvent.click(b);
    await waitFor(() => expect(screen.queryByTestId("info-balao")).toBeNull());
    fireEvent.click(b);
    await screen.findByTestId("info-balao");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("info-balao")).toBeNull());
  });

  it("computador: abre ao passar o mouse e fecha ao sair; toque (não mouse) não abre por passar", async () => {
    // jsdom não tem PointerEvent: cria um com pointerType (o React emula enter/leave com over/out).
    if (
      !("PointerEvent" in window) ||
      !new window.PointerEvent("x", { pointerType: "mouse" }).pointerType
    )
      (window as unknown as { PointerEvent: unknown }).PointerEvent = class extends MouseEvent {
        pointerType: string;
        constructor(t: string, i: PointerEventInit = {}) {
          super(t, i);
          this.pointerType = i.pointerType ?? "";
        }
      };
    const b = abrir("equipe_meta_assinados");
    fireEvent.pointerOver(b, { pointerType: "touch" });
    expect(screen.queryByTestId("info-balao")).toBeNull();
    fireEvent.pointerOut(b, { pointerType: "touch" });
    fireEvent.pointerOver(b, { pointerType: "mouse" });
    await screen.findByTestId("info-balao");
    fireEvent.pointerOut(b, { pointerType: "mouse" });
    await waitFor(() => expect(screen.queryByTestId("info-balao")).toBeNull());
  });
});
