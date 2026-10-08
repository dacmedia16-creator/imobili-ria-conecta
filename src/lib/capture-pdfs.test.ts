import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { appendDossieToContract, buildDossiePdf } from "./capture-dossie";
import {
  canBuildCompletePdf,
  completePdfDocs,
  completePdfName,
  signaturePdfName,
} from "./capture-pdfs";
import { juntarDocumentosEmPdf } from "./document-actions";
import {
  emptyOwner,
  fillExclusiveTemplate,
  normalizeForm,
  type Capture,
  type CaptureDocument,
  type DocumentKind,
  type ExclusiveUnit,
} from "./exclusive-captures";
import type { FeedbackAction } from "./owner-feedback-actions";

// Dados 100% fictícios.
const doc = (kind: DocumentKind, owner = 0, name = `${kind}.pdf`): CaptureDocument => ({
  id: `${kind}-${owner}`,
  capture_id: "c1",
  kind,
  owner_index: owner,
  storage_path: `org/c1/${kind}.pdf`,
  file_name: name,
});
const allDocs = [
  doc("gerado", 0, "contrato-exclusividade.pdf"),
  doc("rg", 1),
  doc("cpf", 1),
  doc("assinado", 0, "contrato-assinado-clicksign.pdf"),
  doc("iptu"),
  doc("matricula"),
];
const actions: FeedbackAction[] = [
  {
    id: "m1",
    list: "marketing",
    category: "Fotos",
    label: "Fotos profissionais",
    weight: "vital",
    sort: 1,
  },
  {
    id: "m2",
    list: "marketing",
    category: "Portais",
    label: "Anúncio nos portais",
    weight: "vital",
    sort: 2,
  },
  {
    id: "m3",
    list: "marketing",
    category: "Portais",
    label: "Vídeo do imóvel",
    weight: "importante",
    sort: 3,
  },
];

/** PDF fictício de 1 página com um texto (simula RG, matrícula, contrato assinado...). */
async function fakePdf(text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  page.drawText(text, { x: 60, y: 760, size: 22, font });
  page.drawText("DOCUMENTO FICTÍCIO PARA TESTE", { x: 60, y: 720, size: 12, font });
  return pdf.save();
}
const dataUrl = (bytes: Uint8Array) =>
  `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
const OUT = process.env.CAPTURE_PDF_OUT; // pasta para salvar os PDFs gerados (prints)

describe("PDFs da captação normal", () => {
  it("PDF completo: contrato ASSINADO primeiro + documentos; sem o contrato gerado", () => {
    expect(completePdfDocs(allDocs).map((d) => d.kind)).toEqual([
      "assinado",
      "rg",
      "cpf",
      "iptu",
      "matricula",
    ]);
  });
  it("PDF completo só com captação aprovada e contrato assinado", () => {
    expect(canBuildCompletePdf({ status: "aprovada" }, allDocs)).toBe(true);
    expect(
      canBuildCompletePdf(
        { status: "aprovada" },
        allDocs.filter((d) => d.kind !== "assinado"),
      ),
    ).toBe(false);
    for (const status of ["rascunho", "devolvida", "enviada", "em_assinatura"] as const)
      expect(canBuildCompletePdf({ status }, allDocs)).toBe(false);
  });
  it("nomes dos arquivos", () => {
    expect(signaturePdfName("abcdef123456")).toBe("contrato-exclusividade-abcdef12.pdf");
    expect(completePdfName("abcdef123456")).toBe("contrato-assinado-abcdef12-completo.pdf");
  });

  it("PDF para assinatura = SÓ contrato + Plano de Marketing (sem documentos)", async () => {
    const base = path.resolve("assets/exclusividade/remax-padrao.pdf");
    const contract = existsSync(base)
      ? await fillExclusiveTemplate(
          new Uint8Array(readFileSync(base)),
          {
            id: "c1",
            template: "remax-padrao",
            unit_id: "u1",
            form_data: normalizeForm({
              // normalizeForm completa os campos ausentes do imóvel.
              proprietario_1: {
                ...emptyOwner(),
                nome_completo: "Maria Fictícia da Silva",
                cpf: "000.000.000-00",
              },
              imovel: {
                tipo_imovel: "Casa",
                endereco: "Rua das Flores Fictícias, 123",
                bairro: "Jardim Exemplo",
                municipio: "Sorocaba",
                valor_imovel: "R$ 850.000,00",
              },
            } as unknown as Parameters<typeof normalizeForm>[0]),
            broker_name: "Corretor Fictício",
            broker_cpf: "",
            broker_creci: "000000-F",
            created_on_sp: "2026-10-08",
          } as unknown as Capture,
          true,
          "2026-10-08",
          {
            id: "u1",
            nome: "Unidade Exemplo",
            creci: "00000-J",
            razao_social: "EXEMPLO NEGÓCIOS IMOBILIÁRIOS LTDA",
            endereco: "Av. Exemplo, 1",
            cidade: "Sorocaba",
            estado: "São Paulo",
            cnpj: "00.000.000/0001-00",
            nome_comercial: "RE/MAX EXEMPLO",
            legacy_template: null,
            contrato_antigo: false,
            ativo: true,
          } as ExclusiveUnit,
        )
      : await fakePdf("CONTRATO DE EXCLUSIVIDADE (fictício)");
    const contractPages = (await PDFDocument.load(contract)).getPageCount();
    const plano = await buildDossiePdf({
      actions,
      selected: ["m1", "m2", "m3"],
      ownerNames: ["Maria Fictícia da Silva", ""],
      brokerName: "Corretor Fictício",
      brokerCreci: "000000-F",
      property: {
        tipo: "Casa",
        endereco: "Rua das Flores Fictícias, 123",
        bairro: "Jardim Exemplo",
        municipio: "Sorocaba",
        valor: "R$ 850.000,00",
      },
      company: "RE/MAX EXEMPLO",
      issuedOn: "08/10/2026",
    });
    const planoDoc = await PDFDocument.load(plano);
    expect(planoDoc.getTitle()).toBe("Plano de Marketing");
    const signature = await PDFDocument.load(
      // Mesmo caminho da tela: contrato + plano e nenhum documento anexado.
      await juntarDocumentosEmPdf([], await appendDossieToContract(contract, plano)),
    );
    expect(signature.getPageCount()).toBe(contractPages + planoDoc.getPageCount());
    if (OUT) writeFileSync(path.join(OUT, "1-pdf-para-assinatura.pdf"), await signature.save());
  });

  it("PDF completo = contrato assinado + todos os documentos, sem repetir o Plano", async () => {
    const files: Record<string, Uint8Array> = {
      assinado: await fakePdf("CONTRATO ASSINADO (Clicksign) - fictício"),
      rg: await fakePdf("RG - Maria Fictícia"),
      cpf: await fakePdf("CPF - Maria Fictícia"),
      iptu: await fakePdf("IPTU - Rua das Flores Fictícias, 123"),
      matricula: await fakePdf("MATRÍCULA - fictícia"),
      gerado: await fakePdf("NÃO DEVE APARECER (contrato gerado)"),
    };
    const list = completePdfDocs(allDocs).map((d) => ({
      file_name: d.file_name,
      url: dataUrl(files[d.kind]),
    }));
    const merged = await PDFDocument.load(await juntarDocumentosEmPdf(list));
    expect(merged.getPageCount()).toBe(5);
    if (OUT) writeFileSync(path.join(OUT, "2-pdf-completo.pdf"), await merged.save());
  });
});
