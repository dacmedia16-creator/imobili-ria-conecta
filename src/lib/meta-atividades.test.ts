import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calc, type Respostas } from "./meu-plano-2027/regras";
import {
  faixa,
  metasDoCalc,
  metasDoPlano,
  metasDoSnapshot,
  montarQuadro,
  ordenarPorDistancia,
  percentual,
  proximidade,
  rotulosPeriodo,
  semanaDe,
  snapshotDasMetas,
  snapshotMudou,
  textoLinha,
  type Feito,
} from "./meta-atividades";
import {
  ATIVIDADES,
  botoesDiario,
  contagem,
  nomeAtividade,
  normalizarContagens,
  resumoDia,
  agruparPorDia,
  normalizarRegistro,
  rotuloAtividade,
} from "./minha-carreira-diario";

// Mesmo exemplo impresso do book usado em regras.test.ts ("Ana Exemplo"):
// captMes 11, v2Mes 22, v1Mes 37, contSem 12.
const ANA: Respostas = {
  "d.comissao": "210000",
  "d.trans": "11",
  "d.conv": "22",
  "d.ticket": "700000",
  "d.dias": "118",
  "d.ativos": "14",
  "op.0": "3450",
  "op.1": "760",
  "op.2": "1080",
  "op.3": "1600",
  "op.4": "600",
  "op.5": "940",
  "op.6": "110",
  "op.7": "30",
  "on.0": "980",
  "on.1": "200",
  "on.2": "1350",
  "on.3": "59,99",
  "on.4": "570",
  "on.5": "200",
  "so.0.v": "40000",
  "so.1.v": "30000",
  "so.2.v": "5000",
  "es.aliq": "15",
  "m.faixa": "45",
  "m.ticket": "700000",
  "m.pct": "3",
  "m.conv": "22",
  "fu.v2cre": "50",
  "fu.v1v2": "60",
  "fu.folga": "25",
};

const zero: Feito = { ligacoes: 0, v1: 0, v2: 0, acm: 0, visitaComprador: 0, captMes: 0 };

