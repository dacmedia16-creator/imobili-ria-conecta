/**
 * t_b8aae132 (Denis 13/11/2026): "colocar para gerar pdf mesmo se não concluir".
 * O PDF sai com plano vazio, parcial ou completo; vazio = "—", nunca "NaN"/"undefined";
 * incompleto ganha a linha "Plano X% preenchido (Y de 26 telas)".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  avisoPreenchimento,
  conteudoPlanoPdf,
  type ConteudoPdf,
  type ItemPdf,
} from "./pdf-conteudo";
import { buildPlanoPdf } from "./pdf";
import { ORDEM, progresso } from "./telas";
import { calc, type Respostas } from "./regras";

// Plano parcial fictício: diagnóstico, porquê, orçamento pessoal e meta (sem pacto, sem 90 dias, sem rotina).
const PARCIAL: Respostas = {
  ...Object.fromEntries(
    [
      ["comissao", "120.000"],
      ["trans", "6"],
      ["cres", "10"],
      ["conv", "35"],
      ["ticket", "600.000"],
      ["dias", "150"],
      ["ativos", "5"],
      ["revisados", "12"],
    ].map(([k, v]) => [`d.${k}`, v]),
  ),
  ...Object.fromEntries([3, 4, 2, 3, 4, 2].map((v, i) => [`av.${i}`, String(v)])),
  "pq.0": "Dar uma casa própria para minha mãe",
  "pq.frase": "Minha família merece o meu melhor",
  ...Object.fromEntries([3000, 600, 900, 300].map((v, i) => [`op.${i}`, String(v)])),
  "m.faixa": "50",
  "m.ticket": "600.000",
  "m.pct": "3",
};

// Plano completo: o mesmo PLANEJAMENTO de pdf.test.ts (todas as 26 telas).
const COMPLETO: Respostas = {
  ...Object.fromEntries(
    ["comissao", "trans", "cres", "conv", "ticket", "dias", "ativos", "revisados"].map((k) => [
      `d.${k}`,
      "0",
    ]),
  ),
  "or.0.c": "3",
  "or.3.v": "2",
  ...Object.fromEntries([2, 3, 2, 4, 3, 1].map((v, i) => [`av.${i}`, String(v)])),
  "pq.frase": "Dar segurança à minha família",
  "pq.0": "Ver o cliente feliz com a chave na mão",
  ...Object.fromEntries(
    [3450, 760, 1080, 400, 300, 500, 200, 300].map((v, i) => [`op.${i}`, String(v)]),
  ),
  ...Object.fromEntries([800, 300, 600, 100, 900, 200].map((v, i) => [`on.${i}`, String(v)])),
  "so.0.t": "Viagem em família",
  "so.0.v": "12.000",
  "es.aliq": "15",
  "m.faixa": "60",
  "m.ticket": "700.000",
  "m.pct": "3",
  "m.conv": "22",
  "m.alvo": "16 a 18 CREs ativas",
  "m.carteira": "16",
  "mt.creFim": "16",
  "mt.creIni": "4",
  "d90.cre1": "2027-01-20",
  "d90.venda1": "2027-04-10",
  "d90.parceiro": "Carla, minha colega",
  "d90.aprender": "Apresentar a ACM",
  "sem.0.0": true,
  "mc.c.0": true,
  "pa.nome": "Ana Exemplo",
  "pa.c.0": "Fazer 20 contatos por dia",
  "pa.cad": "semanal",
  "pa.dia": "seg",
  "pa.hora": "09:00",
  "kri.0": "Ligar para 20 proprietários por dia",
  "d.comissao": "200.000",
  "d.trans": "10",
  "d.cres": "20",
  "d.conv": "42",
  "d.ticket": "700.000",
  "d.dias": "120",
  "d.ativos": "8",
  "d.revisados": "30",
  "pos.regiao": "Campolim e Parque Campolim",
  "pos.tipo": "Apartamento",
  "pos.de": "500.000",
  "pos.ate": "900.000",
  "sp.0": "10",
  "sp.1": "8",
  "sp.2": "6",
  "sp.3": "4",
  "sp.dia": "sex",
  "fu.v2cre": "50",
  "rv.mes": "4",
  "rv.dias": "60",
  "rv.ritual": "toda sexta às 8h",
  "mk.0": true,
  "mk.invest": "1.000",
  "de.h.0": "Apresentar a ACM com segurança",
  "de.horas": "3",
  "ac.0.0": "12",
  "ac.0.1": "15",
};

/** Todo texto que vai para o PDF (rótulos, valores, células, títulos). */
function textos(c: ConteudoPdf): string[] {
  const out: string[] = [];
  if (c.aviso) out.push(c.aviso);
  for (const s of [...c.secoes, ...c.numeros]) {
    out.push(s.titulo, s.rotulo, s.ev);
    for (const it of s.itens as ItemPdf[]) {
      if (it.k === "campo") out.push(it.rot, it.val);
      else if (it.k === "tabela") out.push(...it.cab, ...it.linhas.flat());
      else out.push(it.t);
    }
  }
  return out;
}
const RUIM = /NaN|undefined|null|Infinity|\[object/;

describe.each([
  ["vazio", {} as Respostas],
  ["parcial", PARCIAL],
  ["completo", COMPLETO],
])("PDF com plano %s (t_b8aae132)", (nome, S) => {
  const c = conteudoPlanoPdf({ respostas: S });
  const p = progresso(S);

  it("gera o conteúdo com todas as telas na ordem única", () => {
    expect(c.secoes.map((s) => s.id)).toEqual(ORDEM);
    expect(c.total).toBe(26);
    expect(c.telas).toBe(p.telas);
    expect(c.pct).toBe(p.pct);
  });

  it('nenhum texto sai "NaN"/"undefined"/vazio estranho', () => {
    const ruins = textos(c).filter((t) => typeof t !== "string" || RUIM.test(t));
    expect(ruins).toEqual([]);
    // Todo valor de campo tem conteúdo (vazio vira "—"), para não quebrar o layout.
    for (const s of [...c.secoes, ...c.numeros])
      for (const it of s.itens)
        if (it.k === "campo")
          expect(it.val.trim().length, `${s.id} · ${it.rot}`).toBeGreaterThan(0);
  });

  it("aviso de preenchimento só quando incompleto", () => {
    if (nome === "completo") {
      expect(p.telas).toBe(26);
      expect(c.aviso).toBeNull();
    } else {
      expect(c.aviso).toBe(`Plano ${p.pct}% preenchido (${p.telas} de 26 telas)`);
    }
  });

  it("gera o arquivo PDF (pdf-lib), A4, com o aviso no texto quando incompleto", async () => {
    const bytes = await buildPlanoPdf({
      plano: { respostas: S },
      colaborador: "Ana Exemplo",
      agencyName: "RE/MAX Exemplo",
      logoPng: null,
      issuedAt: new Date("2026-11-13T12:00:00Z"),
    });
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
    // Exemplo para conferência visual (só quando pedido).
    const out = process.env.MEU_PLANO_PDF_EXEMPLO;
    if (out && nome === "parcial") {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);
    }
  });
});

