import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  aplicarFiltro,
  clubeDe,
  faltaParaProximo,
  intervaloPeriodo,
  normalizarRankingClubes,
  pertoDeSubir,
  porteDoTime,
  previsaoAno,
  progressoAteProximo,
  proximoClube,
  resumoEmpresa,
  rotuloIntervalo,
  type CorretorRanking,
} from "./ranking-clubes";
import { SeloClube } from "@/components/ranking/SeloClube";
import { RankingCard } from "@/components/mural/MuralConquistasView";

// Faixas oficiais 2026 (ranking.minharemax.com/conceitos).
const FAIXAS = [
  { nome: "Executive", minimo: 167224 },
  { nome: "100%", minimo: 334448 },
  { nome: "Platinum", minimo: 836120 },
  { nome: "Chairman's", minimo: 1672241 },
  { nome: "Titan", minimo: 2508361 },
  { nome: "Diamond", minimo: 3344482 },
  { nome: "Pinnacle", minimo: 6688963 },
];

const corretor = (p: Partial<CorretorRanking>): CorretorRanking => ({
  user_id: "u",
  nome: "Fulano",
  avatar_url: null,
  eu: false,
  comissao: 0,
  comissao_ano: 0,
  capt: 0,
  venda: 0,
  team_id: null,
  team_nome: null,
  tamanho_time: null,
  ...p,
});

describe("Ranking e Clubes — clubes", () => {
  it("clube pela comissão do ano: limites exatos", () => {
    expect(clubeDe(167223.99, FAIXAS)).toBeNull();
    expect(clubeDe(167224, FAIXAS)?.nome).toBe("Executive");
    expect(clubeDe(334448, FAIXAS)?.nome).toBe("100%");
    expect(clubeDe(6688963, FAIXAS)?.nome).toBe("Pinnacle");
    expect(clubeDe(null, FAIXAS)).toBeNull();
  });

  it("próximo clube, quanto falta e barra", () => {
    expect(proximoClube(100000, FAIXAS)?.nome).toBe("Executive");
    expect(faltaParaProximo(100000, FAIXAS)).toBe(67224);
    expect(progressoAteProximo(167224, FAIXAS)).toBe(0);
    expect(progressoAteProximo(250836, FAIXAS)).toBeCloseTo(50, 0);
    expect(proximoClube(7_000_000, FAIXAS)).toBeNull();
    expect(progressoAteProximo(7_000_000, FAIXAS)).toBe(100);
    expect(faltaParaProximo(7_000_000, FAIXAS)).toBeNull();
  });

  it("perto de subir = falta menos de 12% do próximo clube", () => {
    expect(pertoDeSubir(150000, FAIXAS)).toBe(true); // falta 10,3%
    expect(pertoDeSubir(140000, FAIXAS)).toBe(false); // falta 16,3%
    expect(pertoDeSubir(0, FAIXAS)).toBe(false);
    expect(pertoDeSubir(7_000_000, FAIXAS)).toBe(false);
  });
});

describe("Ranking e Clubes — períodos, porte e filtro", () => {
  it("períodos em datas de SP", () => {
    expect(intervaloPeriodo("mes", "2026-11-04")).toEqual({
      inicio: "2026-11-01",
      fim: "2026-11-30",
    });
    expect(intervaloPeriodo("ytd", "2026-11-04")).toEqual({
      inicio: "2026-01-01",
      fim: "2026-11-30",
    });
    expect(intervaloPeriodo("tri", "2026-11-04")).toEqual({
      inicio: "2026-09-01",
      fim: "2026-11-30",
    });
    expect(intervaloPeriodo("tri", "2026-02-10")).toEqual({
      inicio: "2025-12-01",
      fim: "2026-02-28",
    });
    expect(intervaloPeriodo("ano_anterior", "2026-11-04")).toEqual({
      inicio: "2025-01-01",
      fim: "2025-12-31",
    });
    expect(rotuloIntervalo("2026-01-01", "2026-11-30")).toBe("jan/2026 a nov/2026");
    expect(rotuloIntervalo("2026-11-01", "2026-11-30")).toBe("nov/2026");
  });

  it("porte do time com líder incluído", () => {
    expect(porteDoTime(null)).toBe("sem_time");
    expect(porteDoTime(2)).toBe("micro");
    expect(porteDoTime(3)).toBe("pequeno");
    expect(porteDoTime(5)).toBe("pequeno");
    expect(porteDoTime(6)).toBe("medio");
    expect(porteDoTime(10)).toBe("medio");
    expect(porteDoTime(11)).toBe("grande");
  });

  it("filtro mostra posição no filtro e mantém a geral", () => {
    const lista = [
      corretor({ user_id: "a", tamanho_time: 12 }),
      corretor({ user_id: "b", tamanho_time: 4 }),
      corretor({ user_id: "c", tamanho_time: 15 }),
    ];
    const semFiltro = aplicarFiltro(lista, null);
    expect(semFiltro.linhas.map((x) => [x.posicao, x.posicaoFiltro])).toEqual([
      [1, null],
      [2, null],
      [3, null],
    ]);
    const grande = aplicarFiltro(lista, (x) => porteDoTime(x.tamanho_time) === "grande");
    expect(grande.total).toBe(3);
    expect(grande.linhas.map((x) => [x.user_id, x.posicaoFiltro, x.posicao])).toEqual([
      ["a", 1, 1],
      ["c", 2, 3],
    ]);
  });
});