describe("metas da semana a partir do Meu Plano 2027", () => {
  const C = calc(ANA);
  const m = metasDoPlano(ANA)!;

  it("usa a calc() existente (não repete fórmula)", () => {
    expect([C.contSem, C.v1Mes, C.v2Mes, C.captMes]).toEqual([12, 37, 22, 11]);
    expect(metasDoCalc(C)).toEqual(m);
    const src = readFileSync("src/lib/meta-atividades.ts", "utf8");
    expect(src).not.toMatch(/v2cre|v1v2|folga\s*\//); // nenhuma taxa do funil recalculada aqui
  });

  it("converte o mês em semana: ligações = contSem; V1/V2 = mês ÷ 4 para cima", () => {
    expect(m.ligacoes).toBe(12);
    expect(m.v1).toBe(10); // ceil(37 / 4)
    expect(m.v2).toBe(6); // ceil(22 / 4)
    expect(m.captMes).toBe(11);
    expect(m.mes).toEqual({ ligacoes: 48, v1: 37, v2: 22, acm: 22 });
  });

  it("meta de ACM = meta de V2", () => {
    expect(m.acm).toBe(m.v2);
    const outra = metasDoPlano({ ...ANA, "fu.v2cre": "40" })!;
    expect(outra.acm).toBe(outra.v2);
    expect(outra.v2).not.toBe(m.v2);
  });

  it("mudar o plano muda a meta na hora (mesma função, sem cache)", () => {
    const antes = metasDoPlano(ANA)!;
    const depois = metasDoPlano({ ...ANA, "fu.folga": "50" })!;
    expect(depois.ligacoes).toBeGreaterThan(antes.ligacoes);
  });

  it("taxas padrão da imobiliária entram como na calc()", () => {
    const sem = { ...ANA, "fu.v2cre": "", "fu.v1v2": "", "fu.folga": "" };
    expect(metasDoPlano(sem, { v2cre: 40, v1v2: 50, folga: 0 })?.v2).toBe(Math.ceil(28 / 4));
  });
});

describe("corretor sem plano", () => {
  it("sem respostas ou com plano incompleto = sem metas (mostra o convite)", () => {
    expect(metasDoPlano(null)).toBeNull();
    expect(metasDoPlano({})).toBeNull();
    expect(metasDoPlano({ "d.comissao": "100000" })).toBeNull();
  });
  it("tela mostra o convite com link para o plano", () => {
    const tela = readFileSync("src/components/minha-carreira/SuaSemana.tsx", "utf8");
    expect(tela).toContain("Faça seu Meu Plano 2027 para ver suas metas da semana.");
    expect(tela).toContain('to="/minha-carreira/plano"');
  });
});

describe("cópia das metas para o team leader (ms.*)", () => {
  const m = metasDoPlano(ANA)!;
  it("ida e volta sem perda", () => {
    expect(metasDoSnapshot(snapshotDasMetas(m))).toEqual(m);
  });
  it("só grava o que mudou; plano sem metas limpa a cópia", () => {
    const S = { ...ANA, ...snapshotDasMetas(m) };
    expect(snapshotMudou(S, m)).toEqual({});
    expect(snapshotMudou(ANA, m)["ms.lig"]).toBe(12);
    expect(Object.values(snapshotMudou(S, null)).every((v) => v === null)).toBe(true);
  });
  it("chaves passam na regra de campo do banco", () => {
    for (const k of Object.keys(snapshotDasMetas(m)))
      expect(k).toMatch(/^[a-z0-9]{1,8}(\.[A-Za-z0-9]{1,12}){0,3}$/);
  });
  it("cópia vazia = sem plano", () => {
    expect(metasDoSnapshot(null)).toBeNull();
    expect(metasDoSnapshot({ "ms.lig": 3 })).toBeNull();
  });
});

describe("cores por faixa", () => {
  it("verde quando bate; amarelo a partir de 70%; vermelho abaixo", () => {
    expect(faixa(12, 12)).toBe("verde");
    expect(faixa(15, 12)).toBe("verde");
    expect(faixa(7, 10)).toBe("amarelo"); // 70% exato
    expect(faixa(9, 10)).toBe("amarelo");
    expect(faixa(6, 10)).toBe("vermelho"); // 60%
    expect(faixa(0, 10)).toBe("vermelho");
    expect(faixa(0, 0)).toBe("verde"); // sem meta
  });
  it('texto "9 de 12" e "faltam 3"', () => {
    expect(textoLinha(9, 12)).toEqual({ de: "9 de 12", resto: "faltam 3" });
    expect(textoLinha(13, 12)).toEqual({ de: "13 de 12", resto: "meta batida" });
    expect(percentual(9, 12)).toBe(75);
    expect(percentual(30, 12)).toBe(100);
  });
});

describe('quadro e registros antigos "visita"', () => {
  it("visita antiga não entra em V1, V2 nem em nenhuma linha com meta", () => {
    const c = normalizarContagens([
      { tipo: "visita", hoje: 3, semana: 3, mes: 7 },
      { tipo: "v1", hoje: 1, semana: 2, mes: 4 },
      { tipo: "captacao", semana: 1, mes: 2 },
    ]);
    expect(contagem(c, "v1", "semana")).toBe(2);
    expect(contagem(c, "v2", "semana")).toBe(0);
    expect(c.atividades.map((a) => a.tipo)).toEqual([
      "ligacao",
      "v1",
      "v2",
      "acm",
      "visita_comprador",
      "visita",
    ]);
    expect(c.captacao).toEqual({ semana: 1, mes: 2 });
    const q = montarQuadro(
      { ...zero, v1: contagem(c, "v1", "semana") },
      { ligacoes: 0, v1: 4, v2: 0, acm: 0, visitaComprador: 0 },
      metasDoPlano(ANA)!,
    );
    expect(q.map((l) => l.chave)).toEqual(["ligacoes", "v1", "v2", "acm", "captMes"]);
    expect(q.find((l) => l.chave === "v1")?.feito).toBe(2);
  });
  it('aparece como "Visita (antiga)" no histórico', () => {
    expect(rotuloAtividade("visita")).toBe("Visita (antiga)");
    const dias = agruparPorDia([
      normalizarRegistro({
        id: "1",
        user_id: "u",
        dia: "2026-11-02",
        tipo: "visita",
        quantidade: 2,
      }),
      normalizarRegistro({ id: "2", user_id: "u", dia: "2026-11-02", tipo: "v2", quantidade: 1 }),
    ]);
    expect(resumoDia(dias[0])).toBe("1 V2 · 2 visitas (antigas)");
  });
  it('novos botões: V1, V2 e Visita com comprador; nenhum grava "visita"', () => {
    expect(ATIVIDADES.map((a) => a.tipo)).toEqual([
      "ligacao",
      "v1",
      "v2",
      "acm",
      "visita_comprador",
    ]);
    expect(botoesDiario(true).some((a) => a.tipo === "visita")).toBe(false);
    expect(nomeAtividade("visita_comprador", 2)).toBe("visitas com comprador");
  });
  it("sem o Meu Plano ligado, o diário fica como antes", () => {
    expect(botoesDiario(false).map((a) => a.tipo)).toEqual(["ligacao", "visita", "acm"]);
    expect(rotuloAtividade("visita", false)).toBe("Visita");
    const c = normalizarContagens([{ tipo: "visita", semana: 1, mes: 1, hoje: 1 }], false);
    expect(c.atividades.map((a) => a.tipo)).toEqual(["ligacao", "visita", "acm"]);
  });
});

describe("virada de semana (segunda a domingo)", () => {
  it("domingo fecha a semana; segunda abre outra", () => {
    expect(semanaDe("2026-11-08")).toEqual({ inicio: "2026-11-02", fim: "2026-11-08" }); // domingo
    expect(semanaDe("2026-11-09")).toEqual({ inicio: "2026-11-09", fim: "2026-11-15" }); // segunda
    expect(semanaDe("2026-11-04")).toEqual({ inicio: "2026-11-02", fim: "2026-11-08" }); // quarta
  });
  it("semana que atravessa mês e ano", () => {
    expect(semanaDe("2026-12-31")).toEqual({ inicio: "2026-12-28", fim: "2027-01-03" });
    expect(semanaDe("2027-01-03")).toEqual({ inicio: "2026-12-28", fim: "2027-01-03" });
  });
  it("rótulos do período", () => {
    expect(rotulosPeriodo("2026-11-08")).toEqual({
      semana: "Semana de 02/11 a 08/11",
      mes: "novembro",
    });
  });
});

describe("visão do gestor: ordem do mais longe para o mais perto, sem ranking", () => {
  const m = metasDoPlano(ANA)!; // 12 lig, 10 V1, 6 V2, 6 ACM
  const L = (nome: string, s: Partial<Feito>, metas = m as typeof m | null) => ({
    nome,
    metas,
    semana: { ...zero, ...s },
  });
  it("mais longe primeiro; sem plano no fim", () => {
    const r = ordenarPorDistancia([
      L("Bia", { ligacoes: 12, v1: 10, v2: 6, acm: 6 }),
      L("Caio", {}, null),
      L("Ana", { ligacoes: 3 }),
      L("Duda", { ligacoes: 12, v1: 5 }),
    ]);
    expect(r.map((x) => x.nome)).toEqual(["Ana", "Duda", "Bia", "Caio"]);
  });
  it("passar da meta não compensa outra linha", () => {
    expect(proximidade({ ...zero, ligacoes: 100 }, m)).toBe(0.25);
  });
  it("tela não mostra posição, pontos nem ranking", () => {
    const tela = readFileSync("src/components/minha-carreira/SuaSemana.tsx", "utf8");
    expect(tela).not.toMatch(/[0-9]º|posição|pontos:/i);
    expect(tela).not.toContain("proximidade(");
  });
});