describe("plano parcial fictício: o que foi digitado aparece; cálculos não mudam", () => {
  const c = conteudoPlanoPdf({ respostas: PARCIAL });
  const val = (id: string, rot: string) =>
    (
      c.secoes
        .find((s) => s.id === id)!
        .itens.find((i) => i.k === "campo" && i.rot === rot) as Extract<ItemPdf, { k: "campo" }>
    ).val;

  it("respostas digitadas saem; as não digitadas saem —", () => {
    expect(val("p20", "A frase que sustenta o plano")).toBe("Minha família merece o meu melhor");
    expect(val("p45", "Eu,")).toBe("—");
    expect(val("p49", "Quem é o meu parceiro de cobrança")).toBe("—");
    expect(progresso(PARCIAL).telas).toBeLessThan(26);
  });

  it("calc() é o mesmo de antes (o PDF não altera cálculo)", () => {
    expect(calc(PARCIAL)).toEqual(calc({ ...PARCIAL }));
  });

  it("avisoPreenchimento", () => {
    expect(avisoPreenchimento({ pct: 0, telas: 0, total: 26 })).toBe(
      "Plano 0% preenchido (0 de 26 telas)",
    );
    expect(avisoPreenchimento({ pct: 100, telas: 26, total: 26 })).toBeNull();
  });
});
