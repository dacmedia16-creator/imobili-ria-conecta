// @vitest-environment jsdom
/**
 * Painel de metas do corretor (cartão t_2fa76ce2) — tela com banco e data simulados, sem tocar produção.
 * Confere: barras do ano e do mês, quanto falta, farol, lista de cumpridas, comissão sem bruta e anotações.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { comGravada } from "@/lib/metas-2027/teste-gravada";

type Linhas = Record<string, unknown>[] | Record<string, unknown> | null;
let tabelas: Record<string, Linhas> = {};
let moduloOn = true;
const rpc = vi.fn();
const inseridos: Record<string, unknown>[] = [];

function cadeia(tabela: string) {
  const dados = () => tabelas[tabela] ?? (tabela === "carreira_plano" ? null : []);
  const c: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "is", "or", "gte", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => {
    const d = dados();
    return { data: Array.isArray(d) ? (d[0] ?? null) : d, error: null };
  };
  c.then = (ok: (v: unknown) => unknown) => {
    const d = dados();
    return Promise.resolve({ data: Array.isArray(d) ? d : d ? [d] : [], error: null }).then(ok);
  };
  c.insert = async (row: Record<string, unknown>) => {
    inseridos.push({ tabela, ...row });
    const atual = (tabelas[tabela] as Record<string, unknown>[]) ?? [];
    tabelas[tabela] = [
      { id: `n${inseridos.length}`, created_at: "2027-03-16T15:00:00Z", ...row },
      ...atual,
    ];
    return { error: null };
  };
  c.delete = () => ({ eq: async () => ({ error: null }) });
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (t: string) => cadeia(t) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) =>
    createElement("a", { href: to }, children as never),
  redirect: (o: unknown) => o,
}));

import { PainelMetasCorretor } from "@/components/minha-carreira/PainelMetasCorretor";

const PLANO: Respostas = {
  "mt.creIni": "10",
  "mt.novas": "24",
  "mt.canc": "6",
  "mt.vendidas": "12",
  "mt.tCapt": "12",
  "mt.tVenda": "12",
  "mt.comMedia": "5000",
  "m.ticket": "400000",
};
const VENDAS = [
  {
    sale_id: "s1",
    venda_em: "2027-03-05",
    imovel: "Apto 2 dorms · Centro",
    codigo: "QA-1042",
    papel: "vendedor",
    vgv: 400000,
    minha_parte: 4000,
    lados: 1,
    indicador: 800,
    extras: 200,
    descontado: 1000,
  },
  {
    sale_id: "s0",
    venda_em: "2027-01-20",
    imovel: "Casa · Jardim",
    codigo: null,
    papel: "captador",
    vgv: 600000,
    minha_parte: 12000,
    lados: 1,
    indicador: 0,
    extras: 0,
    descontado: 0,
  },
];

function data(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${iso}T15:00:00Z`));
}

beforeEach(() => {
  moduloOn = true;
  inseridos.length = 0;
  tabelas = {
    // A assinatura grava a meta oficial (fonte única, t_91ec7aa3).
    carreira_plano: {
      respostas: PLANO,
      assinado_corretor_em: "2026-12-10T13:00:00Z",
      ...comGravada(PLANO),
    },
    exclusive_captures: [
      {
        id: "c1",
        signed_on: "2027-03-10",
        captor_id: "00000000-0000-4000-8000-0000000000a1",
        captador_original_id: null,
        tipo: "Casa térrea",
        bairro: "Parque",
      },
    ],
    exclusive_history: [],
    carreira_anotacoes: [],
  };
  rpc.mockImplementation((fn: string, args: Record<string, string>) => {
    if (fn === "meu_plano_2027_enabled") return Promise.resolve({ data: moduloOn, error: null });
    if (fn === "meu_realizado") {
      const mes = args._inicio.endsWith("-03-01");
      return Promise.resolve({
        data: [{ comissao: 0, vgv: 0, vendas: 0, captacoes: mes ? 1 : 3 }],
        error: null,
      });
    }
    if (fn === "minha_comissao_vendas") return Promise.resolve({ data: VENDAS, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rpc.mockReset();
});

describe("Painel de metas do corretor (substitui o Meu mês)", () => {
  it("plano assinado em março/2027: barras do ano e do mês, falta por semana e farol", async () => {
    data("2027-03-16");
    render(createElement(PainelMetasCorretor, { userId: "00000000-0000-4000-8000-0000000000a1" }));
    const ano = await screen.findByTestId("barra-ano");
    expect(ano.textContent).toMatch(/R\$\s?16\.000/);
    expect(ano.textContent).toMatch(/de R\$\s?120\.000/);
    const mes = screen.getByTestId("barra-mes");
    expect(mes.textContent).toContain("Meta de março");
    expect(mes.textContent).toMatch(/de R\$\s?10\.000/);
    expect(screen.getByTestId("falta-mes").textContent).toMatch(
      /Falta no mês: R\$\s?6\.000 · por semana: R\$\s?2\.000 \(3 semanas restantes\)/,
    );
    expect(screen.getByTestId("farol-meta").textContent).toContain("🔴");
    expect(screen.getByTestId("barras-menores").textContent).toContain("Captações no ano3");
    // Ícone "i" em cada número (t_065a0ff9).
    for (const k of [
      "corretor_farol",
      "corretor_barra_ano",
      "corretor_ritmo",
      "corretor_barra_mes",
      "corretor_falta_mes",
      "corretor_vendas_ano",
      "corretor_captacoes_ano",
      "corretor_vgv_ano",
    ])
      expect(screen.getByTestId(`info-${k}`).getAttribute("aria-label"), k).toMatch(/^O que é: /);
  });

  it("lista de cumpridas com data e imóvel; comissão mostra só a parte dele e o descontado dele", async () => {
    data("2027-03-16");
    render(createElement(PainelMetasCorretor, { userId: "00000000-0000-4000-8000-0000000000a1" }));
    const lista = await screen.findByTestId("cumpridas");
    const t = lista.textContent ?? "";
    expect(t).toContain("10/mar");
    expect(t).toContain("📌 Captação");
    expect(t).toContain("Casa térrea · Parque");
    expect(t).toContain("05/mar");
    expect(t).toContain("Apto 2 dorms · Centro · QA-1042");
    expect(t).toMatch(/Sua parte: R\$\s?4\.000/);
    expect(t).toMatch(/descontado de você: R\$\s?1\.000 \(indicador R\$\s?800, extras R\$\s?200\)/);
    expect(t).not.toMatch(/bruta/i);
    expect(t).not.toMatch(/imobiliária/i);
    expect(screen.getByTestId("total-comissao").textContent).toMatch(/R\$\s?16\.000/);
  });

  it("sem plano assinado: ⚪, convite para assinar e sem barras de meta", async () => {
    data("2027-03-16");
    tabelas.carreira_plano = { respostas: PLANO, assinado_corretor_em: null };
    render(createElement(PainelMetasCorretor, { userId: "00000000-0000-4000-8000-0000000000a1" }));
    const farol = await screen.findByTestId("farol-meta");
    expect(farol.textContent).toContain("⚪ Sem meta oficial");
    expect(screen.queryByTestId("barra-ano")).toBeNull();
    expect(screen.getByTestId("painel-metas-corretor").textContent).toContain("em preenchimento");
  });

  it("antes de jan/2027: ⚪ aguardando e números do ano corrente, sem barra de meta", async () => {
    data("2026-11-19");
    render(createElement(PainelMetasCorretor, { userId: "00000000-0000-4000-8000-0000000000a1" }));
    const aviso = await screen.findByTestId("antes-vigencia");
    expect(aviso.textContent).toMatch(/Sua meta de 2027 é R\$\s?120\.000/);
    expect(screen.getByTestId("farol-meta").textContent).toContain("jan/2027");
    expect(screen.queryByTestId("barra-ano")).toBeNull();
    const chamadas = rpc.mock.calls.filter((c) => c[0] === "minha_comissao_vendas");
    expect(chamadas[0][1]).toEqual({ _inicio: "2026-01-01", _fim: "2026-12-31" });
  });

  it("módulo do plano desligado: não lê o plano e fica ⚪", async () => {
    data("2027-03-16");
    moduloOn = false;
    render(createElement(PainelMetasCorretor, { userId: "00000000-0000-4000-8000-0000000000a1" }));
    const farol = await screen.findByTestId("farol-meta");
    expect(farol.textContent).toContain("⚪");
  });

  it("anotações: salva texto, próximo passo e data; não grava meta", async () => {
    data("2027-03-16");
    render(createElement(PainelMetasCorretor, { userId: "00000000-0000-4000-8000-0000000000a1" }));
    await screen.findByText("Nenhuma anotação ainda.");
    fireEvent.change(screen.getByLabelText("O que fiz / com quem falei"), {
      target: { value: "Liguei para o proprietário do apto do Centro" },
    });
    fireEvent.change(screen.getByLabelText("Próximo passo"), { target: { value: "Levar ACM" } });
    fireEvent.change(screen.getByLabelText("Data do próximo passo"), {
      target: { value: "2027-03-20" },
    });
    fireEvent.click(screen.getByText("Salvar anotação"));
    await waitFor(() => expect(screen.getAllByTestId("anotacao")).toHaveLength(1));
    expect(inseridos).toEqual([
      {
        tabela: "carreira_anotacoes",
        texto: "Liguei para o proprietário do apto do Centro",
        proximo_passo: "Levar ACM",
        proximo_passo_em: "2027-03-20",
      },
    ]);
    expect(screen.getByTestId("anotacao").textContent).toContain("Levar ACM · 20/03/2027");
    expect(inseridos.some((x) => x.tabela === "minhas_metas")).toBe(false);
  });
});
