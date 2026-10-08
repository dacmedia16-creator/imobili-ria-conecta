import { describe, expect, it } from "vitest";
import { planejarVenda, resumir, sqlPreenchimento, type VendaBackfill } from "./ficha-imovel-backfill";

const base = (over: Partial<VendaBackfill>): VendaBackfill => ({
  id: "00000000-0000-4000-8000-000000000001",
  codigo: "COD-1",
  corretor: "Corretor Fictício",
  tipo_imovel: null,
  area_util_m2: null,
  area_construida_m2: null,
  area_terreno_m2: null,
  extracoes: [],
  ...over,
});

const ap = base({
  extracoes: [
    {
      tipo: "matricula",
      raw: { area_total: "61,78", area_construida: "61,78", observacoes_imovel: "APARTAMENTO nº 21, área privativa de 54,80 m²" },
    },
    { tipo: "iptu", raw: { area_total: "21,58842064 m2", area_construida: "89,12 m2" } },
  ],
});

describe("planejarVenda", () => {
  it("apartamento: tipo + área útil (privativa); sem terreno (fração ideal)", () => {
    const p = planejarVenda(ap);
    expect(p.set).toEqual({ tipo_imovel: "Apartamento", area_util_m2: 54.8, area_construida_m2: 61.78 });
    expect(p.sem_area).toBe(false);
  });
  it("nunca sobrescreve o que a venda já tem", () => {
    const p = planejarVenda({ ...ap, tipo_imovel: "Cobertura", area_util_m2: 70 });
    expect(p.set.tipo_imovel).toBeUndefined();
    expect(p.set.area_util_m2).toBeUndefined();
  });
  it("sem leitura: nada a preencher e conta como sem área", () => {
    const p = planejarVenda(base({}));
    expect(p.set).toEqual({});
    expect(p.sem_area).toBe(true);
  });
  it("terreno: só área do terreno", () => {
    const p = planejarVenda(
      base({ extracoes: [{ tipo: "matricula", raw: { area_total: "595,00 m²", observacoes_imovel: "O lote de terreno nº 26" } }] }),
    );
    expect(p.set).toEqual({ tipo_imovel: "Terreno", area_terreno_m2: 595 });
    expect(p.sem_area).toBe(false);
  });
});

describe("resumir e SQL", () => {
  const planos = [planejarVenda(ap), planejarVenda(base({ id: "00000000-0000-4000-8000-000000000002", codigo: "COD-2" }))];
  it("contagens", () => {
    const r = resumir(planos);
    expect(r).toMatchObject({ total_vendas: 2, preencheria: 1, sem_area: 1, so_tipo: 0 });
    // 61,78 (matrícula) x 89,12 (IPTU): divergente, listado só com código e corretor
    expect(r.divergentes).toEqual([
      { codigo: "COD-1", corretor: "Corretor Fictício", matricula_m2: 61.78, iptu_m2: 89.12 },
    ]);
  });
  it("ensaio termina em ROLLBACK; só grava coluna vazia e marca documento sem confirmar", () => {
    const sql = sqlPreenchimento(planos);
    expect(sql.trim().endsWith("ROLLBACK;")).toBe(true);
    expect(sql).toContain("area_util_m2 = coalesce(area_util_m2, 54.8)");
    expect(sql).toContain("area_origem = coalesce(area_origem, 'documento')");
    expect(sql).not.toContain("area_confirmada");
    expect(sql).not.toContain("COD-2");
    expect(sqlPreenchimento(planos, true).trim().endsWith("COMMIT;")).toBe(true);
  });
});
