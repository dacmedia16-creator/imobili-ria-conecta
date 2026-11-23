// @vitest-environment jsdom
/**
 * Meu Plano 2027 (t_7af25f25 + t_f219bc57, Denis 19/11): campo vazio com sugestão aparece em preto
 * com o selo "sugerido", conta como preenchido no % / selo da tela / PDF e NÃO é gravado. Sem botão
 * "Usar sugestão".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { calc, type Respostas } from "./regras";
import { PlanoCtx } from "@/components/minha-carreira/meu-plano/campos";
import { CorpoTela } from "@/components/minha-carreira/meu-plano/telas";
import { feitosDaTela, progresso, statusTela, sugestoes, textoSugestao } from "./telas";
import { conteudoPlanoPdf } from "./pdf-conteudo";

// Diagnóstico + o mínimo das telas 2 e 3 para as contas andarem.
const S: Respostas = {
  "d.conv": "42",
  "d.ticket": "700.000",
  "d.dias": "90",
  "d.ativos": "15",
  "op.0": "3.000",
  "es.aliq": "10",
  "m.faixa": "60",
  "m.pct": "3",
};

window.scrollTo = () => undefined;
afterEach(cleanup);

function tela(id: string, R: Respostas = S, ro = false) {
  const set = vi.fn();
  const ctx = { S: R, C: calc(R), set, ro, inicio: null };
  const r = render(
    createElement(PlanoCtx.Provider, { value: ctx }, createElement(CorpoTela, { id })),
  );
  return { ...r, set };
}

describe("sugestões: mesma fonte da conta, só nos campos vazios", () => {
  it("cada sugestão é o valor que calc() usa com o campo vazio (nenhuma conta muda)", () => {
    const C = calc(S);
    const sg = sugestoes(S, C);
    expect(sg["m.ticket"]).toBe(C.ticket);
    expect(sg["m.conv"]).toBe(C.conv);
    expect(sg["m.meses"]).toBe(C.mesesCarteira);
    expect(sg["mt.creIni"]).toBe(C.creIni);
    expect(sg["mt.novas"]).toBe(C.novas);
    expect(sg["mt.vendidas"]).toBe(C.vendidas);
    expect(sg["mt.canc"]).toBe(C.canc);
    expect(sg["mt.creFim"]).toBe(C.creFim);
    expect(sg["mt.tCapt"]).toBe(C.tCapt);
    expect(sg["mt.tVenda"]).toBe(C.tVenda);
    expect(sg["mt.comMedia"]).toBe(C.comMedia);
    expect(sg["fu.v2cre"]).toBe(C.txV2Cre);
    // Digitar exatamente a sugestão não muda nenhuma conta.
    const gravado: Respostas = { ...S };
    for (const [k, v] of Object.entries(sg)) gravado[k] = textoSugestao(v);
    const C2 = calc(gravado);
    for (const k of ["ticket", "conv", "trans", "captAno", "novas", "creFim", "vgc"] as const)
      expect(C2[k]).toBe(C[k]);
  });

  it("campo digitado não tem sugestão; sem dado anterior, também não", () => {
    expect(sugestoes({ ...S, "m.ticket": "500.000" }, calc(S))["m.ticket"]).toBeUndefined();
    const vazio = sugestoes({}, calc({}));
    expect(vazio["m.ticket"]).toBeUndefined();
    expect(vazio["m.conv"]).toBeUndefined();
    expect(vazio["mt.creFim"]).toBeUndefined();
  });

  it("ticket/conversão 0 no diagnóstico não viram sugestão", () => {
    const R = { ...S, "d.ticket": "0", "d.conv": "0" };
    const sg = sugestoes(R, calc(R));
    expect(sg["m.ticket"]).toBeUndefined();
    expect(sg["m.conv"]).toBeUndefined();
  });
});

describe("% e selo da tela contam a sugestão", () => {
  it("obrigatório vazio com sugestão conta; sem sugestão, não", () => {
    expect(statusTela("p27", S)).toBe("ok"); // m.ticket vem do diagnóstico
    expect(statusTela("p30", S)).toBe("ok"); // m.conv vem do diagnóstico
    expect(statusTela("p30", { "m.faixa": "60" })).toBe("vazio");
    expect(feitosDaTela("p27", { "m.faixa": "60", "m.pct": "3" })).toBe(2);
  });

  it("apagar o digitado volta a contar pela sugestão; o % não cai", () => {
    const digitado = { ...S, "m.ticket": "800.000" };
    expect(progresso({ ...digitado, "m.ticket": "" }).pct).toBe(progresso(digitado).pct);
  });

  it("sugestão que some (dado anterior apagado) deixa de contar", () => {
    const semConv = { ...S, "d.conv": "" };
    expect(statusTela("p30", semConv)).toBe("vazio");
    expect(progresso(semConv).pct).toBeLessThan(progresso(S).pct);
  });
});

describe("tela: sugestão em preto com selo 'sugerido', sem botão (t_f219bc57)", () => {
  it("campo vazio mostra o valor sugerido na cor de texto (preto), com o selo 'sugerido'", () => {
    const { container } = tela("p27");
    const inp = container.querySelector('input[data-k="m.ticket"]') as HTMLInputElement;
    expect(inp.value).toBe("");
    expect(inp.placeholder).toContain("700.000");
    expect(inp.className).toContain("placeholder:text-foreground");
    expect(inp.className).toContain("placeholder:opacity-100");
    expect(screen.getByTestId("selo-sugerido-m.ticket").textContent).toBe("sugerido");
  });

  it("não existe botão 'Usar sugestão' em nenhum campo (Denis: sem botão, com etiqueta)", () => {
    for (const id of ["p27", "p30", "p31", "p32", "p37"]) {
      const { container, unmount } = tela(id);
      expect(container.querySelector('[data-testid^="usar-sugestao-"]')).toBeNull();
      expect(container.textContent ?? "").not.toMatch(/usar sugest/i);
      unmount();
    }
  });

  it("digitar grava o digitado; a sugestão nunca é gravada sozinha", () => {
    const { container, set } = tela("p27");
    expect(set).not.toHaveBeenCalled();
    const inp = container.querySelector('input[data-k="m.ticket"]') as HTMLInputElement;
    fireEvent.change(inp, { target: { value: "650.000" } });
    // Campo em R$ (t_cd9141ab): grava o número puro.
    expect(set).toHaveBeenCalledWith("m.ticket", "650000");
  });

  it("campo digitado não mostra selo; apagar volta a mostrar a sugestão com selo", () => {
    tela("p27", { ...S, "m.ticket": "800.000" });
    expect(screen.queryByTestId("selo-sugerido-m.ticket")).toBeNull();
    cleanup();
    const { container } = tela("p27", { ...S, "m.ticket": "" });
    expect(screen.getByTestId("selo-sugerido-m.ticket")).toBeTruthy();
    const inp = container.querySelector('input[data-k="m.ticket"]') as HTMLInputElement;
    expect(inp.placeholder).toContain("700.000");
  });

  it("Metas (p32): todos os campos com sugestão ganham selo, também na visão somente leitura", () => {
    tela("p32", S, true);
    for (const k of ["mt.creIni", "mt.novas", "mt.canc", "mt.vendidas", "mt.creFim", "mt.comMedia"])
      expect(screen.getByTestId(`selo-sugerido-${k}`)).toBeTruthy();
  });
});

describe("foco: digitar num campo vazio com sugestão não perde o cursor (t_f99e4127)", () => {
  // Tela com estado de verdade: cada tecla grava em S e a tela redesenha, como no app.
  function TelaViva({ id, inicial }: { id: string; inicial: Respostas }) {
    const [R, setR] = useState<Respostas>(inicial);
    const ctx = {
      S: R,
      C: calc(R),
      set: (k: string, v: Respostas[string]) => setR((o) => ({ ...o, [k]: v })),
      ro: false,
      inicio: null,
    };
    return createElement(PlanoCtx.Provider, { value: ctx }, createElement(CorpoTela, { id }));
  }

  // Campos de quantidade aceitam no máximo 500 (trava t_125c4dd3): neles digita "120".
  // 4º item: como o campo mostra o digitado (R$ formatado nos campos de dinheiro, t_cd9141ab).
  const casos: [string, string, string, string][] = [
    ["p27", "m.ticket", "12000", "R$ 12.000"],
    ["p32", "mt.comMedia", "12000", "R$ 12.000"],
    ["p32", "mt.creFim", "120", "120"],
  ];
  for (const [id, k, digita, mostra] of casos)
    it(`${k}: vários caracteres seguidos ficam no mesmo campo, com foco`, () => {
      const { container } = render(createElement(TelaViva, { id, inicial: S }));
      const sel = `input[data-k="${k}"]`;
      const inp = container.querySelector(sel) as HTMLInputElement;
      expect(screen.getByTestId(`selo-sugerido-${k}`)).toBeTruthy();
      inp.focus();
      let txt = "";
      for (const c of digita) {
        txt += c;
        fireEvent.change(document.activeElement as HTMLInputElement, { target: { value: txt } });
        expect(container.querySelector(sel)).toBe(inp); // mesmo elemento: não foi recriado
        expect(document.activeElement).toBe(inp); // foco continua no campo
      }
      expect(inp.value).toBe(mostra);
      expect(screen.queryByTestId(`selo-sugerido-${k}`)).toBeNull();
      // Apagar volta a mostrar a sugestão no MESMO campo, ainda com foco.
      fireEvent.change(inp, { target: { value: "" } });
      expect(container.querySelector(sel)).toBe(inp);
      expect(document.activeElement).toBe(inp);
      expect(screen.getByTestId(`selo-sugerido-${k}`)).toBeTruthy();
    });
});

describe("PDF", () => {
  it("campo vazio com sugestão sai com o valor e '(sugerido)', não '—'", () => {
    const c = conteudoPlanoPdf({ respostas: S } as Parameters<typeof conteudoPlanoPdf>[0]);
    const p27 = c.secoes.find((s) => s.id === "p27")!;
    const ticket = p27.itens.find(
      (i) => i.k === "campo" && "rot" in i && i.rot === "4 · Meu ticket médio",
    ) as { val: string };
    expect(ticket.val).toContain("700.000");
    expect(ticket.val).toContain("(sugerido)");
  });
});
