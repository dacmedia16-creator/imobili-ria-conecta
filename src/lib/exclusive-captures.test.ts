import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import {
  applySuggestedFields,
  emptyForm,
  fillExclusiveTemplate,
  missingRequirements,
  type Capture,
  type CaptureDocument,
  type Template,
} from "./exclusive-captures";

const fixture: Capture = {
  id: "00000000-0000-4000-8000-000000000001",
  captor_id: "actor",
  template: "campolim",
  status: "rascunho",
  created_on_sp: "2026-09-25",
  created_at: "2026-09-26T02:59:00Z",
  broker_name: "Fulano de Tal",
  broker_cpf: "12345678900",
  broker_creci: "12345-F",
  form_data: emptyForm(),
};
const doc = (kind: CaptureDocument["kind"], owner_index = 0) =>
  ({ kind, owner_index }) as CaptureDocument;

describe("captação exclusiva", () => {
  it("mantém em branco as entradas já conferidas ao aplicar sugestões", () => {
    const form = emptyForm();
    form.proprietario_1.nome_completo = "Nome conferido";
    const result = applySuggestedFields(form, "proprietario_1", {
      nome_completo: "Outro",
      rg: "88",
      invalido: "não",
    });
    expect(result.proprietario_1.nome_completo).toBe("Nome conferido");
    expect(result.proprietario_1.rg).toBe("88");
    expect(form.proprietario_1.rg).toBe("");
  });
  it("RG+CPF ou CNH são exigidos para cada proprietário, inclusive o segundo", () => {
    const form = emptyForm();
    for (const key of Object.keys(form.proprietario_1) as (keyof typeof form.proprietario_1)[])
      form.proprietario_1[key] = "x";
    for (const key of Object.keys(form.imovel) as (keyof typeof form.imovel)[])
      form.imovel[key] = "x";
    const ready = [doc("rg", 1), doc("cpf", 1), doc("gerado")];
    expect(missingRequirements(form, ready, "123", "CRECI")).toEqual([]);
    form.proprietario_2 = { ...form.proprietario_1 };
    expect(missingRequirements(form, ready, "123", "CRECI")).toContain(
      "Proprietário 2: RG e CPF ou CNH",
    );
    expect(missingRequirements(form, [...ready, doc("cnh", 2)], "123", "CRECI")).toEqual([]);
    expect(
      missingRequirements(form, [doc("cpf", 1), doc("cnh", 2), doc("gerado")], "123", "CRECI"),
    ).toContain("Proprietário 1: RG e CPF ou CNH");
  });
  for (const template of ["campolim", "barao-de-tatui"] as Template[]) {
    const privateTemplate = new URL(`../../assets/exclusividade/${template}.pdf`, import.meta.url);
    // Modelos originais ficam fora do Git público; sem eles, a prova local é pulada explicitamente.
    it.skipIf(!existsSync(privateTemplate))(
      `preenche o modelo original ${template} e preserva seis páginas`,
      async () => {
        const bytes = await readFile(privateTemplate);
        const form = emptyForm();
        form.proprietario_1.nome_completo = "José Ávila";
        const generated = await fillExclusiveTemplate(
          bytes,
          { ...fixture, template, form_data: form },
          false,
        );
        const pdf = await PDFDocument.load(generated);
        expect(pdf.getPageCount()).toBe(6);
        expect(pdf.getForm().getTextField("07fggfAd").getText()).toBe("José Ávila");
        expect(pdf.getForm().getTextField("NameGF").getText()).toBe("12345678900");
        expect(pdf.getForm().getTextField("NamBe").getText()).toBe("25");
        const flattened = await fillExclusiveTemplate(bytes, {
          ...fixture,
          template,
          form_data: form,
        });
        expect((await PDFDocument.load(flattened)).getForm().getFields()).toHaveLength(0);
      },
      120000,
    );
  }
});
