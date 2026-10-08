import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHECKS_NAO_DOCUMENTAIS,
  validarDocsAprovadosParaJuridico,
  validarProntaParaRevisao,
  type Pendencia,
} from "./status";
import {
  campoDoErroBanco,
  destinoDaPendencia,
  destinoLancamento,
  mensagemPendencias,
  ordenarPorPosicao,
  primeiraPendencia,
} from "./pendencia-navegacao";
import type { SaleRow } from "@/lib/database.types";

const p = (campo: string, mensagem = campo): Pendencia => ({ campo, mensagem });
const ler = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("campo → etapa/bloco/parte", () => {
  it("todo campo não-documental da validação tem destino (nenhuma pendência fica sem caminho)", () => {
    for (const campo of CHECKS_NAO_DOCUMENTAIS)
      expect(destinoDaPendencia(campo), campo).not.toBeNull();
  });

  it("toda pendência de uma venda vazia (inclui documentos de cada parte) tem destino", () => {
    const pend = validarProntaParaRevisao({} as SaleRow, {}, null, []);
    expect(pend.length).toBeGreaterThan(5);
    for (const x of pend) expect(destinoDaPendencia(x.campo), x.campo).not.toBeNull();
    for (const x of validarDocsAprovadosParaJuridico({}, []))
      expect(destinoDaPendencia(x.campo), x.campo).not.toBeNull();
  });

  it("Mídia, endereço, matrícula e imóvel ficam no Resumo, bloco Imóvel", () => {
    for (const c of ["midia", "endereco", "matricula", "imovel"])
      expect(destinoDaPendencia(c)).toMatchObject({ etapa: "resumo", bloco: "imovel" });
  });

  it("valores ficam no bloco Valores; partes e pagamento nas suas etapas", () => {
    expect(destinoDaPendencia("valor_negociado")).toMatchObject({
      etapa: "resumo",
      bloco: "valores",
    });
    expect(destinoDaPendencia("comissao")).toMatchObject({ etapa: "resumo", bloco: "valores" });
    expect(destinoDaPendencia("comprador")).toMatchObject({
      etapa: "partes",
      parte: "comprador_1",
    });
    expect(destinoDaPendencia("vendedor")).toMatchObject({ etapa: "partes", parte: "vendedor_1" });
    expect(destinoDaPendencia("pagamento")).toMatchObject({ etapa: "pagamento" });
    expect(destinoDaPendencia("occ_midia")).toMatchObject({ etapa: "ocorrencia" });
  });

  it("documentos levam à parte certa e ao cartão do tipo", () => {
    expect(destinoDaPendencia("doc_rg_comprador_2")).toMatchObject({
      etapa: "documentos",
      parte: "comprador_2",
      alvoId: "doc-rg-comprador_2",
    });
    expect(destinoDaPendencia("doc_iptu")).toMatchObject({
      etapa: "documentos",
      parte: "imovel",
      alvoId: "doc-iptu-imovel",
    });
    expect(destinoDaPendencia("doc_inexistente")).toBeNull();
    expect(destinoDaPendencia("qualquer_coisa")).toBeNull();
  });

  it("os ids de destino existem nas telas (senão a rolagem não acha o campo)", () => {
    const telas =
      ler("../routes/_authenticated/vendas.$id.tsx") +
      ler("../components/vendas/EnderecoPartesFields.tsx") +
      ler("../components/vendas/PaymentStep.tsx");
    // comprador/vendedor: id montado por parte no PartiesStep (conferido logo abaixo).
    for (const c of [...CHECKS_NAO_DOCUMENTAIS, "occ_midia"].filter(
      (c) => c !== "comprador" && c !== "vendedor",
    ))
      expect(telas, c).toContain(`"${destinoDaPendencia(c)!.alvoId}"`);
    expect(destinoDaPendencia("comprador")!.alvoId).toBe("campo-parte-comprador_1");
    expect(ler("../components/vendas/PartiesStep.tsx")).toContain("campo-parte-${p}");
    expect(ler("../components/vendas/DocumentsPanel.tsx")).toContain("doc-${t.key}-${parte}");
    const lanc = ler("../components/vendas/LancamentoDetail.tsx");
    for (const c of ["midia", "valor_negociado", "comissao", "divisao_comissao"])
      expect(lanc, c).toContain(`"${destinoLancamento(c)!.alvoId}"`);
  });
});

