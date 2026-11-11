// @vitest-environment jsdom
/**
 * Meu Plano 2027 — vigência nas telas do corretor (cartão t_365eb6c2, Denis 11/11). Banco simulado e
 * data simulada (vi.setSystemTime), sem tocar produção:
 * - Sua semana antes de 01/01/2027: feito + aviso, sem barra de meta; a partir de 2027: feito x meta.
 * - V1/V2/visita com comprador continuam disponíveis antes da vigência.
 * - Meu mês em 2027: travado para quem tem plano assinado; livre sem plano; 2026 e módulo desligado iguais.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { Respostas } from "./regras";

type Linhas = Record<string, unknown>[] | Record<string, unknown> | null;
let tabelas: Record<string, Linhas> = {};
let moduloOn = true;
const rpc = vi.fn();

function cadeia(tabela: string) {
  const dados = () => tabelas[tabela] ?? (tabela === "carreira_plano" ? null : []);
  const c: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "is", "gte", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => {
    const d = dados();
    return { data: Array.isArray(d) ? (d[0] ?? null) : d, error: null };
  };
  c.then = (ok: (v: unknown) => unknown) => {
    const d = dados();
    return Promise.resolve({ data: Array.isArray(d) ? d : d ? [d] : [], error: null }).then(ok);
  };
  c.insert = async () => ({ error: null });
  c.update = () => ({ eq: async () => ({ error: null }) });
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
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ hasAny: () => false }) }));

import { MeuMes } from "@/components/minha-carreira/MeuMes";
import { Diario } from "@/components/minha-carreira/Diario";

const ANA: Respostas = {
  "d.comissao": "210000",
  "d.trans": "11",
  "d.conv": "22",
  "d.ticket": "700000",
  "d.dias": "118",
  "d.ativos": "14",
  "op.0": "3450",
  "op.1": "760",
  "op.2": "1080",
  "op.3": "1600",
  "op.4": "600",
  "op.5": "940",
  "op.6": "110",
  "op.7": "30",
  "on.0": "980",
  "on.1": "200",
  "on.2": "1350",
  "on.3": "59,99",
  "on.4": "570",
  "on.5": "200",
  "so.0.v": "40000",
  "so.1.v": "30000",
  "so.2.v": "5000",
  "es.aliq": "15",
  "m.faixa": "45",
  "m.ticket": "700000",
  "m.pct": "3",
  "m.conv": "22",
  "fu.v2cre": "50",
  "fu.v1v2": "60",
  "fu.folga": "25",
};

const REALIZADO = { comissao: 0, vgv: 0, vendas: 0, captacoes: 0 };
const CONTAGENS = [
  { tipo: "ligacao", hoje: 2, semana: 5, mes: 9 },
  { tipo: "v1", hoje: 1, semana: 2, mes: 3 },
  { tipo: "v2", hoje: 0, semana: 1, mes: 1 },
];

function data(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${iso}T15:00:00Z`));
}

beforeEach(() => {
  moduloOn = true;
  tabelas = {};
  rpc.mockImplementation((fn: string) => {
    if (fn === "meu_plano_2027_enabled") return Promise.resolve({ data: moduloOn, error: null });
    if (fn === "meu_realizado") return Promise.resolve({ data: [REALIZADO], error: null });
    if (fn === "meu_diario_contagens") return Promise.resolve({ data: CONTAGENS, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rpc.mockReset();
});

const assinado = { respostas: ANA, assinado_corretor_em: "2026-11-18T13:00:00Z" };

describe("Sua semana (Diário) e a vigência de 01/01/2027", () => {
  it("antes de 2027 com plano: feito + aviso, sem barra de meta; V1/V2/comprador disponíveis", async () => {
    data("2026-11-18");
    tabelas.carreira_plano = assinado;
    render(createElement(Diario, { userId: "u1" }));
    const s = await screen.findByTestId("semana-feito");
    expect(s.textContent).toContain("Ligações: 5 na semana · 9 no mês");
    expect(screen.getByTestId("aviso-vigencia").textContent).toBe(
      "Suas metas do Meu Plano 2027 valem a partir de janeiro",
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByTestId("semana-v1")).toBeNull();
    for (const t of ["v1", "v2", "visita_comprador"])
      expect(screen.getByTestId(`registrar-${t}`)).toBeTruthy();
  });

  it("a partir de 01/01/2027: feito x meta do plano (barras com cor)", async () => {
    data("2027-01-04");
    tabelas.carreira_plano = assinado;
    render(createElement(Diario, { userId: "u1" }));
    await waitFor(() => expect(screen.getByTestId("semana-ligacoes")).toBeTruthy());
    expect(screen.getByTestId("semana-ligacoes").textContent).toContain("5 de 12");
    expect(screen.queryByTestId("aviso-vigencia")).toBeNull();
  });

  it("módulo desligado: sem Sua semana (igual a hoje)", async () => {
    data("2026-11-18");
    moduloOn = false;
    tabelas.carreira_plano = assinado;
    render(createElement(Diario, { userId: "u1" }));
    await waitFor(() => expect(screen.getByTestId("diario")).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("Registrar")).toBeTruthy());
    expect(screen.queryByTestId("sua-semana")).toBeNull();
    expect(screen.queryByTestId("aviso-vigencia")).toBeNull();
  });
});

describe("Meu mês: meta do mês em 2027 vem do plano assinado", () => {
  it("2027 com plano assinado: campo travado, meta do plano e aviso", async () => {
    data("2027-03-10");
    tabelas.carreira_plano = assinado;
    render(createElement(MeuMes, { userId: "u1" }));
    const aviso = await screen.findByTestId("aviso-meta-plano");
    expect(aviso.textContent).toContain("vem do Meu Plano 2027 — para mudar, ajuste o plano");
    expect(screen.getByTestId("meu-mes").textContent).toMatch(/R\$\s?49\.000/);
    expect(screen.queryByText("Atualizar minha meta")).toBeNull();
    expect(screen.queryByText("Salvar minha meta")).toBeNull();
  });

  it("2027 sem plano assinado: continua digitando como hoje", async () => {
    data("2027-03-10");
    tabelas.carreira_plano = { respostas: ANA, assinado_corretor_em: null };
    render(createElement(MeuMes, { userId: "u1" }));
    await screen.findByText("Salvar minha meta");
    expect(screen.queryByTestId("aviso-meta-plano")).toBeNull();
  });

  it("2026: nada muda, mesmo com plano assinado (não lê o plano)", async () => {
    data("2026-11-18");
    tabelas.carreira_plano = assinado;
    tabelas.minhas_metas = [
      {
        id: "m26",
        periodo: "mes",
        inicio: "2026-11-01",
        meta_comissao: 12000,
        meta_vgv: null,
        meta_vendas: 2,
        meta_captacoes: 3,
      },
    ];
    render(createElement(MeuMes, { userId: "u1" }));
    await screen.findByText("Atualizar minha meta");
    expect(screen.getByTestId("meu-mes").textContent).toMatch(/R\$\s?12\.000/);
    expect(screen.queryByTestId("aviso-meta-plano")).toBeNull();
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("meu_plano_2027_enabled");
  });

  it("2027 com módulo desligado: campo livre", async () => {
    data("2027-03-10");
    moduloOn = false;
    tabelas.carreira_plano = assinado;
    render(createElement(MeuMes, { userId: "u1" }));
    await screen.findByText("Salvar minha meta");
    expect(screen.queryByTestId("aviso-meta-plano")).toBeNull();
  });
});
