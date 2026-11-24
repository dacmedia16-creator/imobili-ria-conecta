// @vitest-environment jsdom
/**
 * t_adaaa240 (Denis 24/11): os rankings do painel de metas da imobiliária mostram as MESMAS etiquetas da tela
 * "Meu Plano 2027 — equipe" (selo da meta + assinado/em preenchimento/não começou), com busca e filtro.
 * As duas telas são montadas com os MESMOS dados de banco simulados e as etiquetas são comparadas pessoa a pessoa.
 * Nada é gravado; dados fictícios.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { gravadaDe } from "./teste-gravada";

const rpc = vi.fn();
const escritas: string[] = [];
let carreiraPlanoRecusa = false;

// Plano completo (fecha meta) e um começado que não fecha meta (caso da Tereza: começou, sem meta, sem assinar).
const COMPLETO: Respostas = {
  "mt.creIni": "10",
  "mt.novas": "24",
  "mt.canc": "6",
  "mt.vendidas": "12",
  "mt.tCapt": "12",
  "mt.tVenda": "12",
  "mt.comMedia": "5000",
  "m.ticket": "400000",
};
const COMECOU: Respostas = { "pq.frase": "Dar segurança à minha família" };
const G = gravadaDe(COMPLETO)!;
const FORA = { meta_comissao: 1071000, meta_vgv: 17850000, meta_vendas: 42, meta_captacoes: 840 };
const EM = "2026-11-20T12:00:00Z";

type P = {
  id: string;
  nome: string;
  team: string | null;
  respostas: Respostas | null;
  assinado: boolean;
  meta: typeof G | null;
};
const PESSOAS: P[] = [
  { id: "u-a", nome: "Ana Simões", team: "t1", respostas: COMPLETO, assinado: true, meta: G },
  { id: "u-b", nome: "Bruno Pérez", team: "t1", respostas: COMPLETO, assinado: false, meta: G },
  {
    id: "u-t",
    nome: "Tereza Fictícia Inoue",
    team: "t1",
    respostas: COMECOU,
    assinado: false,
    meta: null,
  },
  { id: "u-c", nome: "Caio Assinou", team: "t2", respostas: COMPLETO, assinado: true, meta: null },
  {
    id: "u-g",
    nome: "Giulia Conferir",
    team: "t2",
    respostas: COMPLETO,
    assinado: false,
    meta: FORA,
  },
  { id: "u-n", nome: "Nina Nunca", team: "t2", respostas: null, assinado: false, meta: null },
];
const ESPERADO: Record<string, [string, string]> = {
  "u-a": ["conta", "assinado"],
  "u-b": ["conta_falta_assinar", "preenchendo"],
  "u-t": ["falta_meta", "preenchendo"],
  "u-c": ["assinado_sem_meta", "assinado"],
  "u-g": ["meta_a_conferir", "preenchendo"],
  "u-n": ["falta_meta", "nao_comecou"],
};

// --- banco simulado: as duas telas leem daqui ---
const PLANOS_RPC = {
  todas: true,
  modulo_plano: true,
  equipes: [
    { id: "t1", nome: "Equipe Azul", lider_id: "u-a", lider_nome: "Ana Simões" },
    { id: "t2", nome: "Equipe Verde", lider_id: "u-c", lider_nome: "Caio Assinou" },
  ],
  pessoas: PESSOAS.map((p) => ({
    user_id: p.id,
    nome: p.nome,
    team_id: p.team,
    papeis: ["corretor"],
    tem_plano: p.respostas != null,
    respostas: p.respostas,
    assinado_em: p.assinado ? EM : null,
    meta_oficial: p.meta,
    meta_oficial_em: p.meta ? EM : null,
  })),
};
const EQUIPE_RPC = PESSOAS.map((p) => ({
  user_id: p.id,
  nome: p.nome,
  trilha: null,
  ativacao_inicio: null,
  respostas: p.respostas,
  assinado_corretor_em: p.assinado ? EM : null,
  assinado_broker_em: null,
  meta_oficial_em: p.meta ? EM : null,
  updated_at: p.respostas ? EM : null,
}));

function cadeia(tabela: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "is", "or", "gte", "order", "limit", "not"])
    c[m] = () => c;
  c.maybeSingle = async () => ({ data: null, error: null });
  const dados =
    tabela === "carreira_plano"
      ? PESSOAS.filter((p) => p.meta).map((p) => ({ user_id: p.id, meta_oficial: p.meta }))
      : [];
  c.then = (ok: (v: unknown) => unknown) =>
    Promise.resolve(
      tabela === "carreira_plano" && carreiraPlanoRecusa
        ? { data: null, error: { code: "42501", message: "recusado" } }
        : { data: dados, error: null },
    ).then(ok);
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
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "admin-1" }, roles: ["admin"] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PainelMetasImobiliaria } from "@/components/metas-2027/PainelMetasImobiliaria";
import { EquipePlano } from "@/components/minha-carreira/meu-plano/Equipe";

function responder() {
  rpc.mockImplementation((fn: string) => {
    if (fn === "carreira_plano_equipe") return Promise.resolve({ data: EQUIPE_RPC, error: null });
    if (fn === "metas_equipe_planos") return Promise.resolve({ data: PLANOS_RPC, error: null });
    if (fn === "metas_equipe_realizado")
      return Promise.resolve({
        data: { captacoes_ligadas: true, vendas: [], captacoes: [] },
        error: null,
      });
    return Promise.resolve({ data: null, error: null });
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rpc.mockReset();
  escritas.length = 0;
  carreiraPlanoRecusa = false;
});

/** nome → [selo, estado] lidos do DOM: na tela de equipe, a linha <li>; no ranking, o item do ranking. */
function etiquetasEquipe(lista: HTMLElement) {
  const r: Record<string, [string, string]> = {};
  for (const li of Array.from(lista.querySelectorAll("li"))) {
    const nome = li.querySelector("p")!.textContent!;
    const selo = li.querySelector("[data-testid=selo-meta]")!.getAttribute("data-selo")!;
    const txt = li.textContent ?? "";
    const estado = /✅ assinado/.test(txt)
      ? "assinado"
      : /📝 em preenchimento/.test(txt)
        ? "preenchendo"
        : "nao_comecou";
    r[nome] = [selo, estado];
  }
  return r;
}
function etiquetasRanking(rk: HTMLElement) {
  const r: Record<string, [string, string]> = {};
  for (const li of Array.from(rk.querySelectorAll("li"))) {
    const nome = li.querySelector("[data-testid=nome-abre-plano]")!.textContent!;
    r[nome] = [
      li.querySelector("[data-testid=selo-meta]")!.getAttribute("data-selo")!,
      li.querySelector("[data-testid=estado-plano]")!.getAttribute("data-estado")!,
    ];
  }
  return r;
}

