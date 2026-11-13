import { describe, expect, it } from "vitest";
import { calc, fmt, type Respostas } from "./regras";
import { CAMPO_VALIDO } from "./telas";
import { LINHAS_MES, chaveMes, distribuicaoMes, temMesDigitado } from "./meses";
import { MESES } from "./listas";

// Metas do exemplo: 24 novas CREs, 12 transações (só captação), comissão média fixa.
const BASE: Respostas = {
  "mt.novas": "24",
  "mt.canc": "6",
  "mt.vendidas": "6",
  "mt.tCapt": "12",
  "mt.tVenda": "0",
  "mt.comMedia": "10.000",
  "mt.creIni": "4",
};

export const todasChavesMes = () =>
  LINHAS_MES.flatMap((l) => MESES.map((_, i) => chaveMes(l.id, i + 1)));

describe("distribuição mês a mês (só planejamento)", () => {
  it("chaves mt.mes.<linha>.<mes> passam na mesma validação do banco (sem migration)", () => {
    const ks = todasChavesMes();
    expect(ks).toHaveLength(60);
    for (const k of ks) expect(CAMPO_VALIDO.test(k)).toBe(true);
    expect(chaveMes("novas", 12)).toBe("mt.mes.novas.12");
  });

  it("sem mês digitado: sugestão = anual ÷ 12, soma = meta anual, sem aviso", () => {
    const L = distribuicaoMes(BASE, calc(BASE));
    const novas = L.find((l) => l.id === "novas")!;
    expect(novas.anual).toBe(24);
    expect(novas.sugestao).toBe(2);
    expect(novas.meses.every((m) => m.usado === 2 && !m.temValor)).toBe(true);
    expect(novas.total).toBe(24);
    expect(L.some((l) => l.diverge)).toBe(false);
    expect(temMesDigitado(L)).toBe(false);
  });

  it("mês digitado entra na soma; vazios usam a sugestão; diferença só avisa", () => {
    const S = { ...BASE, "mt.mes.novas.1": "5" };
    const L = distribuicaoMes(S, calc(S));
    const novas = L.find((l) => l.id === "novas")!;
    expect(novas.meses[0]).toMatchObject({ digitado: 5, usado: 5, temValor: true });
    expect(novas.meses[1].usado).toBe(2);
    expect(novas.total).toBe(5 + 11 * 2); // 27
    expect(novas.diverge).toBe(true);
    expect(temMesDigitado(L)).toBe(true);
    expect(L.filter((l) => l.id !== "novas").every((l) => !l.diverge)).toBe(true);
  });

  it("meses que fecham a meta não avisam (aceita 0 digitado e vírgula decimal)", () => {
    const S: Respostas = { ...BASE };
    [1, 2, 3, 4].forEach((m) => (S[chaveMes("novas", m)] = "0"));
    [5, 6, 7, 8].forEach((m) => (S[chaveMes("novas", m)] = "4"));
    const novas = distribuicaoMes(S, calc(S)).find((l) => l.id === "novas")!;
    expect(novas.total).toBe(0 * 4 + 4 * 4 + 4 * 2); // 24 = meta
    expect(novas.diverge).toBe(false);

    const V = { ...BASE, "mt.mes.vgc.3": "10,5" };
    const vgc = distribuicaoMes(V, calc(V)).find((l) => l.id === "vgc")!;
    expect(vgc.meses[2].usado).toBe(10.5);
  });

  it("dízima da sugestão não gera aviso falso quando nada foi digitado", () => {
    const S = { ...BASE, "mt.novas": "25" };
    const novas = distribuicaoMes(S, calc(S)).find((l) => l.id === "novas")!;
    expect(fmt.dec(novas.sugestao)).toBe("2,1");
    expect(novas.diverge).toBe(false);
  });

  it("NENHUM número calculado muda: calc() é idêntico com e sem meses digitados", () => {
    const S: Respostas = { ...BASE };
    todasChavesMes().forEach((k, i) => (S[k] = String((i % 7) + 1)));
    expect(calc(S)).toEqual(calc(BASE));
  });
});
