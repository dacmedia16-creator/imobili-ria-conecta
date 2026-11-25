// Telas lote 3 (t_d97f306e, Denis 24/11): itens 7-9 do relatório t_d62be550.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chipsFiltrosVendas,
  compararPeriodos,
  larguraFaixa,
  periodoComparacao,
  rotuloMinhaVez,
  textoComparacao,
  type EstadoFiltrosVendas,
} from "./telas-lote3";

describe("item 7 — comparação com o mês anterior", () => {
  it("calcula a variação com seta para cima e para baixo", () => {
    expect(compararPeriodos(120, 100)).toEqual({ tipo: "variacao", pct: 20, sentido: "sobe" });
    expect(compararPeriodos(75, 100)).toEqual({ tipo: "variacao", pct: 25, sentido: "desce" });
  });

  it("não inventa número: sem base positiva vira 'sem comparação'", () => {
    expect(compararPeriodos(50, 0).tipo).toBe("sem");
    expect(compararPeriodos(50, null).tipo).toBe("sem");
    expect(compararPeriodos(50, undefined).tipo).toBe("sem");
    expect(compararPeriodos(null, 10).tipo).toBe("sem");
    expect(compararPeriodos(50, -10).tipo).toBe("sem");
    expect(compararPeriodos(Number.NaN, 10).tipo).toBe("sem");
    expect(textoComparacao(compararPeriodos(50, 0), "out/2026").curto).toBe("sem comparação");
  });

  it("zero contra zero e variação arredondada a 0% ficam 'igual'", () => {
    expect(compararPeriodos(0, 0)).toEqual({ tipo: "igual" });
    expect(compararPeriodos(100.2, 100)).toEqual({ tipo: "igual" });
  });

  it("texto sempre com seta e palavra, nunca só cor", () => {
    expect(textoComparacao({ tipo: "variacao", pct: 12, sentido: "sobe" }, "1–24 out")).toEqual({
      curto: "▲ 12% vs 1–24 out",
      longo: "Subiu 12% em relação a 1–24 out.",
    });
    expect(textoComparacao({ tipo: "variacao", pct: 8, sentido: "desce" }, "out/2026").curto).toBe(
      "▼ 8% vs out/2026",
    );
  });

  it("mês atual compara com o mês anterior até o mesmo dia (São Paulo)", () => {
    const agora = new Date("2026-11-25T01:00:00Z"); // ainda 24/11 em São Paulo
    expect(periodoComparacao(0, agora)).toMatchObject({
      de: "2026-10-01",
      ate: "2026-10-24",
      hoje: "2026-10-24",
      rotulo: "1–24 out",
    });
  });

  it("dia 31 contra mês de 30 dias usa o mês anterior inteiro", () => {
    expect(periodoComparacao(0, new Date("2026-12-31T15:00:00Z"))).toMatchObject({
      de: "2026-11-01",
      ate: "2026-11-30",
      rotulo: "nov/2026",
    });
  });

  it("'Mês anterior' (fechado) compara com o mês antes dele, inteiro, com virada de ano", () => {
    expect(periodoComparacao(-1, new Date("2026-02-10T15:00:00Z"))).toMatchObject({
      de: "2025-12-01",
      ate: "2025-12-31",
      rotulo: "dez/2025",
    });
  });

  it("faixa da Situação atual: grupo pequeno nunca some, zero fica vazio", () => {
    expect(larguraFaixa(695, 695)).toBe(100);
    expect(larguraFaixa(7, 695)).toBe(3);
    expect(larguraFaixa(0, 695)).toBe(0);
    expect(larguraFaixa(5, 0)).toBe(0);
  });

  it("o Início usa a MESMA função de cálculo para o mês e para a comparação", () => {
    const tela = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
    expect(tela).toContain("resumoDe(bundle, periodo)");
    expect(tela).toContain("resumoDe(bundle, periodoBase)");
    expect(tela.match(/calcularResumo\(/g)).toHaveLength(1);
    // KPIs 2 por linha no celular
    expect(tela).toContain("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4");
    // gráfico de barras trocado por faixas com número e %
    expect(tela).not.toContain("<BarChart");
    expect(tela).toContain('data-testid="situacao-faixas"');
  });
});

const BASE: EstadoFiltrosVendas = {
  soMinhaVez: false,
  statusFilter: "todas",
  vezFilter: "todas",
  dataDe: "2026-11-01",
  dataAte: "2026-11-30",
  periodoPadrao: { de: "2026-11-01", ate: "2026-11-30" },
  esteira: false,
  q: "",
  equipeFilter: "todas",
  podeFiltrarEquipe: true,
  midiaFilter: "todas",
  pagamentoFilter: "todas",
};
const NOMES = {
  status: (k: string) => `S:${k}`,
  vez: (k: string) => `V:${k}`,
  equipe: (k: string) => `E:${k}`,
  midia: (k: string) => `M:${k}`,
  pagamento: (k: string) => `P:${k}`,
};

describe("item 8 — Vendas: Minha vez, chips e legenda", () => {
  it("sem filtro ligado não mostra chip", () => {
    expect(chipsFiltrosVendas(BASE, NOMES)).toEqual([]);
  });

  it("um chip por filtro ligado, na ordem da tela", () => {
    const chips = chipsFiltrosVendas(
      {
        ...BASE,
        soMinhaVez: true,
        statusFilter: "rascunho",
        vezFilter: "gestor",
        dataDe: "2026-10-01",
        dataAte: "2026-10-31",
        q: "  apto  ",
        equipeFilter: "abc",
        midiaFilter: "portal",
        pagamentoFilter: "vista",
      },
      NOMES,
    );
    expect(chips.map((c) => c.chave)).toEqual([
      "minhaVez",
      "status",
      "vez",
      "periodo",
      "q",
      "equipe",
      "midia",
      "pagamento",
    ]);
    expect(chips[0].texto).toBe("★ Minha vez");
    expect(chips[3].texto).toBe("Período: 01/10/2026 a 31/10/2026");
    expect(chips[4].texto).toBe("Busca: “apto”");
  });

  it("equipe só vira chip para quem pode filtrar equipe; esteira ignora período", () => {
    expect(
      chipsFiltrosVendas({ ...BASE, equipeFilter: "abc", podeFiltrarEquipe: false }, NOMES),
    ).toEqual([]);
    expect(chipsFiltrosVendas({ ...BASE, esteira: true, dataDe: "", dataAte: "" }, NOMES)).toEqual(
      [],
    );
    expect(chipsFiltrosVendas({ ...BASE, dataDe: "", dataAte: "" }, NOMES)[0].texto).toBe(
      "Período: todas as datas",
    );
  });

  it("atalho Minha vez mostra a contagem só quando ela chegou", () => {
    expect(rotuloMinhaVez(null)).toBe("★ Minha vez");
    expect(rotuloMinhaVez(0)).toBe("★ Minha vez (0)");
    expect(rotuloMinhaVez(7)).toBe("★ Minha vez (7)");
  });

  it("tela: atalho na linha da busca, contagem pela mesma RPC da fila, legenda e chips", () => {
    const tela = readFileSync("src/routes/_authenticated/vendas.index.tsx", "utf8");
    const lista = readFileSync("src/components/vendas/ListaVendas.tsx", "utf8");
    expect(tela).toContain('data-testid="atalho-minha-vez"');
    expect(tela).toContain("rotuloMinhaVez(minhaVezRotulo)");
    expect(tela).not.toContain("Só minha vez");
    expect(tela).toMatch(/pageSize: 1,\s*soMinhaVez: true,\s*\.\.\.buildFilters\(\)/);
    expect(tela).toContain('data-testid="chips-filtros-vendas"');
    expect(tela).toContain("<LegendaVezDeAgir />");
    // admin/super_admin continuam sem fila: o atalho segue a mesma regra podeTerFila
    expect(tela).toMatch(/\{podeTerFila && \(\s*<Button[\s\S]{0,400}atalho-minha-vez/);
    // legenda usa as mesmas cores da coluna
    expect(lista).toContain("VEZ_DE_AGIR_TONE[k]");
  });
});

describe("item 9 — celular: cabeçalho baixo e explicação recolhida", () => {
  const base = readFileSync("src/components/visual/base.tsx", "utf8");
  it("explicação some no celular até tocar em 'Como funciona'", () => {
    expect(base).toContain("Como funciona");
    expect(base).toContain('!explicacaoAberta && "max-sm:hidden"');
    expect(base).toContain("aria-expanded={explicacaoAberta}");
    expect(base).toContain("aria-controls={idExplicacao}");
  });
  it("título numa linha no celular", () => {
    expect(base).toContain("truncate text-lg font-semibold");
  });
  it("CRM: Novo lead vira ícone com nome acessível e abas com contador pequeno", () => {
    const crm = readFileSync("src/components/crm/CrmPagina.tsx", "utf8");
    expect(crm).toContain('<span className="max-sm:sr-only">Novo lead</span>');
    expect(crm).toContain("aria-label={`${a.longo} (${a.n})`}");
    expect(crm).toContain("grid h-auto w-full grid-cols-4");
  });
});
