// @vitest-environment jsdom
/**
 * Meu Plano 2027 (cartão t_1bce8b3d): número da carteira alvo (book pág. 30) e quadro de KRIs (PDF 11).
 * Renderiza as telas com respostas fictícias, sem banco.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { calc, fmt, type Respostas } from "./regras";
import { CAMPO_VALIDO, KRIS, ORDEM, progresso, statusTela } from "./telas";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";

const S: Respostas = {
  "d.conv": "42",
  "d.ticket": "700.000",
  "d.ativos": "15",
  "d.dias": "90",
  "op.0": "3.000",
  "es.aliq": "10",
  "m.faixa": "60",
  "m.pct": "3",
};

function tela(id: string, R: Respostas = S) {
  const ctx = {
    S: R,
    C: calc(R),
    set: () => undefined,
    ro: true,
    inicio: null,
    trilha: "planejamento" as const,
  };
  return render(createElement(PlanoCtx.Provider, { value: ctx }, createElement(CorpoTela, { id })));
}

afterEach(cleanup);

describe("carteira alvo: número de CREs ativas (book pág. 30)", () => {
  it("campo numérico acima das 3 opções", () => {
    const { container } = tela("p31");
    const txt = container.textContent ?? "";
    const campo = txt.indexOf("Quantas CREs ativas quero manter ao longo de 2027");
    expect(campo).toBeGreaterThan(-1);
    expect(campo).toBeLessThan(txt.indexOf("11 a 15 CREs ativas"));
    expect(container.querySelector('input[data-k="m.carteira"]')).toBeTruthy();
  });

  it("é só registro: não muda nenhuma conta nem o % preenchido", () => {
    const com = { ...S, "m.carteira": "17" };
    expect(calc(com)).toEqual(calc(S));
    expect(progresso(com, "planejamento")).toEqual(progresso(S, "planejamento"));
    expect(progresso(com, "ativacao")).toEqual(progresso(S, "ativacao"));
  });
});

describe("quadro de KRIs: ações principais (book PDF 11; Caderno 1 pág. 24; Caderno 2 pág. 6)", () => {
  it("fica nas duas trilhas, logo depois do cockpit, como nos Cadernos", () => {
    for (const t of ["planejamento", "ativacao"] as const) {
      const o = ORDEM[t];
      expect(o.indexOf("p11")).toBe(o.indexOf("p52") + 1);
    }
  });

  it("6 campos de texto, um por KPI, na ordem do book", () => {
    const { container } = tela("p11");
    const ks = [...container.querySelectorAll("[data-k]")].map((e) => e.getAttribute("data-k"));
    expect(ks).toEqual(["kri.0", "kri.1", "kri.2", "kri.3", "kri.4", "kri.5"]);
    const txt = container.textContent ?? "";
    let ant = -1;
    for (const n of [
      "Novas CREs",
      "CREs Canceladas/Expiradas",
      "CREs Vendidas",
      "Transações de Captações",
      "Transações de Venda",
      "Ticket Médio por Transação",
    ]) {
      const i = txt.indexOf(`KPI · ${n}`);
      expect(i).toBeGreaterThan(ant);
      ant = i;
    }
    expect(container.querySelectorAll("textarea")).toHaveLength(6);
  });

  it("a frase do Objetivo usa os mesmos números das Metas, sem campo novo", () => {
    const C = calc(S);
    tela("p11");
    const frase = screen.getByTestId("kri-objetivo").textContent ?? "";
    expect(frase).toContain(`${fmt.int(C.creFim)} CREs ativas`);
    expect(frase).toContain(fmt.brl0(C.vgc));
    expect(KRIS.flatMap((g) => g.kpis.map((p) => p.k)).every((k) => k.startsWith("kri."))).toBe(
      true,
    );
  });

  it("as ações do book aparecem só como exemplo; campos começam vazios", () => {
    const { container } = tela("p11");
    expect(screen.getByText(/Exemplo do book: Contatos com agendamento/)).toBeTruthy();
    for (const el of container.querySelectorAll("textarea"))
      expect((el as HTMLTextAreaElement).value).toBe("");
  });

  it("não entra no % preenchido nem nas contas; a tela fica 'preenchida' com qualquer ação", () => {
    const com = { ...S, "kri.0": "20 contatos por dia" };
    expect(calc(com)).toEqual(calc(S));
    expect(progresso(com, "planejamento").pct).toBe(progresso(S, "planejamento").pct);
    expect(statusTela("p11", S)).toBe("vazio");
    expect(statusTela("p11", com)).toBe("ok");
    expect(progresso(com, "planejamento").telas).toBe(progresso(S, "planejamento").telas + 1);
  });

  it("nomes de campo aceitos pelo banco (mesma regra de carreira_plano_salvar)", () => {
    for (const k of ["m.carteira", ...KRIS.flatMap((g) => g.kpis.map((p) => p.k))])
      expect(CAMPO_VALIDO.test(k)).toBe(true);
  });
});
