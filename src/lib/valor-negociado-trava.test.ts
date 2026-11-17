import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VALOR_NEGOCIADO_LIMITES,
  erroValorNegociado,
  erroValorNegociadoNoPatch,
  mensagemErroTetoBanco,
} from "@/lib/valor-negociado-trava";
import { linhaNoChipDaEsteira, resumoEsteira } from "@/lib/esteira-resumo";

describe("trava de valor negociado (t_9f5f3ae2)", () => {
  it("bloqueia R$ 281.600.000 contra anunciado de R$ 397.000 (caso real 630601205-33)", () => {
    const msg = erroValorNegociado(281_600_000, 397_000);
    expect(msg).toBe(
      "O valor negociado está muito diferente do anunciado (R$ 397.000,00). Confira os zeros.",
    );
  });
  it("aceita R$ 380.000 contra anunciado de R$ 397.000", () => {
    expect(erroValorNegociado(380_000, 397_000)).toBeNull();
  });
  it("mais que o dobro ou menos que a metade do anunciado bloqueia; nas bordas passa", () => {
    expect(erroValorNegociado(800_001, 400_000)).toMatch(
      /muito diferente do anunciado \(R\$ 400\.000,00\)/,
    );
    expect(erroValorNegociado(199_999, 400_000)).toMatch(/muito diferente/);
    expect(erroValorNegociado(800_000, 400_000)).toBeNull();
    expect(erroValorNegociado(200_000, 400_000)).toBeNull();
  });
  it("sem anunciado vale só o teto absoluto", () => {
    expect(erroValorNegociado(99_000_000, null)).toBeNull();
    expect(erroValorNegociado(281_600_000, null)).toMatch(/limite de R\$ 100\.000\.000,00/);
    expect(erroValorNegociado(281_600_000, 0)).toMatch(/limite/);
  });
  it("teto vale mesmo com anunciado alto", () => {
    expect(erroValorNegociado(120_000_000, 100_000_000)).toMatch(/limite/);
  });
  it("vazio ou zero não é bloqueado aqui (obrigatoriedade continua nas regras de envio)", () => {
    expect(erroValorNegociado(null, 397_000)).toBeNull();
    expect(erroValorNegociado(0, 397_000)).toBeNull();
  });
  it("só confere quando negociado ou anunciado muda (venda antiga não trava outros campos)", () => {
    const antiga = { valor_negociado: 265_000, valor_anunciado: 26_500 };
    expect(erroValorNegociadoNoPatch({ midia: "Portal" }, antiga)).toBeNull();
    expect(erroValorNegociadoNoPatch({ valor_negociado: 266_000 }, antiga)).toMatch(
      /muito diferente/,
    );
    expect(erroValorNegociadoNoPatch({ valor_anunciado: 265_000 }, antiga)).toBeNull();
  });
  it("traduz o erro do CHECK do banco", () => {
    expect(
      mensagemErroTetoBanco({
        code: "23514",
        message: 'violates check constraint "sales_valor_negociado_teto"',
      }),
    ).toMatch(/Confira os zeros/);
    expect(mensagemErroTetoBanco({ code: "23514", message: "outro" })).toBeNull();
  });
  it("teto da tela é o mesmo da migration", () => {
    const sql = readFileSync(
      "supabase/migrations/20261202120000_sales_valor_negociado_teto.sql",
      "utf8",
    );
    expect(sql).toContain(`valor_negociado <= ${VALOR_NEGOCIADO_LIMITES.tetoAbsoluto}`);
    expect(sql).toContain("NOT VALID");
  });
  it("as quatro portas de gravação usam a trava", () => {
    const venda = readFileSync("src/routes/_authenticated/vendas.$id.tsx", "utf8");
    expect(venda.match(/erroValorNegociadoNoPatch\(/g)).toHaveLength(2); // Resumo + Ocorrência
    const lanc = readFileSync("src/components/vendas/LancamentoDetail.tsx", "utf8");
    expect(lanc.match(/erroValorNegociado\(/g)).toHaveLength(2); // Resumo + edição financeira
  });
});

describe("esteira sem rascunho no total (t_9f5f3ae2)", () => {
  const linhas = [
    { status: "rascunho", valor_negociado: 281_600_000 },
    { status: "rascunho", valor_negociado: null },
    { status: "enviada_revisao", valor_negociado: 500_000 },
    { status: "aguardando_assinatura", valor_negociado: "700000" },
    { status: "contrato_assinado", valor_negociado: 1_000_000 },
  ];
  it("total e contagem somam só as enviadas", () => {
    const r = resumoEsteira(linhas);
    expect(r.enviadas).toEqual({ quantidade: 2, valor: 1_200_000 });
  });
  it("chip Rascunho continua com quantidade e valor, por último", () => {
    const r = resumoEsteira(linhas);
    expect(r.rascunho).toEqual({ quantidade: 2, valor: 281_600_000 });
    expect(r.porEtapa.at(-1)).toEqual({ status: "rascunho", quantidade: 2, valor: 281_600_000 });
    expect(r.porEtapa.map((e) => e.status)).toEqual([
      "enviada_revisao",
      "aguardando_assinatura",
      "rascunho",
    ]);
  });
  it("chip Todas enviadas não lista rascunho; chip Rascunho lista só rascunho", () => {
    expect(linhaNoChipDaEsteira("rascunho", "todas")).toBe(false);
    expect(linhaNoChipDaEsteira("enviada_revisao", "todas")).toBe(true);
    expect(linhaNoChipDaEsteira("rascunho", "rascunho")).toBe(true);
    expect(linhaNoChipDaEsteira("enviada_revisao", "rascunho")).toBe(false);
  });
});