describe("Ranking por corretor = etiquetas da tela 'Meu Plano 2027 — equipe'", () => {
  it("mesmos dados → mesma etiqueta (selo e assinatura) para cada pessoa, com o mesmo texto e cor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
    responder();
    render(createElement(EquipePlano, { aberto: null, abrir: vi.fn(), broker: true }));
    const lista = await screen.findByTestId("broker-equipe");
    const daEquipe = etiquetasEquipe(lista);
    const textosEquipe = Object.fromEntries(
      Array.from(lista.querySelectorAll("li")).map((li) => [
        li.querySelector("p")!.textContent,
        li.querySelector("[data-testid=selo-meta]")!.parentElement!.outerHTML,
      ]),
    );
    cleanup();

    render(createElement(PainelMetasImobiliaria));
    const rk = await screen.findByTestId("ranking-corretores");
    const doRanking = etiquetasRanking(rk);
    // Todas as 6 pessoas, e o ranking bate com a tela de equipe e com o esperado.
    expect(Object.keys(doRanking).sort()).toEqual(PESSOAS.map((p) => p.nome).sort());
    expect(doRanking).toEqual(daEquipe);
    for (const p of PESSOAS) expect(doRanking[p.nome]).toEqual(ESPERADO[p.id]);
    // Mesmo HTML do selo (texto + cor) nas duas telas.
    for (const li of Array.from(rk.querySelectorAll("li"))) {
      const nome = li.querySelector("[data-testid=nome-abre-plano]")!.textContent!;
      expect(li.querySelector("[data-testid=selo-meta]")!.parentElement!.outerHTML).toBe(
        textosEquipe[nome],
      );
    }
    // Caso Tereza: começou, sem meta oficial, sem assinatura.
    const tereza = within(rk).getByText("Tereza Fictícia Inoue").closest("li")!;
    expect(tereza.textContent).toMatch(/Falta a meta oficial/);
    expect(tereza.textContent).toMatch(/📝 em preenchimento/);
    // Selo atual do farol e aviso "valor a conferir" continuam.
    expect(rk.textContent).toMatch(/Plano vale a partir de jan\/2027/);
    expect(escritas).toEqual([]);
  });

  it("Ranking por equipe: resumo por equipe com as mesmas regras", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
    responder();
    render(createElement(PainelMetasImobiliaria));
    const eq = await screen.findByTestId("ranking-equipes");
    const resumos = within(eq)
      .getAllByTestId("ranking-resumo-equipe")
      .map(
        (x) =>
          x.closest("li")!.querySelector("[data-testid=nome-abre-plano]")!.textContent +
          ": " +
          x.textContent,
      );
    expect(resumos.sort()).toEqual([
      "Equipe Azul: 2/3 contam na meta · 1 sem meta oficial · 1 falta assinar",
      "Equipe Verde: 0/3 contam na meta · 2 sem meta oficial",
    ]);
  });
});

