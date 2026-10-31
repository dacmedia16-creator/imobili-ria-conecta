import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { montarAcoesVenda, type EstadoAcoesVenda, MOTIVO_SEM_CERTIDAO } from "./venda-acoes";
import { passoCompleto, passoDaPendencia, pendenciasPorPasso } from "./captacao-pendencias";

const base: EstadoAcoesVenda = {
  status: "rascunho",
  isGestor: false,
  isJuridico: false,
  isFinanceiro: false,
  isOwner: false,
  isAdminLike: false,
  podeEnviarRevisao: false,
  gestorDaEquipeRascunho: false,
  envioDiretoJuridico: false,
  canUploadCertidoes: false,
  contratoDocs: 0,
  certidoesJuridicoDocs: 0,
  contratoPendenciaDescricao: null,
  assinaturaBloqueadaJuridico: false,
  clicksignAtalhoGestor: false,
  envioManualSimples: false,
  assinaturaManual: false,
  contratoAssinadoDocs: 0,
  canCloseSale: false,
  canUnarchive: false,
  etapaAntesDeArquivar: null,
  canCancel: false,
  canDelete: false,
};

describe("item 18 — barra do detalhe da venda", () => {
  it("jurídico em elaboração: 1 principal, Devolver com 2 opções, o resto em Mais", () => {
    const a = montarAcoesVenda({
      ...base,
      status: "em_elaboracao_contrato",
      isJuridico: true,
      canUploadCertidoes: true,
      contratoDocs: 1,
      canCloseSale: true,
      canCancel: true,
    });
    expect(a.principal?.label).toBe("Enviar ao gestor");
    expect(a.principal?.disabled).toBe(true);
    expect(a.principal?.motivo).toBe(MOTIVO_SEM_CERTIDAO);
    expect(a.devolver.map((d) => d.alvo)).toEqual(["enviada_revisao", "devolvida_ajuste"]);
    expect(a.mais.map((m) => m.label)).toEqual([
      "Substituir versão do contrato",
      "Subir certidões",
      "Arquivar",
      "Cancelar venda",
    ]);
    expect(a.mais.at(-1)?.destrutiva).toBe(true);
  });
  it("não cria ação nova: corretor sem permissão não vê nada", () => {
    const a = montarAcoesVenda({ ...base, status: "enviada_revisao" });
    expect(a).toEqual({ principal: null, devolver: [], mais: [] });
  });
  it("gestor revisando: Aprovar + Devolver ao corretor; Arquivar/Excluir em Mais", () => {
    const a = montarAcoesVenda({
      ...base,
      status: "enviada_revisao",
      isGestor: true,
      canCloseSale: true,
      canDelete: true,
    });
    expect(a.principal?.label).toBe("Aprovar p/ jurídico");
    expect(a.devolver).toHaveLength(1);
    expect(a.devolver[0]).toMatchObject({
      label: "Devolver ao corretor",
      alvo: "devolvida_ajuste",
    });
    expect(a.mais.map((m) => m.id)).toEqual(["arquivar", "excluir_venda"]);
  });
  it("desabilitado sempre traz motivo", () => {
    const a = montarAcoesVenda({
      ...base,
      status: "aguardando_assinatura",
      isGestor: true,
    });
    for (const x of [a.principal, ...a.mais]) if (x?.disabled) expect(x.motivo).toBeTruthy();
  });
  it("a rota usa a barra nova (sem a fileira antiga de botões)", () => {
    const tela = readFileSync("src/routes/_authenticated/vendas.$id.tsx", "utf8");
    expect(tela).toContain("<AcoesDaVenda acoes={acoesTopo} onAcao={executarAcaoTopo} />");
    expect(tela).not.toContain("{/* Corretor: envio inicial ou reenvio");
  });
});

describe("item 19 — Pendências da captação", () => {
  it("leva cada pendência ao passo certo", () => {
    expect(passoDaPendencia("Proprietário 1: RG e CPF ou CNH", false)).toBe("documentos");
    expect(passoDaPendencia("Matrícula do imóvel", false)).toBe("documentos");
    expect(passoDaPendencia("CPF do captador", false)).toBe("dados");
    expect(passoDaPendencia("Plano de Marketing: marque ao menos 1 ação", false)).toBe("dossie");
    expect(passoDaPendencia("Contrato assinado", true)).toBe("contrato");
    expect(passoDaPendencia("IPTU", true)).toBe("dossie");
  });
  it("✓ só no passo sem pendência; envio ✓ depois de enviada", () => {
    const p = pendenciasPorPasso(["CPF do captador"], false);
    expect(passoCompleto("documentos", p, "rascunho")).toBe(true);
    expect(passoCompleto("dados", p, "rascunho")).toBe(false);
    expect(passoCompleto("revisao", p, "rascunho")).toBe(false);
    expect(passoCompleto("revisao", [], "enviada")).toBe(true);
  });
});
