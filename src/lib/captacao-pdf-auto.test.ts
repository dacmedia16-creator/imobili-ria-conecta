import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deveGerarPdfAuto, PDF_AUTO_FALHA, type PdfAutoInput } from "./captacao-pdf-auto";

// Denis 03/11/2026 (t_ef7dc621, opção 1): gestor abre captação enviada sem PDF → gera sozinho 1x.

const ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const base = (o: Partial<PdfAutoInput> = {}): PdfAutoInput => ({
  capture: { id: ID, status: "enviada", manual: false, archived_at: null },
  routeId: ID,
  manager: true,
  docs: [{ kind: "cnh" }, { kind: "matricula" }],
  dossieLoading: false,
  busy: false,
  tentados: new Set(),
  ...o,
});

describe("PDF para assinatura automático (gestor abre captação enviada)", () => {
  it("gestor/TL/ADM abre enviada sem PDF: gera", () => {
    expect(deveGerarPdfAuto(base())).toBe(true);
  });

  it("gera só 1x: depois de tentado (sucesso ou falha) não tenta de novo sozinho", () => {
    const tentados = new Set<string>();
    expect(deveGerarPdfAuto(base({ tentados }))).toBe(true);
    tentados.add(ID); // o efeito marca antes de gerar (StrictMode/re-render não repetem)
    expect(deveGerarPdfAuto(base({ tentados }))).toBe(false);
  });

  it("já tem PDF para assinatura salvo: não gera", () => {
    expect(deveGerarPdfAuto(base({ docs: [{ kind: "gerado" }] }))).toBe(false);
  });

  it("corretor (não gestor): comportamento inalterado, não gera", () => {
    expect(deveGerarPdfAuto(base({ manager: false }))).toBe(false);
  });

  it("outros status, manual, arquivada: não gera", () => {
    for (const status of ["rascunho", "devolvida", "em_assinatura", "aprovada"])
      expect(deveGerarPdfAuto(base({ capture: { id: ID, status } }))).toBe(false);
    expect(deveGerarPdfAuto(base({ capture: { id: ID, status: "enviada", manual: true } }))).toBe(
      false,
    );
    expect(
      deveGerarPdfAuto(base({ capture: { id: ID, status: "enviada", archived_at: "2026-11-01" } })),
    ).toBe(false);
  });

  it("espera o catálogo do Plano de Marketing, ação em andamento e a captação certa", () => {
    expect(deveGerarPdfAuto(base({ dossieLoading: true }))).toBe(false);
    expect(deveGerarPdfAuto(base({ busy: true }))).toBe(false);
    expect(deveGerarPdfAuto(base({ capture: null }))).toBe(false);
    expect(deveGerarPdfAuto(base({ routeId: "outra" }))).toBe(false);
  });

  it("falha: mensagem com o motivo e apontando o botão manual", () => {
    const m = PDF_AUTO_FALHA(
      "Marque ao menos 1 ação no Plano de Marketing antes de gerar o contrato.",
    );
    expect(m).toContain("Plano de Marketing");
    expect(m).not.toContain("..");
    expect(m).toContain('"Gerar PDF para assinatura"');
  });

  it("tela: usa o mesmo gerarPdfAssinatura(false) sem salvar o formulário, marca antes e mantém o botão", () => {
    const tela = readFileSync(
      resolve(__dirname, "../routes/_authenticated/exclusividades.$id.tsx"),
      "utf8",
    );
    const efeito = tela.slice(
      tela.indexOf("const pdfAutoTentados"),
      tela.indexOf("// PDF completo"),
    );
    expect(efeito).toContain("deveGerarPdfAuto({");
    expect(efeito).toContain("pdfAutoTentados.current.add(capture.id);");
    expect(efeito.indexOf("pdfAutoTentados.current.add")).toBeLessThan(
      efeito.indexOf("gerarPdfAssinatura(false"),
    );
    expect(efeito).toContain("await gerarPdfAssinatura(false, { baixar: false });");
    expect(efeito).not.toContain("saveCapture");
    expect(efeito).toContain('setStep("revisao");');
    expect(efeito).toContain("toast.error(PDF_AUTO_FALHA(");
    // Botão manual continua no cartão, com a mesma condição de antes.
    expect(tela).toContain(
      'step === "revisao" && !manual && manager && capture.status === "enviada" && (',
    );
    expect(tela).toContain("<Button disabled={busy} onClick={generate}>");
  });
});
