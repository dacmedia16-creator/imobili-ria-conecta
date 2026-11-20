// @vitest-environment jsdom
/**
 * Painel de metas 2027 · Equipes (cartão t_863b7590) — tela com banco e data simulados, sem tocar produção.
 * Confere: total e equipes com meta/realizado/% e ritmo, cartões com farol, quanto falta e anotações, alerta de
 * quem está parado, TL vendo só a dele, corretor recusado e que nada é gravado.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import type { Respostas } from "@/lib/meu-plano-2027/regras";

const rpc = vi.fn();
const escritas: string[] = [];
let anotacoes: Record<string, unknown>[] = [];

function cadeia(tabela: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "is", "or", "gte", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: null, error: null });
  c.then = (ok: (v: unknown) => unknown) =>
    Promise.resolve({ data: tabela === "carreira_anotacoes" ? anotacoes : [], error: null }).then(
      ok,
    );
  for (const m of ["insert", "update", "upsert", "delete"])
    c[m] = () => {
      escritas.push(`${m} ${tabela}`);
      return Promise.resolve({ error: null });
    };
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (t: string) => cadeia(t) },
}));
// Botão "Reabrir plano" (t_495e4305) usa o login para esconder o botão no próprio plano.
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "quem-ve" } }) }));

import { PainelMetasGestor } from "@/components/metas-2027/PainelMetasGestor";

const PLANO: Respostas = {
  "mt.novas": "24",
  "mt.tCapt": "12",
  "mt.tVenda": "12",
  "mt.comMedia": "5000",
  "m.ticket": "400000",
};
const assinado = { tem_plano: true, respostas: PLANO, assinado_em: "2026-12-10T13:00:00Z" };
const semPlano = { tem_plano: false, respostas: null, assinado_em: null };
const PLANOS_ADMIN = {
  todas: true,
  modulo_plano: true,
  equipes: [
    { id: "t1", nome: "Equipe Azul", lider_id: "tl", lider_nome: "Líder Azul" },
    { id: "t2", nome: "Equipe Verde", lider_id: null, lider_nome: null },
  ],
  pessoas: [
    { user_id: "a", nome: "Corretor Alfa", team_id: "t1", papeis: ["corretor"], ...assinado },
    { user_id: "b", nome: "Corretora Beta", team_id: "t1", papeis: ["corretor"], ...semPlano },
    { user_id: "v", nome: "Corretor Verde", team_id: "t2", papeis: ["corretor"], ...assinado },
  ],
};
const REAL = {
  captacoes_ligadas: true,
  vendas: [
    { sale_id: "s1", user_id: "a", venda_em: "2027-01-20", comissao: 12000, vgv: 400000, lados: 2 },
    { sale_id: "s2", user_id: "a", venda_em: "2027-03-05", comissao: 9000, vgv: 500000, lados: 1 },
    { sale_id: "s2", user_id: "v", venda_em: "2027-03-05", comissao: 7000, vgv: 500000, lados: 1 },
  ],
  captacoes: [{ capture_id: "c1", user_id: "a", aprovada_em: "2027-03-02" }],
};

function data(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${iso}T15:00:00Z`));
}
function responder(planos: unknown, erro?: { code: string; message: string }) {
  rpc.mockImplementation((fn: string) => {
    if (erro) return Promise.resolve({ data: null, error: erro });
    if (fn === "metas_equipe_planos") return Promise.resolve({ data: planos, error: null });
    if (fn === "metas_equipe_realizado") return Promise.resolve({ data: REAL, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  escritas.length = 0;
  anotacoes = [
    {
      id: "n1",
      user_id: "a",
      texto: "Liguei para 3 proprietários",
      proximo_passo: "Visita sexta",
      proximo_passo_em: "2027-03-19",
      created_at: "2027-03-12T14:00:00Z",
    },
  ];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rpc.mockReset();
});

describe("Painel de metas 2027 · Equipes", () => {
  it("admin em março/2027: total da imobiliária e cada equipe com meta, realizado, % e ritmo", async () => {
    data("2027-03-16");
    responder(PLANOS_ADMIN);
    render(createElement(PainelMetasGestor));
    const total = await screen.findByTestId("grupo-total");
    // Meta = 2 planos assinados de 120 mil; realizado = 12 + 9 + 7 mil.
    expect(total.textContent).toMatch(/R\$\s?28\.000.*de R\$\s?240\.000/);
    expect(total.textContent).toMatch(/12% da meta · ritmo/);
    expect(total.textContent).toMatch(/atrás/);
    expect(total.textContent).toMatch(/Meta do MÊS \(mar\)/);
    expect(screen.getByTestId("escopo").textContent).toMatch(/todas as equipes/);
    const azul = screen.getByTestId("grupo-t1");
    expect(azul.textContent).toMatch(/Equipe Azul/);
    expect(azul.textContent).toMatch(/Líder: Líder Azul/);
    expect(within(azul).getByTestId("cobertura").textContent).toMatch(/Planos assinados: 1 de 2/);
    // VGV da venda dividida s2 conta 1 vez no total: 400 mil + 500 mil.
    expect(total.textContent).toMatch(/R\$\s?900\.000/);
    // Calls: só leitura, as 2 RPCs com o ano e os últimos 12 meses.
    expect(rpc).toHaveBeenCalledWith("metas_equipe_planos", { _ano: 2027 });
    expect(rpc).toHaveBeenCalledWith("metas_equipe_realizado", {
      _inicio: "2027-01-01",
      _fim: "2027-12-31",
    });
    expect(escritas).toEqual([]);
  });

  it("abrindo a equipe: cartão de cada corretor com farol, quanto falta e as últimas anotações", async () => {
    data("2027-03-16");
    responder(PLANOS_ADMIN);
    render(createElement(PainelMetasGestor));
    fireEvent.click(await screen.findByRole("tab", { name: "Equipe Azul" }));
    const cartoes = await screen.findAllByTestId("cartao-corretor");
    expect(cartoes).toHaveLength(2);
    const alfa = cartoes.find((c) => c.textContent?.includes("Corretor Alfa"))!;
    expect(alfa.textContent).toMatch(/🟡 Atenção/); // 21 mil de ~25,2 mil esperados = 83%
    expect(within(alfa).getByTestId("falta").textContent).toMatch(
      /Falta no mês: R\$\s?1\.000 · no ano: R\$\s?99\.000/,
    );
    expect(within(alfa).getByTestId("anotacoes").textContent).toMatch(
      /12\/mar.*Liguei para 3 proprietários.*Visita sexta · 19\/mar/,
    );
    const beta = cartoes.find((c) => c.textContent?.includes("Corretora Beta"))!;
    expect(beta.textContent).toMatch(/⚪ Sem plano assinado/);
    expect(beta.textContent).toMatch(/Sem meta oficial até assinar o plano/);
    expect(beta.textContent).toMatch(/Sem anotações recentes/);
  });

  it("Reabrir plano (t_495e4305): só no assinado; depois de reabrir, recarrega e a contagem cai na hora", async () => {
    data("2027-03-16");
    let reaberto = false;
    rpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === "carreira_plano_reabrir") {
        reaberto = true;
        return Promise.resolve({ data: { status: "reaberto" }, error: null });
      }
      if (fn === "metas_equipe_planos") {
        const pessoas = PLANOS_ADMIN.pessoas.map((p) =>
          reaberto && p.user_id === "a" ? { ...p, assinado_em: null } : p,
        );
        return Promise.resolve({ data: { ...PLANOS_ADMIN, pessoas }, error: null });
      }
      if (fn === "metas_equipe_realizado") return Promise.resolve({ data: REAL, error: null });
      return Promise.resolve({ data: args ?? null, error: null });
    });
    render(createElement(PainelMetasGestor));
    fireEvent.click(await screen.findByRole("tab", { name: "Equipe Azul" }));
    const cartoes = await screen.findAllByTestId("cartao-corretor");
    const alfa = cartoes.find((c) => c.textContent?.includes("Corretor Alfa"))!;
    const beta = cartoes.find((c) => c.textContent?.includes("Corretora Beta"))!;
    expect(within(beta).queryByTestId("reabrir-plano")).toBeNull();
    expect(screen.getByTestId("cobertura").textContent).toMatch(/Planos assinados: 1 de 2/);
    fireEvent.click(within(alfa).getByTestId("reabrir-plano"));
    fireEvent.change(await screen.findByTestId("reabrir-motivo"), {
      target: { value: "Transações digitadas em reais" },
    });
    fireEvent.click(screen.getByTestId("reabrir-ok"));
    await waitFor(() =>
      expect(screen.getByTestId("cobertura").textContent).toMatch(/Planos assinados: 0 de 2/),
    );
    expect(rpc).toHaveBeenCalledWith("carreira_plano_reabrir", {
      _corretor: "a",
      _ano: 2027,
      _motivo: "Transações digitadas em reais",
    });
    const depois = (await screen.findAllByTestId("cartao-corretor")).find((c) =>
      c.textContent?.includes("Corretor Alfa"),
    )!;
    expect(depois.textContent).toMatch(/📝 em preenchimento/);
    expect(within(depois).queryByTestId("reabrir-plano")).toBeNull();
    expect(escritas).toEqual([]);
  });

  it("alerta de quem está há mais tempo sem vender ou captar", async () => {
    data("2027-03-16");
    responder(PLANOS_ADMIN);
    render(createElement(PainelMetasGestor));
    const alerta = await screen.findByTestId("alerta-parados");
    expect(alerta.textContent).toMatch(/Corretora Beta.*nada em 12 meses/);
    expect(alerta.textContent).not.toMatch(/Corretor Alfa/); // vendeu há 11 dias
  });

  it("Team Leader com 1 equipe: abre direto nela e não vê as outras", async () => {
    data("2027-03-16");
    responder({
      ...PLANOS_ADMIN,
      todas: false,
      equipes: [PLANOS_ADMIN.equipes[0]],
      pessoas: PLANOS_ADMIN.pessoas.filter((p) => p.team_id === "t1"),
    });
    render(createElement(PainelMetasGestor));
    await screen.findAllByTestId("cartao-corretor");
    expect(screen.getByTestId("escopo").textContent).toMatch(/só a\(s\) equipe\(s\) que lidera/);
    expect(screen.queryByText("Equipe Verde")).toBeNull();
    expect(screen.queryByText("Corretor Verde")).toBeNull();
  });

  it("corretor (banco recusa com 42501): mensagem clara, sem dados", async () => {
    data("2027-03-16");
    responder(null, { code: "42501", message: "Só gestor..." });
    render(createElement(PainelMetasGestor));
    expect(
      await screen.findByText("Este painel é para gestor, administrador e Team Leader."),
    ).toBeTruthy();
    expect(screen.queryByTestId("grupo-total")).toBeNull();
  });

  it("antes de jan/2027: aviso de vigência e farol ⚪", async () => {
    data("2026-11-20");
    responder(PLANOS_ADMIN);
    render(createElement(PainelMetasGestor));
    expect((await screen.findByTestId("antes-vigencia")).textContent).toMatch(
      /a partir de janeiro de 2027/,
    );
    // Opção A: antes de jan/2027, a equipe não tem farol, barra nem "37 / 20": dois números rotulados.
    const total = screen.getByTestId("grupo-total");
    expect(within(total).queryByTestId("farol-equipe")).toBeNull();
    expect(within(total).queryByRole("progressbar")).toBeNull();
    const azul = screen.getByTestId("grupo-t1");
    const pares = within(azul).getByTestId("antes-pares").textContent ?? "";
    // Só Alfa assinou (s1 em 2027 não entra em 2026): vendas 2026 = 0 · meta 2027 = 24 transações.
    expect(pares).toMatch(/vendas 2026:\s*0meta 2027:\s*24/);
    expect(pares).toMatch(/comissão 2026:\s*R\$\s?0meta 2027:\s*R\$\s?120\.000/);
    expect(azul.textContent).not.toMatch(/\d+ \/ \d+/);
    expect(within(azul).getByTestId("nao-assinados").textContent).toMatch(
      /Produção de quem ainda não assinou o plano \(2026\)/,
    );
    // Ícone "i" (t_065a0ff9): antes de 2027, a comissão é de 2026 e o "i" diz isso.
    for (const k of [
      "equipe_comissao_ano",
      "equipe_vendas",
      "equipe_captacoes",
      "equipe_vgv",
      "equipe_nao_assinados",
      "equipe_planos_assinados",
    ])
      expect(within(azul).getByTestId(`info-${k}`), k).toBeTruthy();
    fireEvent.click(within(azul).getByRole("button", { name: "O que é: Comissão" }));
    expect((await screen.findByTestId("info-balao")).textContent).toMatch(
      /Comissão 2026 = .*quem já assinou.*não há barra, % nem farol até janeiro/,
    );
    expect(rpc).toHaveBeenCalledWith("metas_equipe_realizado", {
      _inicio: "2026-01-01",
      _fim: "2026-12-31",
    });
  });
});

describe("tela nova não mexe no Painel da Equipe nem no Farol", () => {
  it("a rota nova usa só o componente novo e a mesma guarda de papéis do Painel da Equipe", () => {
    const rota = readFileSync("src/routes/_authenticated/painel-metas.tsx", "utf8");
    expect(rota).toMatch(/requireRoles\(context\.auth, podeAcessarPainelEquipe\)/);
    expect(rota).toMatch(/PainelMetasGestor/);
    const comp = readFileSync("src/components/metas-2027/PainelMetasGestor.tsx", "utf8");
    expect(comp).not.toMatch(/FarolEquipe|painel_equipe_dados/);
  });
});