describe("busca e filtro nos rankings (acréscimo de Denis 24/11)", () => {
  it("corretor: busca sem acento, filtro pelas etiquetas, 'X de Y', Limpar; posição e topo não mudam", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
    responder();
    render(createElement(PainelMetasImobiliaria));
    const rk = await screen.findByTestId("ranking-corretores");
    const w = within(rk);
    const cobertura = screen.getByTestId("cobertura").textContent;
    const posicoes = () =>
      Object.fromEntries(
        Array.from(rk.querySelectorAll("li")).map((li) => {
          const t = li.querySelector("p")!.textContent!;
          return [li.querySelector("[data-testid=nome-abre-plano]")!.textContent, t.split(".")[0]];
        }),
      );
    const todas = posicoes();
    expect(w.getByTestId("contagem-filtro").textContent).toBe("6 de 6 corretores");
    expect(w.queryByTestId("limpar-filtro")).toBeNull();

    fireEvent.change(w.getByTestId("busca-equipe"), { target: { value: "PEREZ" } });
    expect(w.getByTestId("contagem-filtro").textContent).toBe("1 de 6 corretores");
    expect(posicoes()).toEqual({ "Bruno Pérez": todas["Bruno Pérez"] }); // posição original

    fireEvent.change(w.getByTestId("busca-equipe"), { target: { value: "" } });
    const contar = (s: string) => {
      fireEvent.change(w.getByTestId("filtro-situacao"), { target: { value: s } });
      return Object.keys(posicoes()).sort();
    };
    expect(contar("conta_meta")).toEqual(["Ana Simões", "Bruno Pérez"]);
    expect(contar("sem_meta")).toEqual(["Caio Assinou", "Nina Nunca", "Tereza Fictícia Inoue"]);
    expect(contar("assinado")).toEqual(["Ana Simões", "Caio Assinou"]);
    expect(contar("falta_assinar")).toEqual(["Bruno Pérez"]);
    expect(contar("nao_comecou")).toEqual(["Nina Nunca"]);
    expect(contar("a_conferir")).toEqual(["Giulia Conferir"]);
    for (const [n, p] of Object.entries(posicoes())) expect(p).toBe(todas[n]);
    // Mesmos rótulos da tela de equipe.
    const opcoes = Array.from((w.getByTestId("filtro-situacao") as HTMLSelectElement).options).map(
      (o) => o.textContent!.replace(/ \(\d+\)$/, ""),
    );
    expect(opcoes).toEqual([
      "Todos",
      "Não começou",
      "Preenchendo",
      "Falta assinar",
      "Assinado",
      "Conta na meta",
      "Sem meta oficial",
      "Valor a conferir",
    ]);
    fireEvent.click(w.getByTestId("limpar-filtro"));
    expect(w.getByTestId("contagem-filtro").textContent).toBe("6 de 6 corretores");
    expect(posicoes()).toEqual(todas);
    expect(screen.getByTestId("cobertura").textContent).toBe(cobertura);
    expect(escritas).toEqual([]);
  });

  it("equipe: busca pelo nome da equipe ou do líder e filtro por quem está na equipe", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
    responder();
    render(createElement(PainelMetasImobiliaria));
    const eq = within(await screen.findByTestId("ranking-equipes"));
    const nomes = () =>
      eq
        .queryAllByTestId("ranking-resumo-equipe")
        .map((x) => x.closest("li")!.querySelector("[data-testid=nome-abre-plano]")!.textContent);
    expect(eq.getByTestId("contagem-filtro").textContent).toBe("2 de 2 equipes");
    fireEvent.change(eq.getByTestId("busca-equipe"), { target: { value: "verde" } });
    expect(nomes()).toEqual(["Equipe Verde"]);
    fireEvent.change(eq.getByTestId("busca-equipe"), { target: { value: "simoes" } }); // líder, sem acento
    expect(nomes()).toEqual(["Equipe Azul"]);
    fireEvent.change(eq.getByTestId("busca-equipe"), { target: { value: "" } });
    fireEvent.change(eq.getByTestId("filtro-situacao"), { target: { value: "a_conferir" } });
    expect(nomes()).toEqual(["Equipe Verde"]);
    expect(eq.getByTestId("contagem-filtro").textContent).toBe("1 de 2 equipes");
  });

  it("leitura das etiquetas recusada: ranking igual a antes, sem etiquetas e só com a busca", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
    carreiraPlanoRecusa = true;
    responder();
    render(createElement(PainelMetasImobiliaria));
    const rk = within(await screen.findByTestId("ranking-corretores"));
    expect(rk.getAllByTestId("nome-abre-plano")).toHaveLength(6);
    expect(rk.queryAllByTestId("selo-meta")).toHaveLength(0);
    expect(rk.queryByTestId("filtro-situacao")).toBeNull();
    expect(rk.getByTestId("busca-equipe")).toBeTruthy();
  });
});
