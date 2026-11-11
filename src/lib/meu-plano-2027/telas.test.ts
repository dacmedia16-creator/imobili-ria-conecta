import { describe, expect, it } from "vitest";
import type { Respostas } from "./regras";
import { ORDEM, exercicioDaPagina, progresso, rotuloPagina, statusTela } from "./telas";

// Plano preenchido pelo book, sem escolher trilha (caso da simulação de 11/11: "0% preenchido").
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

describe("progresso sem trilha escolhida (Lote 1, item 4)", () => {
  it("usa a trilha Planejamento em vez de devolver 0%", () => {
    const sem = progresso(S, null);
    expect(sem.pct).toBeGreaterThan(0);
    expect(sem).toEqual(progresso(S, "planejamento"));
    expect(sem.total).toBe(ORDEM.planejamento.length);
  });

  it("plano vazio continua 0%", () => {
    expect(progresso({}, null).pct).toBe(0);
    expect(progresso({}, undefined).pct).toBe(0);
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

  it("o mesmo plano com trilha Ativação continua contando só a Ativação", () => {
    expect(progresso(S, "ativacao").total).toBe(ORDEM.ativacao.length);
  });
});

describe("numeração e atalho do book (itens 1 e 10)", () => {
  it("mostra a página impressa e a do PDF", () => {
    expect(rotuloPagina(20)).toBe("pág. 19 · PDF 20");
    expect(rotuloPagina(1)).toBe("PDF 1");
  });

  it("a página 11 do PDF leva ao exercício das Metas", () => {
    expect(exercicioDaPagina(11)?.id).toBe("p32");
    expect(exercicioDaPagina(12)).toBeUndefined();
  });
});
