// @vitest-environment jsdom
/**
 * Painel de metas 2027 · Imobiliária (cartão t_69d29df6) — tela com banco e data simulados, sem tocar produção.
 * Confere: topo direção × assinados × em preenchimento com a diferença; admin edita a meta da direção pela RPC;
 * gestor fora (t_82b66d41: só a própria equipe); bruta recusada (42501) some sem derrubar o painel; TL/corretor recusados; nada gravado direto.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { comGravada } from "./teste-gravada";

const rpc = vi.fn();
const escritas: string[] = [];
let papeis: string[] = ["admin"];
let direcao: Record<string, unknown> | null = null;

function cadeia(tabela: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "is", "or", "gte", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: tabela === "metas_direcao" ? direcao : null, error: null });
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
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
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ roles: papeis }) }));

import { PainelMetasImobiliaria } from "@/components/metas-2027/PainelMetasImobiliaria";

const PLANO: Respostas = {
  "mt.novas": "24",
  "mt.tCapt": "12",
  "mt.tVenda": "12",
  "mt.comMedia": "5000",
  "m.ticket": "400000",
};
const PLANOS = {
  todas: true,
  modulo_plano: true,
  equipes: [{ id: "t1", nome: "Equipe Azul", lider_id: null, lider_nome: null }],
  pessoas: [
    {
      user_id: "a",
      nome: "Corretor Alfa",
      team_id: "t1",
      papeis: ["corretor"],
      tem_plano: true,
      respostas: PLANO,
      assinado_em: "2026-12-10T13:00:00Z",
      ...comGravada(PLANO), // a assinatura grava a meta oficial (t_91ec7aa3)
    },
    {
      user_id: "b",
      nome: "Corretora Beta",
      team_id: "t1",
      papeis: ["corretor"],
      tem_plano: true,
      respostas: PLANO,
      assinado_em: null,
    },
  ],
};
const REAL = {
  captacoes_ligadas: true,
  vendas: [
    { sale_id: "s1", user_id: "a", venda_em: "2027-02-10", comissao: 20000, vgv: 500000, lados: 2 },
  ],
  captacoes: [],
};
const QUEBRA = {
  vendas: [
    {
      sale_id: "s1",
      venda_em: "2027-02-10",
      modalidade: "padrao",
      bruta: 45000,
      premio: 0,
      imobiliaria: 22000,
      lideres: 2000,
      indicador: 1000,
      parceria: 0,
      extras: 0,
      corretores: 20000,
      diferenca: 0,
      valido: true,
    },
  ],
};
const recusa = { code: "42501", message: "Só gestor e administrador veem a comissão bruta" };

function responder(o: { bruta?: boolean; planos?: unknown; tudo42501?: boolean } = {}) {
  rpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
    if (o.tudo42501) return Promise.resolve({ data: null, error: recusa });
    if (fn === "metas_equipe_planos")
      return Promise.resolve({ data: o.planos ?? PLANOS, error: null });
    if (fn === "metas_equipe_realizado") return Promise.resolve({ data: REAL, error: null });
    if (fn === "metas_comissao_quebra")
      return Promise.resolve(
        o.bruta === false ? { data: null, error: recusa } : { data: QUEBRA, error: null },
      );
    if (fn === "metas_imobiliaria_estoque")
      return Promise.resolve({
        data: {
          captacoes_ligadas: true,
          exclusivas_ativas: 30,
          exclusivas_novas_30d: 4,
          anuncios_xml: 90,
          xml_em: null,
        },
        error: null,
      });
    if (fn === "metas_direcao_salvar") {
      direcao = {
        ano: args._ano,
        meta_comissao: args._comissao,
        meta_vgv: args._vgv,
        meta_vendas: args._vendas,
        meta_captacoes: args._captacoes,
      };
      return Promise.resolve({ data: direcao, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function hoje(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${iso}T15:00:00Z`));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rpc.mockReset();
  escritas.length = 0;
  direcao = null;
  papeis = ["admin"];
});

describe("Painel de metas 2027 · Imobiliária", () => {
  it("topo: direção × assinados × em preenchimento, com a diferença e a tabela dos 4 indicadores", async () => {
    hoje("2027-03-16");
    direcao = {
      ano: 2027,
      meta_comissao: 200000,
      meta_vgv: null,
      meta_vendas: 20,
      meta_captacoes: null,
    };
    responder();
    render(createElement(PainelMetasImobiliaria));
    const topo = await screen.findByTestId("topo-metas");
    expect(within(topo).getByTestId("meta-direcao").textContent).toMatch(/R\$\s?200\.000,00/);
    expect(within(topo).getByTestId("soma-assinados").textContent).toMatch(/R\$\s?120\.000,00/);
    expect(within(topo).getByTestId("soma-preenchimento").textContent).toMatch(/R\$\s?120\.000,00/);
    for (const id of ["meta-direcao", "soma-assinados", "soma-preenchimento"])
      expect(within(topo).getByTestId(`rotulo-vgc-${id}`).textContent).toBe(
        "VGC (comissão do ano)",
      );
    expect(within(topo).getByTestId("diferenca").textContent).toMatch(
      /Faltam R\$\s?80\.000,00 nas metas oficiais.*\(60%\)/,
    );
    const tab = within(topo).getByTestId("tabela-direcao").textContent ?? "";
    expect(tab).toMatch(/Vendas20/);
    // Centavos em todo valor em R$ (t_57737e80); quantidades seguem inteiras.
    expect(tab).toMatch(/R\$\s?200\.000,00/);
    expect(tab).not.toMatch(/Vendas20,/);
    // O texto curto do celular (R$ 0,2 mi / R$ 120 mil) é abreviação de propósito; o resto exige ",00".
    const valores = (topo.textContent ?? "").match(/R\$\s?[\d.,]+(\s?mil?(?![a-z]))?/g) ?? [];
    expect(valores.length).toBeGreaterThan(5);
    expect(valores.filter((v) => !/mil?$/.test(v) && !/,\d{2}$/.test(v))).toEqual([]);
    const real = screen.getByTestId("realizado");
    expect(real.textContent).toMatch(/17% da meta oficial/);
    // Duas comparações separadas e explícitas na tela.
    expect(within(real).getByTestId("casa-direcao").textContent).toMatch(
      /Imobiliária inteira × meta da direção.*10% da meta da direção/,
    );
    expect(within(real).getByTestId("nao-assinados").textContent).toMatch(
      /Produção de quem não conta na meta/,
    );
    expect(screen.getByTestId("cobertura").textContent).toMatch(/1 de 2/);
  });

  it("admin com bruta: quebra bruta → imobiliária → descontos → líquido dos corretores e estoque", async () => {
    hoje("2027-03-16");
    responder();
    render(createElement(PainelMetasImobiliaria));
    const q = await screen.findByTestId("quebra-comissao");
    expect(q.textContent).toMatch(/Bruta \(1 vendas\)R\$\s?45\.000,00/);
    expect(q.textContent).toMatch(/\(−\) ImobiliáriaR\$\s?22\.000,00/);
    expect(q.textContent).toMatch(/\(−\) Gestores\/TLR\$\s?2\.000,00/);
    expect(q.textContent).toMatch(/\(−\) IndicadorR\$\s?1\.000,00/);
    expect(q.textContent).toMatch(/= Líquido dos corretoresR\$\s?20\.000,00/);
    expect(screen.getByTestId("indicadores").textContent).toMatch(/30 exclusivas/);
    // Ícone "i" em cada número, inclusive em cada parte da quebra (t_065a0ff9).
    for (const k of [
      "imob_meta_direcao",
      "imob_soma_assinados",
      "imob_preenchimento",
      "imob_tabela_direcao",
      "imob_realizado",
      "imob_ritmo",
      "imob_cobertura",
      "imob_grafico",
      "imob_vgv",
      "imob_vendas",
      "imob_captacoes",
      "imob_estoque",
      "imob_quebra_bruta",
      "imob_quebra_imobiliaria",
      "imob_quebra_lideres",
      "imob_quebra_indicador",
      "imob_quebra_parceria",
      "imob_quebra_corretores",
      "imob_ranking_equipes",
      "imob_ranking_corretores",
      "imob_farol",
    ])
      expect(screen.getByTestId(`info-${k}`), k).toBeTruthy();
  });

  it("admin define a meta da direção pelo formulário (RPC; nada gravado direto na tabela)", async () => {
    hoje("2027-03-16");
    responder();
    render(createElement(PainelMetasImobiliaria));
    expect((await screen.findByTestId("diferenca")).textContent).toMatch(
      /Defina a meta da direção/,
    );
    fireEvent.click(screen.getByTestId("editar-direcao"));
    fireEvent.change(screen.getByLabelText("Comissão do ano (R$)"), { target: { value: "-10" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith("metas_direcao_salvar", expect.anything());
    fireEvent.change(screen.getByLabelText("Comissão do ano (R$)"), {
      target: { value: "100.000" },
    });
    fireEvent.change(screen.getByLabelText("Vendas (transações) no ano"), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Salvar/ }));
    await screen.findByTestId("editar-direcao");
    expect(rpc).toHaveBeenCalledWith("metas_direcao_salvar", {
      _ano: 2027,
      _comissao: 100000,
      _vgv: null,
      _vendas: 15,
      _captacoes: null,
    });
    expect(screen.getByTestId("diferenca").textContent).toMatch(
      /passam a meta da direção em R\$\s?20\.000/,
    );
    expect(escritas).toEqual([]);
  });

  it("gestor (t_82b66d41: o banco devolve só a equipe dele, todas=false): sem a imobiliária", async () => {
    hoje("2027-03-16");
    papeis = ["gestor"];
    responder({ planos: { ...PLANOS, todas: false } });
    render(createElement(PainelMetasImobiliaria));
    expect(await screen.findByText(/é para o administrador/)).toBeTruthy();
    expect(screen.queryByTestId("topo-metas")).toBeNull();
    expect(screen.queryByTestId("quebra-comissao")).toBeNull();
  });

  it("bruta recusada pelo banco (42501): o bloco da quebra some e o resto do painel continua", async () => {
    hoje("2027-03-16");
    responder({ bruta: false });
    render(createElement(PainelMetasImobiliaria));
    await screen.findByTestId("topo-metas");
    expect(screen.queryByTestId("quebra-comissao")).toBeNull();
    expect(screen.getByTestId("ranking-corretores").textContent).toMatch(/Corretor Alfa/);
  });

  it("t_c9b0f633: nome no ranking abre o plano da pessoa; na equipe, o do líder; sem módulo, só texto", async () => {
    hoje("2027-03-16");
    responder({
      planos: {
        ...PLANOS,
        equipes: [{ id: "t1", nome: "Equipe Azul", lider_id: "b", lider_nome: "Corretora Beta" }],
      },
    });
    render(createElement(PainelMetasImobiliaria));
    await screen.findByTestId("topo-metas");
    const corr = within(screen.getByTestId("ranking-corretores"));
    const alfa = corr
      .getAllByTestId("nome-abre-plano")
      .find((x) => x.textContent === "Corretor Alfa")!;
    expect(alfa.getAttribute("href")).toBe("/minha-carreira/plano?de=a");
    const eq = within(screen.getByTestId("ranking-equipes"));
    const links = eq.getAllByTestId("nome-abre-plano");
    // Nome da equipe e "Líder: ..." abrem o plano do LÍDER.
    expect(links.map((x) => x.textContent)).toEqual(["Equipe Azul", "Corretora Beta"]);
    expect(links.every((x) => x.getAttribute("data-plano-de") === "b")).toBe(true);
    cleanup();
    responder({ planos: { ...PLANOS, modulo_plano: false } });
    render(createElement(PainelMetasImobiliaria));
    await screen.findByTestId("topo-metas");
    expect(screen.queryAllByTestId("nome-abre-plano")).toHaveLength(0);
    expect(escritas).toEqual([]);
  });

  it("Team Leader (o banco devolve só a equipe dele) e corretor (42501): sem a imobiliária", async () => {
    hoje("2027-03-16");
    papeis = ["team_leader"];
    responder({ planos: { ...PLANOS, todas: false } });
    render(createElement(PainelMetasImobiliaria));
    expect(await screen.findByText(/é para o administrador/)).toBeTruthy();
    expect(screen.queryByTestId("topo-metas")).toBeNull();
    cleanup();
    papeis = ["corretor"];
    responder({ tudo42501: true });
    render(createElement(PainelMetasImobiliaria));
    expect(
      await screen.findByText("Este painel é para o administrador da imobiliária."),
    ).toBeTruthy();
  });
});

describe("tela nova não mexe no Painel da Equipe, no Farol nem nos relatórios", () => {
  it("rota com guarda própria (gestor/admin) e componente sem dependências das telas antigas", () => {
    const rota = readFileSync("src/routes/_authenticated/painel-metas-imobiliaria.tsx", "utf8");
    expect(rota).toMatch(/requireRoles\(context\.auth, podeAcessarPainelImobiliaria\)/);
    const comp = readFileSync("src/components/metas-2027/PainelMetasImobiliaria.tsx", "utf8");
    expect(comp).not.toMatch(/FarolEquipe|painel_equipe_dados|relatorio|financeiro_/i);
  });
});
