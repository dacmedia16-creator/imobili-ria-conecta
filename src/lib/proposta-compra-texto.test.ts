import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MARCA_MINUTA,
  dataExtenso,
  faltasCadastro,
  montarTextoProposta,
  somarDiasIso,
  textoPlano,
  valorExtenso,
  type ParteTexto,
  type TextoInput,
} from "@/lib/proposta-compra-texto";
import { buildPropostaPdf } from "@/lib/proposta-compra-pdf";
import { lerDetalhe } from "@/lib/proposta-compra-tela";

// Texto oficial (Campolim ajustado, t_b4e7c368): cada trecho condicional entra só quando existe.
const HOJE = "2026-11-09";
const CAD = {
  nome: "RE/MAX Teste",
  razao_social: "Teste Imóveis Ltda",
  cnpj: "12345678000190",
  creci: "CRECI: 29.886-J",
  endereco: "Av. Fictícia, 100 - Campolim",
  cidade: "Sorocaba",
  uf: "SP",
  corretor_creci: "123456-F",
};
const parte = (papel: ParteTexto["papel"], extra: Partial<ParteTexto> = {}): ParteTexto => ({
  papel,
  ordem: 1,
  tipoPessoa: "fisica",
  nome: `${papel} fictício`,
  cpfCnpj: "11122233344",
  estadoCivil: "solteiro",
  telefone: "15999990000",
  email: null,
  ...extra,
});
function base(extra: Partial<TextoInput> = {}): TextoInput {
  return {
    documento: "PC-TESTE001",
    versao: 1,
    imovel: { tipo: "Apartamento", endereco: "Rua Exemplo, 1", cidade: "Sorocaba", uf: "SP" },
    valorOferta: 500000,
    formaPagamento: "a_vista",
    sinalValor: null,
    sinalPrazoDias: null,
    sinalTipo: "confirmatorias",
    financiamentoBanco: null,
    financiamentoValor: null,
    validadeDias: 5,
    prazoContratoDias: 15,
    certidoes: "vendedor_apresenta",
    observacoes: null,
    termos: {},
    cadastro: CAD,
    documentoData: HOJE,
    corretorNome: "Corretora Fictícia",
    partes: [parte("comprador"), parte("vendedor"), parte("corretor", { cpfCnpj: null })],
    ...extra,
  };
}
const txt = (e: Partial<TextoInput> = {}) => textoPlano(montarTextoProposta(base(e), HOJE));

describe("valores e datas por extenso", () => {
  it("reais, centavos, milhão e data", () => {
    expect(valorExtenso(485000)).toBe("quatrocentos e oitenta e cinco mil reais");
    expect(valorExtenso(1000000)).toBe("um milhão de reais");
    expect(valorExtenso(1.01)).toBe("um real e um centavo");
    expect(dataExtenso("2026-11-09")).toBe("9 de novembro de 2026");
    expect(somarDiasIso("2026-12-30", 5)).toBe("2027-01-04");
  });
});

describe("validade (D9: 5 dias corridos da data do documento)", () => {
  it("padrão 5 dias corridos com a data-limite", () => {
    expect(txt()).toContain("válida por 5 dias corridos, até 23h59 de 14/11/2026");
  });
  it("1 dia fica no singular", () => {
    expect(txt({ validadeDias: 1 })).toContain("válida por 1 dia corrido, até 23h59 de 10/11/2026");
  });
});

describe("tipo de sinal", () => {
  const sinal = { formaPagamento: "sinal_parcelas" as const, sinalValor: 50000, sinalPrazoDias: 2 };
  it("confirmatórias (padrão)", () => {
    const t = txt(sinal);
    expect(t).toContain("arras confirmatórias (arts. 417 a 419 do Código Civil)");
    expect(t).not.toContain("penitenciais");
    expect(t).toContain("R$ 50.000,00 (cinquenta mil reais), por PIX, em até 2 (dois) dias úteis");
  });
  it("penitenciais", () => {
    const t = txt({ ...sinal, sinalTipo: "penitenciais" });
    expect(t).toContain("arras penitenciais (art. 420 do Código Civil)");
    expect(t).toContain("direito de arrependimento");
    expect(t).not.toContain("arras confirmatórias");
  });
  it("à vista: sem item de sinal no pagamento", () => {
    expect(txt()).not.toContain("Sinal e princípio de pagamento");
  });
});

