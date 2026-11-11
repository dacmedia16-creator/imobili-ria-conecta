// @vitest-environment jsdom
/**
 * Ícone "i" dos quadros do Início / Minha carreira (cartão t_f39620c8). Dados fictícios.
 * - os números citados nos textos batem com as regras reais (não inventados);
 * - todo estado possível de selo do termômetro tem explicação;
 * - o "i" aparece nos quadros, abre no toque/clique, tem nome acessível e fecha com Esc;
 * - os quadros que já tinham "i" não ganham outro (não duplicar).
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) =>
    createElement("a", { href: to }, children as never),
  createFileRoute: () => (o: unknown) => o,
  redirect: (o: unknown) => o,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ hasAny: () => false }) }));

import { EXPLICA_FAROL, EXPLICA_QUADRO, explicaSinal } from "./explicacoes-quadros";
import {
  DIAS_NOVO,
  FAROL_ROTULO,
  GESTAO_AVISO_DIAS,
  farolGeral,
  sinalAtividade,
  sinalCaptacoes,
  sinalGestoes,
  sinalLeads,
  sinalSemVender,
  type ChaveSinal,
  type Sinal,
} from "./inteligencia-gestao";
import { nivelSemVender } from "./painel-equipe-calc";
import { faixa } from "./meta-atividades";
import { MeuTermometro, MinhaProxima1a1 } from "@/components/gestao/MinhaGestao";
import { InfoDot } from "@/components/dashboard/shared";

afterEach(cleanup);

const CHAVES: ChaveSinal[] = ["sem_vender", "atividade", "leads", "gestoes", "captacoes"];

describe("textos batem com as regras", () => {
  it("dias sem vender: 14 verde, 15-30 amarelo, >30 ou nunca vermelho", () => {
    expect(nivelSemVender(14)).toBe("ok");
    expect(nivelSemVender(15)).toBe("atencao");
    expect(nivelSemVender(30)).toBe("atencao");
    expect(nivelSemVender(31)).toBe("alerta");
    expect(nivelSemVender(null)).toBe("alerta");
    expect(explicaSinal({ chave: "sem_vender", cor: "verde" })).toMatch(
      /Até 14 dias.*de 15 a 30.*acima de 30/,
    );
  });
  it("faixas de atividade/captações: 100% verde, 70% amarelo", () => {
    expect(faixa(1, 1)).toBe("verde");
    expect(faixa(0.7, 1)).toBe("amarelo");
    expect(faixa(0.69, 1)).toBe("vermelho");
    expect(explicaSinal({ chave: "atividade", cor: "verde" })).toMatch(/100%.*70%/);
  });
  it("gestões e novo usam as constantes reais", () => {
    expect(explicaSinal({ chave: "gestoes", cor: "amarelo" })).toContain(
      `${GESTAO_AVISO_DIAS} dias`,
    );
    expect(EXPLICA_FAROL.novo).toContain(`${DIAS_NOVO} dias`);
  });
  it("farol: regra das cores igual à de farolGeral", () => {
    const s = (cor: Sinal["cor"]): Sinal => ({ chave: "leads", cor, texto: "" });
    expect(farolGeral([s("vermelho"), s("vermelho")], 100)).toBe("risco");
    expect(farolGeral([s("vermelho")], 100)).toBe("atencao");
    expect(farolGeral([s("amarelo"), s("amarelo")], 100)).toBe("atencao");
    expect(farolGeral([s("amarelo")], 100)).toBe("tranquilo");
    expect(farolGeral([], DIAS_NOVO - 1)).toBe("novo");
  });
});

describe("todo selo possível tem explicação", () => {
  it("todos os estados do termômetro", () => {
    const hoje = "2026-11-09";
    const todos: Sinal[] = [
      sinalSemVender(null),
      sinalSemVender(3),
      sinalAtividade({ ligacoes: 0, v1: 0, v2: 0, acm: 0, captMes: 0 } as never, null),
      sinalLeads(null, null, new Date()),
      sinalGestoes(null, hoje),
      sinalGestoes([], hoje),
      sinalCaptacoes(0, null, hoje),
    ];
    for (const s of todos) expect(explicaSinal(s).length).toBeGreaterThan(20);
    for (const c of CHAVES)
      for (const cor of [
        "verde",
        "amarelo",
        "vermelho",
        "sem_plano",
        "sem_dado",
        "aguardando",
      ] as const)
        expect(explicaSinal({ chave: c, cor })).toBeTruthy();
    for (const f of Object.keys(FAROL_ROTULO)) expect(EXPLICA_FAROL[f as never]).toBeTruthy();
  });
  it("textos curtos (até 2 frases, sem jargão técnico)", () => {
    const todos = [
      ...Object.values(EXPLICA_QUADRO),
      ...Object.values(EXPLICA_FAROL),
      ...CHAVES.flatMap((c) =>
        (["verde", "sem_plano", "sem_dado"] as const).map((cor) => explicaSinal({ chave: c, cor })),
      ),
    ];
    for (const t of todos) {
      expect(t.length).toBeLessThanOrEqual(260);
      expect(t).not.toMatch(/RPC|RLS|status|query|banco de dados|farol/i);
    }
  });
});

describe("ícone na tela", () => {
  it("InfoDot: abre no toque, tem nome e descrição acessíveis, fecha com Esc", () => {
    render(createElement(InfoDot, { text: "Explica", label: "O que é este quadro" }));
    const b = screen.getByRole("button", { name: "O que é este quadro" });
    expect(b.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(b);
    expect(b.getAttribute("aria-expanded")).toBe("true");
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(b.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.className).toContain("opacity-100");
    fireEvent.keyDown(b, { key: "Escape" });
    expect(b.getAttribute("aria-expanded")).toBe("false");
  });
  it("InfoDot sem label continua com o nome antigo (cards de número)", () => {
    render(createElement(InfoDot, { text: "x" }));
    expect(screen.getByRole("button", { name: "Como esse número foi calculado" })).toBeTruthy();
  });
  it("Meu termômetro: 1 i no quadro + 1 na cor + 1 por sinal", () => {
    const linha = {
      user_id: "u",
      nome: "Ana",
      farol: "novo" as const,
      sinais: [
        sinalSemVender(null),
        sinalAtividade({} as never, null),
        sinalLeads(null, null, new Date()),
        sinalGestoes([], "2026-11-09"),
        sinalCaptacoes(0, null, "2026-11-09"),
      ],
      acesos: [],
      diasNaEquipe: 10,
      metaDe: null,
    };
    render(createElement(MeuTermometro, { linha }));
    const c = screen.getByTestId("meu-termometro");
    expect(within(c).getAllByRole("button", { name: "O que é este quadro" })).toHaveLength(1);
    expect(within(c).getAllByRole("button", { name: "O que significa esta cor" })).toHaveLength(1);
    expect(within(c).getAllByRole("button", { name: "O que significa este sinal" })).toHaveLength(
      5,
    );
    expect(c.textContent).toContain(EXPLICA_FAROL.novo);
    expect(c.textContent).toContain(explicaSinal({ chave: "gestoes", cor: "verde" }));
  });
  it("Minha próxima 1:1: tem o i", () => {
    render(createElement(MinhaProxima1a1, { ultima: null, hoje: "2026-11-09" }));
    const c = screen.getByTestId("minha-proxima-1a1");
    expect(within(c).getByRole("button", { name: "O que é este quadro" })).toBeTruthy();
    expect(c.textContent).toContain(EXPLICA_QUADRO.minhaProxima1a1);
  });
  it("Início e Minha carreira usam o i nos quadros sem explicação (sem duplicar)", () => {
    const dash = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
    for (const k of ["comissaoPrevista", "situacaoVendas", "vendasRecentes", "movimentacaoPeriodo"])
      expect(dash.match(new RegExp(`EXPLICA_QUADRO\\.${k}\\b`, "g"))).toHaveLength(1);
    const carreira = readFileSync("src/routes/_authenticated/minha-carreira.tsx", "utf8");
    expect(carreira.match(/EXPLICA_QUADRO\.oQueFazerHoje/g)).toHaveLength(1);
    // Um único componente de explicação no projeto (InfoDot), sem cópia nova.
    const shared = readFileSync("src/components/dashboard/shared.tsx", "utf8");
    expect(shared.match(/export function InfoDot/g)).toHaveLength(1);
  });
});
