// FASE 2 das telas (t_55ee647c), itens 16 e 17: vermelho só para atraso/vencida/exclusão/erro e
// nenhuma faixa colorida lateral. Só aparência.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTACAO_STATUS_TOM } from "./cores-status";
import { PAINEL_CARDS } from "./captacoes-painel";
import { seloSituacaoCaptacao } from "./captacao-venda";
import { VALIDITY_STYLE } from "./exclusive-captures";
import { FASE_STYLE } from "./exclusividades-por-corretor";
import { ETAPA_TOM } from "./leads";

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("item 17 — sem faixa colorida lateral", () => {
  it("nenhuma tela usa border-l-2/4/[6px] colorida", () => {
    const comFaixa = arquivos("src").filter((f) =>
      /border-l-(2|4|\[\d+px\])\b/.test(
        readFileSync(f, "utf8").replace(/border-l-2 border-transparent/g, ""),
      ),
    );
    expect(comFaixa).toEqual([]);
  });
});

describe("item 16 — mapa único de cor", () => {
  it("devolvida pede ajuste (âmbar), não erro", () => {
    expect(CAPTACAO_STATUS_TOM.devolvida).toContain("amber");
    expect(PAINEL_CARDS.find((c) => c.key === "devolvidas")?.classe).toContain("amber");
  });
  it("vez do gestor tem a mesma cor (laranja) na lista e na aba Por corretor", () => {
    expect(CAPTACAO_STATUS_TOM.enviada).toContain("orange");
    expect(FASE_STYLE.gestor).toContain("orange");
    expect(PAINEL_CARDS.find((c) => c.key === "aguardando_gestor")?.classe).toContain("orange");
  });
  it("vencida é vermelha em todas as telas; violeta fica só para cadastro manual", () => {
    expect(VALIDITY_STYLE.vencida).toContain("red");
    expect(FASE_STYLE.vencida).toContain("red");
    expect(VALIDITY_STYLE.urgente).not.toContain("red");
    expect(FASE_STYLE.assinatura).not.toContain("violet");
    expect(seloSituacaoCaptacao("vendida")?.classe).not.toContain("violet");
  });
  it("lead perdido não é vermelho", () => {
    expect(ETAPA_TOM.perdido).not.toBe("red");
  });
  it("Sua vez e comentários pendentes no azul da marca", () => {
    const inicio = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
    expect(inicio).toMatch(/bg-primary\/10[^"]*text-primary">\s*Sua vez/);
    expect(inicio).not.toContain('tone="red"');
    const venda = readFileSync("src/routes/_authenticated/vendas.$id.tsx", "utf8");
    expect(venda).not.toContain('"border-red-500 text-red-600');
  });
});
