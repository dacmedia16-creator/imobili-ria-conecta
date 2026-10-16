import { describe, expect, it } from "vitest";
import {
  normalizarClube,
  normalizarRanking,
  periodoRanking,
  progressoClube,
  textoFaixa,
  validarFaixas,
} from "./minha-carreira-conquistas";

describe("Conquistas — ranking", () => {
  it("normaliza números do banco e mantém valores ocultos como null", () => {
    const r = normalizarRanking([
      {
        posicao: 1,
        user_id: "u2",
        nome: "Ana",
        captacoes: 1,
        vendas: "2",
        pontos: 3,
        vgv: null,
        comissao: null,
        eu: false,
        valores_visiveis: false,
      },
      {
        posicao: 2,
        user_id: "u1",
        nome: null,
        captacoes: 1,
        vendas: 0,
        pontos: 1,
        vgv: "500000",
        comissao: "9000",
        eu: true,
        valores_visiveis: false,
      },
    ]);
    expect(r[0]).toMatchObject({ vendas: 2, vgv: null, comissao: null, eu: false });
    expect(r[1]).toMatchObject({ nome: "Corretor", vgv: 500000, comissao: 9000, eu: true });
  });

  it("período do mês vai do dia 1 ao último dia; do ano, de jan a dez", () => {
    expect(periodoRanking("mes", "2026-02-10")).toEqual({
      inicio: "2026-02-01",
      fim: "2026-02-28",
    });
    expect(periodoRanking("mes", "2028-02-10").fim).toBe("2028-02-29");
    expect(periodoRanking("ano", "2026-10-16")).toEqual({
      inicio: "2026-01-01",
      fim: "2026-12-31",
    });
  });
});

describe("Conquistas — Clube RE/MAX", () => {
  const base = {
    ano: 2026,
    vgc_ano_anterior: "150000",
    clube_atual: "Executive",
    tabela_atual: 2025,
    vgc_ano_corrente: "15000",
    clube_buscando: null,
    proximo_clube: "Executive",
    falta_proximo: "117696",
    tabela_buscando: 2025,
    origem: "Tabela de referência 2025",
  };

  it("normaliza e calcula o progresso até o próximo clube", () => {
    const c = normalizarClube(base)!;
    expect(c.vgc_ano_anterior).toBe(150000);
    expect(c.falta_proximo).toBe(117696);
    expect(progressoClube(c)).toBeCloseTo((15000 / 132696) * 100, 5);
  });

  it("no último clube o progresso é 100%", () => {
    const c = normalizarClube({ ...base, proximo_clube: null, falta_proximo: null })!;
    expect(progressoClube(c)).toBe(100);
  });

  it("sem linha devolve null", () => {
    expect(normalizarClube(undefined)).toBeNull();
  });
});

describe("Conquistas — editor de faixas", () => {
  const ok = [
    { nome: "Executive", vgc_minimo: 132696 },
    { nome: "100%", vgc_minimo: 265393 },
  ];

  it("aceita faixas crescentes com nomes únicos", () => {
    expect(validarFaixas(ok)).toBeNull();
  });

  it("recusa lista vazia, nome vazio, repetido, valor negativo e ordem errada", () => {
    expect(validarFaixas([])).toMatch(/pelo menos uma/);
    expect(validarFaixas([{ nome: " ", vgc_minimo: 1 }])).toMatch(/nome/);
    expect(validarFaixas([...ok, { nome: "executive", vgc_minimo: 999999 }])).toMatch(/repetida/);
    expect(validarFaixas([{ nome: "A", vgc_minimo: -1 }])).toMatch(/inválido/);
    expect(validarFaixas([ok[1], { nome: "X", vgc_minimo: 1000 }])).toMatch(/subir/);
  });

  it("texto da faixa: até o início da próxima menos 1 centavo; a última é 'acima de'", () => {
    const fmt = (n: number) => n.toFixed(2);
    expect(textoFaixa(ok, 0, fmt)).toBe("132696.00 a 265392.99");
    expect(textoFaixa(ok, 1, fmt)).toBe("acima de 265393.00");
  });
});
