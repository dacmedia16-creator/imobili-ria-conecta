import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Lead } from "@/lib/leads";
import { itensVisiveis, montarMenuLateral, type MenuContexto } from "@/lib/menu-lateral";
import {
  alternarGrupo,
  atalhoAtivo,
  atalhosBarraInferior,
  buscarItens,
  contarSituacoes,
  ehAtalhoBusca,
  etapaVizinha,
  filtrarQuadro,
  filtroAtivo,
  FILTRO_VAZIO,
  grupoTemRota,
  itensDaBusca,
  lerGruposFechados,
  mostraBarraInferior,
  origensPresentes,
  posicaoEtapa,
  textoEtapasVisiveis,
} from "@/lib/telas-lote2";

const HOJE = "2026-11-24";
const lead = (p: Partial<Lead> & { id: string }): Lead =>
  ({
    nome: p.id,
    origem: "c2s",
    etapa: "novo",
    proximo_contato_em: null,
    responsavel_id: "u1",
    ...p,
  }) as Lead;

const LEADS = [
  lead({ id: "atrasado-c2s", proximo_contato_em: "2026-11-20" }),
  lead({ id: "sem-site", origem: "site" }),
  lead({ id: "hoje-site", origem: "site", proximo_contato_em: HOJE }),
  lead({ id: "futuro-c2s", proximo_contato_em: "2026-12-01" }),
  lead({ id: "ganho-sem", etapa: "ganho" }),
  lead({ id: "perdido-antigo", etapa: "perdido", proximo_contato_em: "2026-01-01" }),
];

describe("CRM: filtros rápidos", () => {
  it("Atrasados e Sem próximo passo ignoram leads encerrados", () => {
    const ids = (s: "atrasados" | "sem") =>
      filtrarQuadro(LEADS, { situacao: s, origem: "" }, HOJE).map((l) => l.id);
    expect(ids("atrasados")).toEqual(["atrasado-c2s"]);
    expect(ids("sem")).toEqual(["sem-site"]);
  });
  it("origem combina com a situação; filtro vazio devolve tudo", () => {
    expect(filtrarQuadro(LEADS, FILTRO_VAZIO, HOJE)).toHaveLength(LEADS.length);
    expect(
      filtrarQuadro(LEADS, { situacao: "todos", origem: "site" }, HOJE).map((l) => l.id),
    ).toEqual(["sem-site", "hoje-site"]);
    expect(filtrarQuadro(LEADS, { situacao: "atrasados", origem: "site" }, HOJE)).toEqual([]);
  });
  it("contadores dos chips respeitam a origem escolhida", () => {
    expect(contarSituacoes(LEADS, "", HOJE)).toEqual({ todos: 6, atrasados: 1, sem: 1 });
    expect(contarSituacoes(LEADS, "site", HOJE)).toEqual({ todos: 2, atrasados: 0, sem: 1 });
  });
  it("origens só as presentes, com rótulo e em ordem", () => {
    expect(origensPresentes(LEADS)).toEqual([
      { valor: "c2s", rotulo: "C2S" },
      { valor: "site", rotulo: "Site" },
    ]);
    expect(filtroAtivo(FILTRO_VAZIO)).toBe(false);
    expect(filtroAtivo({ situacao: "todos", origem: "site" })).toBe(true);
  });
});

describe("CRM: etapas visíveis", () => {
  it("posição 'etapa X de 6' nos funis de venda e locação", () => {
    expect(posicaoEtapa("venda", "visita_agendada")).toEqual({ n: 3, total: 6, nome: "Visita" });
    expect(posicaoEtapa("locacao", "novo").n).toBe(1);
    expect(posicaoEtapa("locacao", "perdido").n).toBe(6);
  });
  it("vizinhas param nas pontas", () => {
    expect(etapaVizinha("venda", "novo", -1)).toBeNull();
    expect(etapaVizinha("venda", "novo", 1)).toBe("em_atendimento");
    expect(etapaVizinha("venda", "perdido", 1)).toBeNull();
    expect(etapaVizinha("captacao", "em_atendimento", 1)).toBe("avaliacao");
  });
  it("texto do indicador", () => {
    expect(textoEtapasVisiveis(1, 4, 6)).toBe("Etapas 1–4 de 6");
    expect(textoEtapasVisiveis(1, 6, 6)).toBe("Todas as 6 etapas");
  });
});

const ctxBase: MenuContexto = {
  roles: ["corretor"],
  platformAdmin: false,
  exclusiveVisible: true,
  roomVisible: true,
  feedbackVisible: true,
  leadsVisible: true,
  crmVisible: true,
  locacaoVisible: true,
};