describe("trechos condicionais do pagamento", () => {
  it("financiamento + FGTS: itens e seção 'Financiamento e FGTS'", () => {
    const t = txt({
      formaPagamento: "sinal_financiamento",
      sinalValor: 50000,
      sinalPrazoDias: 2,
      financiamentoBanco: "Caixa",
      financiamentoValor: 400000,
      termos: { fgts_valor: 50000, fin_prazo_dias: 45 },
    });
    expect(t).toContain("Financiamento bancário (Caixa): R$ 400.000,00");
    expect(t).toContain("Recursos do FGTS do(a) proponente: R$ 50.000,00");
    expect(t).toContain("Financiamento e FGTS");
    expect(t).toContain("em até 45 dias da entrega da documentação");
  });
  it("sem financiamento nem FGTS: a seção não aparece", () => {
    expect(txt()).not.toContain("Financiamento e FGTS");
    expect(txt()).not.toContain("FGTS");
  });
  it("só FGTS (sem financiamento) ainda traz a condição suspensiva", () => {
    const t = txt({ termos: { fgts_valor: 30000 } });
    expect(t).toContain("Financiamento e FGTS");
    expect(t).not.toContain("Financiamento bancário");
  });
  it("permuta", () => {
    const t = txt({ termos: { permuta_descricao: "Carro fictício 2020", permuta_valor: 80000 } });
    expect(t).toContain(
      "Permuta: Carro fictício 2020, avaliado(a) pelas partes em R$ 80.000,00 (oitenta mil reais)",
    );
    expect(txt()).not.toContain("Permuta:");
  });
  it("parcelas diretas e recursos próprios", () => {
    const t = txt({
      termos: { parcelas: "10 parcelas de R$ 5.000,00.", proprios_valor: 100000 },
    });
    expect(t).toContain("Parcelas diretas com o(a) vendedor(a): 10 parcelas de R$ 5.000,00.");
    expect(t).toContain(
      "Recursos próprios: R$ 100.000,00 (cem mil reais), na assinatura da escritura.",
    );
    expect(txt()).not.toContain("Parcelas diretas");
  });
});

describe("partes", () => {
  it("comprador casado: regime e cônjuge; solteiro: sem", () => {
    const t = txt({
      partes: [
        parte("comprador", { estadoCivil: "casado" }),
        parte("comprador_conjuge", { nome: "Cônjuge Fictícia", cpfCnpj: "55566677788" }),
        parte("vendedor"),
      ],
      termos: { comprador_regime: "comunhão parcial de bens" },
    });
    expect(t).toContain("Regime de bens: comunhão parcial de bens");
    expect(t).toContain("Cônjuge / companheiro(a): Cônjuge Fictícia");
    expect(t).toContain("555.666.777-88");
    expect(t).toContain("Cônjuge / companheiro(a) do(a) proponente");
    expect(txt()).not.toContain("Regime de bens");
  });
  it("vendedor casado: outorga do cônjuge no aceite e nos signatários", () => {
    const t = txt({
      partes: [
        parte("comprador"),
        parte("vendedor", { estadoCivil: "uniao_estavel" }),
        parte("vendedor_conjuge", { nome: "Esposa Vendedor" }),
      ],
    });
    expect(t).toContain("e de seu cônjuge ou companheiro(a)");
    expect(t).toContain("Cônjuge do(a) vendedor(a) - outorga (art. 1.647 do CC)");
  });
  it("comprador pessoa jurídica: razão social, CNPJ, representante", () => {
    const t = txt({
      partes: [
        parte("comprador", {
          tipoPessoa: "juridica",
          nome: "Empresa Fictícia Ltda",
          cpfCnpj: "11222333000144",
          estadoCivil: null,
        }),
        parte("vendedor"),
      ],
      termos: { comprador_representante: "Sócio Fictício", comprador_cargo: "Sócio-administrador" },
    });
    expect(t).toContain("Razão social: Empresa Fictícia Ltda");
    expect(t).toContain("CNPJ: 11.222.333/0001-44");
    expect(t).toContain("Representante legal: Sócio Fictício");
    expect(t).toContain("representada por Sócio Fictício");
    expect(t).not.toContain("RG:");
  });
});

