import { describe, expect, it } from "vitest";
import { calc, metaOficialDoPlano, type Respostas } from "./regras";
import { CAMPO_VALIDO } from "./telas";
import {
  DIGITA,
  chaveMes,
  chavesTabela,
  sugestoesMes,
  tabelasMes,
  temMesDigitado,
  type IdLinhaMes,
} from "./meses";

// Números da maquete t_88a3e82e: 15 ativos no início, 56 novas, 19 canceladas, 37 vendidas;
// 37 transações de captação + 37 de venda, comissão média R$ 5.625 → VGC R$ 416.250.
const BASE: Respostas = {
  "mt.creIni": "15",
  "mt.novas": "56",
  "mt.canc": "19",
  "mt.vendidas": "37",
  "mt.tCapt": "37",
  "mt.tVenda": "37",
  "mt.comMedia": "5.625",
};

const linha = (S: Respostas, id: IdLinhaMes) =>
  tabelasMes(S, calc(S))
    .flatMap((t) => t.linhas)
    .find((l) => l.id === id)!;
const usados = (S: Respostas, id: IdLinhaMes) => linha(S, id).meses.map((m) => m.usado);
const todasChaves = () => [...chavesTabela("cres"), ...chavesTabela("vgc")];

describe("metas mês a mês: 2 tabelas iguais à cartilha (9 linhas)", () => {
  it("estrutura: CREs (4 linhas) e VGC (5 linhas), calculadas marcadas", () => {
    const T = tabelasMes(BASE, calc(BASE));
    expect(T.map((t) => t.id)).toEqual(["cres", "vgc"]);
    expect(T[0].linhas.map((l) => [l.id, l.calc])).toEqual([
      ["novas", false],
      ["canc", false],
      ["vendidas", false],
      ["estoque", true],
    ]);
    expect(T[1].linhas.map((l) => [l.id, l.calc])).toEqual([
      ["tcapt", false],
      ["tvenda", false],
      ["com", false],
      ["trans", true],
      ["vgc", true],
    ]);
  });

  it("chaves mt.mes.<linha>.<mes> passam na validação do banco (sem migration)", () => {
    const ks = todasChaves();
    expect(ks).toHaveLength(72);
    for (const k of ks) expect(CAMPO_VALIDO.test(k)).toBe(true);
    expect(chaveMes("tcapt", 12)).toBe("mt.mes.tcapt.12");
  });

  it("sugestão = anual ÷ 12 em inteiros que fecham o ano", () => {
    expect(sugestoesMes(56)).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4]);
    expect(sugestoesMes(37)).toEqual([4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(sugestoesMes(24)).toEqual(Array(12).fill(2));
    expect(sugestoesMes(NaN).every(Number.isNaN)).toBe(true);
    for (const n of [0, 1, 11, 19, 56, 127])
      expect(sugestoesMes(n).reduce((a, b) => a + b)).toBe(n);
  });

  it("sem nada digitado: tudo bate com o ano, sem aviso", () => {
    const T = tabelasMes(BASE, calc(BASE));
    expect(temMesDigitado(T)).toBe(false);
    expect(T.flatMap((t) => t.linhas).some((l) => l.diverge)).toBe(false);
    expect(linha(BASE, "novas").anual).toBe(56);
    expect(linha(BASE, "vgc").anual).toBe(416250);
    expect(linha(BASE, "trans").anual).toBe(74);
  });

  it("estoque acumulado: início + novas − canceladas − vendidas, mês a mês; anual = dezembro", () => {
    const e = usados(BASE, "estoque");
    // Jan: 15 + 5 − 2 − 4 = 14 ... cada mês parte do anterior.
    expect(e[0]).toBe(14);
    let corre = 15;
    const n = sugestoesMes(56);
    const c = sugestoesMes(19);
    const v = sugestoesMes(37);
    e.forEach((x, i) => {
      corre += n[i] - c[i] - v[i];
      expect(x).toBe(corre);
    });
    expect(e[11]).toBe(15 + 56 - 19 - 37); // 15 = estoqueFim do calc()
    expect(linha(BASE, "estoque").anual).toBe(calc(BASE).estoqueFim);
    // Mês digitado muda o estoque dali em diante.
    const S = { ...BASE, "mt.mes.novas.3": "10" };
    const e2 = usados(S, "estoque");
    expect(e2[1]).toBe(e[1]);
    expect(e2[2]).toBe(e[2] + 5);
    expect(e2[11]).toBe(e[11] + 5);
  });

  it("transações = captação + venda em cada mês", () => {
    const S = { ...BASE, "mt.mes.tcapt.1": "6", "mt.mes.tvenda.2": "0" };
    const t = usados(S, "trans");
    expect(t[0]).toBe(6 + 4);
    expect(t[1]).toBe(3 + 0);
    expect(t[2]).toBe(3 + 3);
    expect(linha(S, "trans").anual).toBe(t.reduce((a, b) => a + b));
    // Venda sem meta (vazia) conta 0, como em calc().
    const sv = { ...BASE, "mt.tVenda": "" };
    expect(usados(sv, "trans")).toEqual(sugestoesMes(37));
  });

  it("VGC com a comissão do ano em todos os meses = VGC anual", () => {
    const com = linha(BASE, "com");
    expect(com.meses.every((m) => m.usado === 5625 && !m.temValor)).toBe(true);
    expect(com.anual).toBe(5625);
    const v = usados(BASE, "vgc");
    expect(v[0]).toBe(8 * 5625); // 45.000
    expect(v[1]).toBe(6 * 5625); // 33.750
    expect(linha(BASE, "vgc").anual).toBe(calc(BASE).vgc);
  });

  it("VGC com a comissão de UM mês alterada: só aquele mês muda e a soma avisa", () => {
    const S = { ...BASE, "mt.mes.com.12": "7.000" };
    const v = usados(S, "vgc");
    const v0 = usados(BASE, "vgc");
    expect(v[11]).toBe(6 * 7000);
    expect(v.slice(0, 11)).toEqual(v0.slice(0, 11));
    const l = linha(S, "vgc");
    expect(l.anual).toBe(416250 + 6 * (7000 - 5625));
    expect(l.diverge).toBe(true);
    expect(l.meta).toBe(416250);
    expect(linha(S, "com").anual).toBe(5625); // o anual da comissão continua o valor do ano
    expect(temMesDigitado(tabelasMes(S, calc(S)))).toBe(true);
  });

  it("aviso quando a soma dos meses ≠ meta do ano (só na linha alterada)", () => {
    const S = { ...BASE, "mt.mes.vendidas.12": "5" }; // maquete: 39 em vez de 37
    const l = linha(S, "vendidas");
    expect(l.anual).toBe(39);
    expect(l.diverge).toBe(true);
    expect(linha(S, "novas").diverge).toBe(false);
    // Meses que fecham a meta não avisam (aceita 0 e vírgula).
    const F: Respostas = { ...BASE, "mt.mes.vendidas.1": "0", "mt.mes.vendidas.2": "7" };
    expect(linha(F, "vendidas").diverge).toBe(false);
  });

  it("meta anual oficial e calc() NÃO mudam com qualquer mês digitado", () => {
    const S: Respostas = { ...BASE };
    todasChaves().forEach((k, i) => (S[k] = String((i % 7) + 1)));
    expect(calc(S)).toEqual(calc(BASE));
    expect(metaOficialDoPlano(calc(S))).toEqual(metaOficialDoPlano(calc(BASE)));
  });

  it("plano antigo: novas/canc/vendidas digitados continuam; mt.mes.trans.* e mt.mes.vgc.* são ignorados", () => {
    const antigo: Respostas = {
      ...BASE,
      "mt.mes.novas.1": "9",
      "mt.mes.canc.2": "3",
      "mt.mes.vendidas.3": "1",
      "mt.mes.trans.1": "99",
      "mt.mes.vgc.1": "999",
    };
    expect(linha(antigo, "novas").meses[0]).toMatchObject({ usado: 9, temValor: true });
    expect(linha(antigo, "canc").meses[1]).toMatchObject({ usado: 3, temValor: true });
    expect(linha(antigo, "vendidas").meses[2]).toMatchObject({ usado: 1, temValor: true });
    const semVelhas = { ...antigo };
    delete semVelhas["mt.mes.trans.1"];
    delete semVelhas["mt.mes.vgc.1"];
    expect(tabelasMes(antigo, calc(antigo))[1]).toEqual(tabelasMes(semVelhas, calc(semVelhas))[1]);
    expect(usados(antigo, "trans")[0]).toBe(8);
    // As chaves antigas não estão entre as que a tela grava/limpa.
    expect(todasChaves().some((k) => /^mt\.mes\.(trans|vgc)\./.test(k))).toBe(false);
    expect(DIGITA.cres).toEqual(["novas", "canc", "vendidas"]);
  });

  it("sem base (plano vazio): números ficam — (NaN), sem aviso", () => {
    const T = tabelasMes({}, calc({}));
    const all = T.flatMap((t) => t.linhas);
    expect(all.some((l) => l.diverge)).toBe(false);
    expect(Number.isNaN(linha({}, "vgc").anual)).toBe(true);
  });
});