describe("Ranking e Clubes — previsão e resumo", () => {
  it("previsão no ritmo atual conta desde jan ou desde a 1ª venda no sistema", () => {
    const desdeJan = previsaoAno(100000, "2026-07-02", null);
    expect(desdeJan?.desde).toBe("2026-01-01");
    expect(desdeJan?.valor).toBeCloseTo((100000 / 183) * 365, 0);
    const desdeAgo = previsaoAno(90000, "2026-11-04", "2026-08-03");
    expect(desdeAgo?.desde).toBe("2026-08-03");
    expect(desdeAgo?.valor).toBeCloseTo((90000 / 94) * 151, 0);
    expect(previsaoAno(0, "2026-11-04", null)).toBeNull();
    expect(previsaoAno(null, "2026-11-04", null)).toBeNull();
  });

  it("resumo da empresa: total, em clube, perto de subir e por clube", () => {
    const r = resumoEmpresa(
      [
        corretor({ nome: "Ana Lima", comissao_ano: 900000 }),
        corretor({ nome: "Bruno Reis", comissao_ano: 160000 }),
        corretor({ nome: "Carla", comissao_ano: 170000 }),
        corretor({ nome: "Davi", comissao_ano: 1000 }),
      ],
      FAIXAS,
    );
    expect(r.total).toBe(1231000);
    expect(r.comClube).toBe(2);
    expect(r.perto.map((c) => c.nome)).toEqual(["Bruno Reis"]);
    expect(r.porClube.map((x) => [x.clube.nome, x.n])).toEqual([
      ["Executive", 1],
      ["Platinum", 1],
    ]);
  });

  it("normaliza a resposta do banco (números como texto e comissão oculta = null)", () => {
    const d = normalizarRankingClubes({
      ano: 2026,
      valores_visiveis: false,
      faixas: [
        { nome: "100%", minimo: "334448" },
        { nome: "Executive", minimo: "167224" },
      ],
      corretores: [
        { user_id: "x", nome: null, comissao: null, comissao_ano: null, capt: "0.5", venda: 1 },
      ],
      times: [],
    });
    expect(d.faixas.map((f) => f.nome)).toEqual(["Executive", "100%"]);
    expect(d.corretores[0]).toMatchObject({
      nome: "Corretor",
      comissao: null,
      capt: 0.5,
      venda: 1,
    });
    expect(d.valores_visiveis).toBe(false);
  });
});

describe("Ranking e Clubes — telas", () => {
  it("selo do clube e 'Sem clube'", () => {
    expect(renderToStaticMarkup(createElement(SeloClube, { nome: "Platinum" }))).toContain(
      "Platinum",
    );
    expect(renderToStaticMarkup(createElement(SeloClube, { nome: null }))).toContain("Sem clube");
  });

  it("Mural: ranking mostra o selo de quem está em clube, sem valores", () => {
    const html = renderToStaticMarkup(
      createElement(RankingCard, {
        ranking: {
          data: [
            { user_id: "a", nome: "Ana", avatar_url: null, pontos: 3 },
            { user_id: "b", nome: "Bruno", avatar_url: null, pontos: 1 },
          ],
          error: null,
        },
        periodo: { ano: 2026, mes: 10 },
        meses: [{ ano: 2026, mes: 10 }],
        onPeriodo: () => {},
        selos: { a: "Executive" },
      }),
    );
    expect(html).toContain("Executive");
    expect(html.match(/data-testid="selo-clube"/g)?.length).toBe(1);
    expect(html).not.toMatch(/R\$/);
  });

  it("migration: só aditiva, faixas oficiais 2026 e rollback existente", () => {
    const sql = readFileSync("supabase/migrations/20261104120000_ranking_clubes.sql", "utf8");
    const rb = readFileSync("supabase/rollback/20261104120000_ranking_clubes.sql", "utf8");
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|ALTER TABLE)\b/i);
    for (const v of ["167224", "334448", "836120", "1672241", "2508361", "3344482", "6688963"])
      expect(sql).toContain(v);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.ranking_clubes_base\(uuid, date, date\) FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.carreira_ranking_clubes\(date, date\) FROM PUBLIC, anon/,
    );
    expect(rb).toContain("DROP FUNCTION IF EXISTS public.carreira_ranking_clubes(date, date)");
    expect(rb).toContain("origem = 'Regra REMAX Brasil 2026'");
  });
});
