import { describe, expect, it } from "vitest";
import type { Respostas } from "./regras";
import {
  ORDEM,
  exercicioDaPagina,
  progresso,
  rotuloPagina,
  statusTela,
  telaDaPagina,
} from "./telas";

// Plano preenchido pelo book (caso da simulação de 11/11: "0% preenchido").
const S: Respostas = {
  "d.comissao": "200.000",
  "d.trans": "10",
  "d.cres": "20",
  "d.conv": "42",
  "d.ticket": "700.000",
  "d.dias": "90",
  "d.ativos": "15",
  "d.revisados": "30",
  "pq.frase": "Dar segurança à minha família",
  "op.0": "3.000",
  "es.aliq": "10",
  "m.faixa": "60",
  "m.pct": "3",
  "m.alvo": "11 a 15 CREs ativas",
};

describe("progresso no caminho único (Lote 1, item 4)", () => {
  it("conta pela ordem única, não devolve 0%", () => {
    const p = progresso(S);
    expect(p.pct).toBeGreaterThan(0);
    expect(p.total).toBe(ORDEM.length);
  });

  it("plano vazio continua 0%", () => {
    expect(progresso({}).pct).toBe(0);
  });

  it("campo em branco com sugestão válida conta como preenchido; sem sugestão, não", () => {
    // m.conv e m.ticket vazios, mas a conta usa o diagnóstico (42% e R$ 700 mil).
    expect(statusTela("p30", S)).toBe("ok");
    expect(statusTela("p27", S)).toBe("ok");
    // Sem diagnóstico, a conversão segue vazia.
    expect(statusTela("p30", { "m.faixa": "60" })).toBe("vazio");
  });

  it("mt.creFim em branco conta quando o estoque do fim do ano já está calculado", () => {
    const comMetas = { ...S, "op.0": "3.000", "on.0": "1.000", "so.0.v": "10.000" };
    expect(statusTela("p32", comMetas)).toBe("ok");
    expect(statusTela("p32", {})).toBe("vazio");
  });
});

describe("numeração e atalho do book (itens 1 e 10)", () => {
  it("mostra a página impressa e a do PDF", () => {
    expect(rotuloPagina(20)).toBe("pág. 19 · PDF 20");
    expect(rotuloPagina(1)).toBe("PDF 1");
  });

  it("do PDF 46 em diante segue o rodapé impresso do book (Anotações sem número)", () => {
    const esperado: Record<number, string> = {
      44: "pág. 43 · PDF 44",
      45: "pág. 44 · PDF 45",
      46: "PDF 46",
      47: "PDF 47",
      48: "PDF 48",
      49: "pág. 46 · PDF 49",
      50: "pág. 47 · PDF 50",
      51: "pág. 48 · PDF 51",
      52: "pág. 49 · PDF 52",
      53: "pág. 50 · PDF 53",
      54: "PDF 54",
      55: "PDF 55",
      56: "PDF 56",
    };
    for (const [pdf, rotulo] of Object.entries(esperado))
      expect(rotuloPagina(Number(pdf))).toBe(rotulo);
  });

  it("antes do PDF 46, página sem número impresso no rodapé mostra só 'PDF N'", () => {
    for (const pdf of [2, 3, 14, 18, 21, 26, 33, 35, 41, 42])
      expect(rotuloPagina(pdf)).toBe(`PDF ${pdf}`);
    // vizinhas com número impresso continuam com as duas numerações
    for (const pdf of [4, 13, 15, 17, 19, 20, 22, 25, 27, 32, 34, 36, 40, 43])
      expect(rotuloPagina(pdf)).toBe(`pág. ${pdf - 1} · PDF ${pdf}`);
  });

  it("a página 11 do PDF tem o próprio exercício (quadro de KRIs), sem atalho para as Metas", () => {
    expect(telaDaPagina(11)?.id).toBe("p11");
    expect(exercicioDaPagina(11)).toBeUndefined();
    expect(exercicioDaPagina(12)).toBeUndefined();
  });
});
