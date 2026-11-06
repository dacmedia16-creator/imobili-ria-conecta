import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { marcarPrevia, PREVIA_MARCA } from "@/lib/pdf-paginas";

const tela = readFileSync("src/routes/_authenticated/exclusividades.$id.tsx", "utf8");

describe("prévia do contrato para o corretor (t_41c8f65a)", () => {
  it("marcarPrevia mantém as páginas e carimba a marca", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    pdf.addPage([595, 842]);
    const marcado = await marcarPrevia(await pdf.save());
    const lido = await PDFDocument.load(marcado);
    expect(lido.getPageCount()).toBe(2);
    expect(marcado.length).toBeGreaterThan((await pdf.save()).length);
    expect(PREVIA_MARCA).toBe("PRÉVIA — NÃO ASSINAR");
  });

  it("a prévia usa a mesma montagem do PDF oficial e não salva nada", () => {
    const ini = tela.indexOf("const verPrevia = async");
    const corpo = tela.slice(ini, tela.indexOf("\n  };", ini));
    expect(corpo).toContain("montarPdfAssinatura(");
    expect(corpo).toContain("marcarPrevia(");
    expect(corpo).not.toMatch(/uploadCaptureDocument|saveCapture|fixarTestemunhasPdf|run\(/);
    // O gestor continua gerando pelo mesmo caminho.
    expect(tela).toMatch(/gerarPdfAssinatura = async[\s\S]{0,900}montarPdfAssinatura\(saved\)/);
  });

  it("o botão de prévia fica no passo de envio do corretor e o confirm aponta para ele", () => {
    expect(tela).toContain('data-testid="ver-previa-contrato"');
    expect(tela).toContain("Ver prévia do contrato + Plano de Marketing");
    expect(tela).not.toContain('"Você conferiu o PDF gerado e todos os documentos?"');
  });

  it("documento PDF não abre mais em <iframe> (em branco no celular)", () => {
    expect(tela).not.toMatch(/<iframe/);
    expect(tela).toContain("<PaginasPdf url={preview.url}");
  });
});