describe("demais condicionais", () => {
  it("itens que ficam × nenhum item", () => {
    expect(txt({ termos: { itens: "Armários da cozinha e ar-condicionado." } })).toContain(
      "Armários da cozinha e ar-condicionado. Esses itens integram o preço",
    );
    expect(txt()).toContain("Nenhum item além das benfeitorias fixas");
  });
  it("certidões dispensadas tiram a cláusula", () => {
    expect(txt()).toContain("Se as certidões do imóvel");
    expect(txt({ certidoes: "dispensadas" })).not.toContain("Se as certidões do imóvel");
  });
  it("outras condições só com observação", () => {
    expect(txt({ observacoes: "Entrega com pintura nova." })).toContain("Outras condições");
    expect(txt()).not.toContain("Outras condições");
  });
  it("prazo do contrato (padrão 15 dias)", () => {
    expect(txt({ prazoContratoDias: null })).toContain("em até 15 dias");
    expect(txt({ prazoContratoDias: 20 })).toContain("em até 20 dias");
  });
});

describe("dados da imobiliária vêm do cadastro (sem inventar)", () => {
  it("cadastro completo: razão social, CNPJ, CRECI-J e endereço; sem aviso", () => {
    const tx = montarTextoProposta(base(), HOJE);
    const t = textoPlano(tx);
    expect(t).toContain("Teste Imóveis Ltda");
    expect(t).toContain("CNPJ 12.345.678/0001-90");
    expect(t).toContain("CRECI 29.886-J");
    expect(t).toContain("Av. Fictícia, 100 - Campolim");
    expect(t).toContain("corretor(a) corretor fictício (CRECI 123456-F)");
    expect(tx.avisos).toEqual([]);
  });
  it("faltando dado: trecho fica fora e o corretor vê o aviso", () => {
    const tx = montarTextoProposta(
      base({ cadastro: { nome: "RE/MAX Teste", cidade: "Sorocaba", uf: "SP" } }),
      HOJE,
    );
    const t = textoPlano(tx);
    expect(t).not.toContain("CNPJ ");
    expect(t).not.toContain("CRECI");
    expect(tx.avisos[0]).toBe(
      "O cadastro da imobiliária está sem razão social, CNPJ, CRECI-J, endereço. Esse dado fica fora da proposta até o administrador completar em Dados da imobiliária.",
    );
    expect(tx.avisos[1]).toContain("sem CRECI");
    expect(faltasCadastro(CAD)).toEqual([]);
  });
});

describe("marca interna do advogado", () => {
  it("texto aprovado (09/11): sai sem a marca de minuta", () => {
    expect(montarTextoProposta(base(), HOJE).marcaInterna).toBeNull();
    expect(MARCA_MINUTA).toMatch(/Minuta/);
    expect(readFileSync("src/lib/proposta-compra.ts", "utf8")).toContain(
      "export const TEXTO_APROVADO_ADVOGADO = true;",
    );
  });
});

describe("PDF gerado com cada condicional e os dois tipos de sinal", () => {
  const raw = (extra: Record<string, unknown>) => ({
    id: "11111111-1111-4111-8111-111111111111",
    documento: "PC-11111111",
    versao: 1,
    situacao: "rascunho",
    imovel: { tipo: "Casa", endereco: "Rua Exemplo, 1", cidade: "Sorocaba", uf: "SP" },
    valor_oferta: 500000,
    forma_pagamento: "sinal_financiamento",
    sinal_valor: 50000,
    sinal_prazo_dias: 2,
    sinal_tipo: "confirmatorias",
    financiamento_banco: "Caixa",
    financiamento_valor: 300000,
    validade_dias: 5,
    prazo_contrato_dias: 15,
    certidoes: "vendedor_apresenta",
    conteudo_hash: "a".repeat(64),
    documento_data: HOJE,
    cadastro: CAD,
    termos: {
      fgts_valor: 50000,
      permuta_descricao: "Terreno fictício",
      permuta_valor: 100000,
      itens: "Armários.",
    },
    partes: [],
    eventos: [],
    ...extra,
  });
  it.each(["confirmatorias", "penitenciais"])("PDF válido com sinal %s", async (tipo) => {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await buildPropostaPdf({
      proposta: lerDetalhe(raw({ sinal_tipo: tipo })),
      imobiliaria: "RE/MAX Teste",
      emitidoEm: new Date("2026-11-09T12:00:00Z"),
    });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });
  it("trocar o tipo de sinal muda o texto assinável (o banco gera nova versão)", () => {
    const a = txt({ formaPagamento: "sinal_parcelas", sinalValor: 1000 });
    const b = txt({
      formaPagamento: "sinal_parcelas",
      sinalValor: 1000,
      sinalTipo: "penitenciais",
    });
    expect(a).not.toBe(b);
  });
});