describe("Barra inferior e busca: nunca liberam item novo (permissões #412/#413/#414)", () => {
  const PAPEIS: string[][] = [
    ["corretor"],
    ["gestor"],
    ["team_leader"],
    ["admin"],
    ["financeiro"],
    ["staff"],
    ["locacao"],
    ["fotografo"],
    [],
  ];
  for (const roles of PAPEIS) {
    for (const leadsVisible of [true, false]) {
      it(`papel ${roles.join(",") || "nenhum"} (leads ${leadsVisible ? "ligado" : "desligado"})`, () => {
        const groups = montarMenuLateral({ ...ctxBase, roles, leadsVisible });
        const permitidos = new Set(itensVisiveis(groups));
        const barra = atalhosBarraInferior(groups);
        expect(barra.length).toBeLessThanOrEqual(4);
        for (const a of barra) expect(permitidos.has(a.to)).toBe(true);
        for (const i of itensDaBusca(groups)) expect(permitidos.has(i.to)).toBe(true);
        expect(itensDaBusca(groups).length).toBe(
          new Set(
            groups.flatMap((g) =>
              g.items.filter((i) => i.show).map((i) => `${i.to}?${i.search?.aba ?? ""}`),
            ),
          ).size,
        );
      });
    }
  }
  it("corretor com CRM: Início, CRM, Leads e Vendas", () => {
    const barra = atalhosBarraInferior(montarMenuLateral(ctxBase));
    expect(barra.map((a) => a.curto)).toEqual(["Início", "CRM", "Leads", "Vendas"]);
    expect(barra[2].to).toBe("/meus-leads");
  });
  it("gestor usa o Painel de leads; sem módulo Leads, CRM e Leads somem", () => {
    const g = atalhosBarraInferior(montarMenuLateral({ ...ctxBase, roles: ["gestor"] }));
    expect(g.find((a) => a.curto === "Leads")?.to).toBe("/painel-leads");
    const sem = atalhosBarraInferior(montarMenuLateral({ ...ctxBase, leadsVisible: false }));
    expect(sem.map((a) => a.to)).not.toContain("/crm");
    expect(sem.map((a) => a.curto)).toEqual(["Início", "Vendas", "Locação", "Captação"]);
  });
  it("papel só-Locação não ganha Vendas nem CRM", () => {
    const barra = atalhosBarraInferior(montarMenuLateral({ ...ctxBase, roles: ["locacao"] }));
    expect(barra.map((a) => a.to)).toEqual([
      "/dashboard",
      "/locacoes",
      "/reservas-salas",
      "/notificacoes",
    ]);
  });
});

describe("Barra inferior: rota ativa e telas com barra própria", () => {
  it("Início só exato; os outros valem nas subpáginas", () => {
    expect(atalhoAtivo("/dashboard", "/dashboard")).toBe(true);
    expect(atalhoAtivo("/vendas", "/vendas/123")).toBe(true);
    expect(atalhoAtivo("/vendas", "/vendas-por-regiao")).toBe(false);
  });
  it("some no Meu Plano (que já tem barra fixa embaixo)", () => {
    expect(mostraBarraInferior("/minha-carreira/plano")).toBe(false);
    expect(mostraBarraInferior("/crm")).toBe(true);
  });
});

describe("Menu: grupos recolhíveis e Ctrl+K", () => {
  it("lê o que foi guardado, tolerando lixo", () => {
    expect(lerGruposFechados(null)).toEqual([]);
    expect(lerGruposFechados("{quebrado")).toEqual([]);
    expect(lerGruposFechados('{"a":1}')).toEqual([]);
    expect(lerGruposFechados('["Equipe",3,"Administração"]')).toEqual(["Equipe", "Administração"]);
  });
  it("alterna abrir/fechar", () => {
    expect(alternarGrupo([], "Equipe")).toEqual(["Equipe"]);
    expect(alternarGrupo(["Equipe", "X"], "Equipe")).toEqual(["X"]);
  });
  it("o grupo da página aberta é detectado (fica sempre aberto)", () => {
    const groups = montarMenuLateral({ ...ctxBase, roles: ["gestor"] });
    const equipe = groups.find((g) => g.label === "Equipe")!;
    expect(grupoTemRota(equipe, "/painel-equipe")).toBe(true);
    expect(grupoTemRota(equipe, "/crm")).toBe(false);
  });
  it("busca por trecho do nome, sem acento: 'crm' acha só o CRM (não letras soltas)", () => {
    const itens = itensDaBusca(montarMenuLateral({ ...ctxBase, roles: ["admin"] }));
    expect(buscarItens(itens, "crm").map((i) => i.label)).toEqual(["CRM"]);
    expect(buscarItens(itens, "capta").map((i) => i.label)[0]).toBe("Captações exclusivas");
    expect(buscarItens(itens, "captação").map((i) => i.label)).toEqual(["Unidades da captação"]);
    expect(buscarItens(itens, "VENDAS")[0].label).toBe("Vendas");
    expect(buscarItens(itens, "xyzxyz")).toEqual([]);
    expect(buscarItens(itens, "  ")).toHaveLength(itens.length);
  });
  it("Ctrl+K e ⌘K abrem; Ctrl+Alt+K e K sozinho não", () => {
    const ev = (o: Partial<KeyboardEvent>) =>
      ({ key: "k", ctrlKey: false, metaKey: false, altKey: false, ...o }) as KeyboardEvent;
    expect(ehAtalhoBusca(ev({ ctrlKey: true }))).toBe(true);
    expect(ehAtalhoBusca(ev({ metaKey: true, key: "K" }))).toBe(true);
    expect(ehAtalhoBusca(ev({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(ehAtalhoBusca(ev({}))).toBe(false);
  });
});

describe("Sem banco: as telas do lote 2 não chamam RPC nova", () => {
  it("CrmQuadro, BarraInferior, BuscaRapida e telas-lote2 não importam supabase nem rpc", () => {
    for (const f of [
      "src/lib/telas-lote2.ts",
      "src/components/BarraInferior.tsx",
      "src/components/BuscaRapida.tsx",
      "src/components/crm/CrmQuadro.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/supabase|\.rpc\(/);
    }
  });
  it("o CRM continua carregando pela mesma listarLeadsCrm e movendo pelo CrmMoverDialog", () => {
    const src = readFileSync("src/components/crm/CrmPagina.tsx", "utf8");
    expect(src).toMatch(/listarLeadsCrm\(meuId\)/);
    expect(src).toMatch(/<CrmMoverDialog/);
    expect(src).not.toMatch(/\.rpc\(/);
  });
});