describe("primeiro faltante", () => {
  it("segue a ordem da tela, não a ordem da validação", () => {
    // Validação lista Mídia antes de pagamento e docs; na tela, Documentos é a 1ª etapa.
    const lista = [p("midia"), p("pagamento"), p("doc_iptu")];
    expect(primeiraPendencia(lista)?.pendencia.campo).toBe("doc_iptu");
    expect(ordenarPorPosicao(lista).map((x) => x.pendencia.campo)).toEqual([
      "doc_iptu",
      "midia",
      "pagamento",
    ]);
  });

  it("dentro do Resumo, bloco Imóvel vem antes de Valores", () => {
    expect(primeiraPendencia([p("comissao"), p("midia")])?.pendencia.campo).toBe("midia");
  });

  it("na mesma posição mantém a ordem da validação; ignora chaves sem destino", () => {
    expect(primeiraPendencia([p("x"), p("matricula"), p("midia")])?.pendencia.campo).toBe(
      "matricula",
    );
    expect(primeiraPendencia([p("x")])).toBeNull();
    expect(primeiraPendencia([])).toBeNull();
  });

  it("caso do Denis: só falta a Mídia (etapa 2) e o usuário está na última etapa", () => {
    const venda = {
      imovel_id: "X1",
      matricula: "123",
      imovel_logradouro: "Rua A",
      imovel_numero: "1",
      imovel_bairro: "Centro",
      imovel_cidade: "Sorocaba",
      imovel_uf: "SP",
      midia: null,
    } as unknown as SaleRow;
    const pend = validarProntaParaRevisao(venda, {}, null, []).filter((x) => x.campo === "midia");
    expect(primeiraPendencia(pend)?.destino).toMatchObject({ etapa: "resumo", bloco: "imovel" });
  });
});

describe("mensagem", () => {
  it("diz o nome do campo e onde ele fica", () => {
    expect(mensagemPendencias([p("midia")])).toEqual({
      titulo: "Falta preencher Mídia, na etapa Resumo (bloco Imóvel). Já abrimos ela para você.",
    });
  });

  it("com mais de um faltante, lista os outros", () => {
    const m = mensagemPendencias([p("pagamento"), p("midia"), p("comprador")]);
    expect(m?.titulo).toMatch(/^Falta preencher Mídia/);
    expect(m?.descricao).toContain("Comprador (nome e CPF)");
    expect(m?.descricao).toContain("Forma de pagamento");
  });

  it("partes dizem qual pessoa", () => {
    expect(mensagemPendencias([p("comprador")])?.titulo).toContain("Cliente Comprador 1");
  });
});

describe("erro do banco → campo", () => {
  it("as mensagens das travas do banco são reconhecidas", () => {
    const sqlMidia = ler(
      "../../supabase/migrations/20261008130000_midia_obrigatoria_ao_avancar.sql",
    );
    const msgs = [...sqlMidia.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]);
    expect(msgs).toHaveLength(2);
    expect(campoDoErroBanco({ code: "23514", message: msgs[0] })).toBe("midia");
    expect(campoDoErroBanco({ code: "23514", message: msgs[1] })).toBe("occ_midia");
    expect(
      campoDoErroBanco({
        message:
          "Complete o endereço do imóvel (falta: Rua). Sem ele a venda não segue para o gestor e o jurídico.",
      }),
    ).toBe("endereco");
    expect(
      campoDoErroBanco({ message: "Informe o valor negociado antes de enviar ao financeiro." }),
    ).toBe("valor_negociado");
    expect(
      campoDoErroBanco({
        message:
          "Adicione ao menos uma linha na divisão da comissão antes de enviar ao financeiro.",
      }),
    ).toBe("divisao_comissao");
  });

  it("erro sem campo conhecido não navega", () => {
    expect(campoDoErroBanco({ code: "42501", message: "permission denied" })).toBeNull();
    expect(campoDoErroBanco(null)).toBeNull();
  });
});
