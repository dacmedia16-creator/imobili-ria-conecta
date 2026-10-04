import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  captureUnitLabel,
  contractSource,
  emptyForm,
  emptyOwner,
  fillExclusiveTemplate,
  logoCommercialName,
  normalizeForm,
  unitForoDefaults,
  type Capture,
  type ExclusiveUnit,
} from "./exclusive-captures";

const unit = (over: Partial<ExclusiveUnit> = {}): ExclusiveUnit => ({
  id: "u1",
  nome: "Unidade Teste",
  creci: "99999-J",
  razao_social: "TESTE NEGÓCIOS IMOBILIÁRIOS LTDA",
  endereco: "Rua Exemplo, 100 - Centro",
  cidade: "Campinas",
  estado: "São Paulo",
  cnpj: "11.222.333/0001-81",
  nome_comercial: "RE/MAX TESTE",
  legacy_template: null,
  contrato_antigo: false,
  ativo: true,
  ...over,
});

describe("logo da pág. 6 e foro da unidade", () => {
  it("logo da pág. 6 mostra só o nome comercial, sem RE/MAX e sem número da unidade", () => {
    const unica = { nome: "Única Escolha I", nome_comercial: "RE/MAX ÚNICA ESCOLHA" };
    expect(logoCommercialName(unica)).toBe("Única Escolha");
    expect(logoCommercialName({ ...unica, nome: "Única Escolha II" })).toBe("Única Escolha");
    expect(
      logoCommercialName({ nome: "Horizonte Campinas", nome_comercial: "RE/MAX Horizonte" }),
    ).toBe("Horizonte");
    expect(logoCommercialName({ nome: "X", nome_comercial: "REMAX PRAIA DO SOL" })).toBe(
      "Praia do Sol",
    );
  });
  it("captação nova usa a cidade da unidade no foro", () => {
    const u = unit({ cidade: "Campinas", estado: "São Paulo" });
    expect(unitForoDefaults(u)).toEqual({ foro_comarca: "Campinas", foro_estado: "São Paulo" });
    const f = normalizeForm({}, u);
    expect(f.condicoes.foro_comarca).toBe("Campinas");
    expect(f.condicoes.prazo_dias_numero).toBe("180");
    expect(emptyForm().condicoes.foro_comarca).toBe("Sorocaba");
  });
  it("foro já gravado (captação existente ou editado pelo corretor) não muda", () => {
    const u = unit({ cidade: "Campinas" });
    const salvo = normalizeForm(
      { condicoes: { ...emptyForm().condicoes, foro_comarca: "Sorocaba" } },
      u,
    );
    expect(salvo.condicoes.foro_comarca).toBe("Sorocaba");
    const editado = normalizeForm(
      { condicoes: { ...emptyForm().condicoes, foro_comarca: "Valinhos" } },
      u,
    );
    expect(editado.condicoes.foro_comarca).toBe("Valinhos");
    // Sem unidade: comportamento antigo.
    expect(normalizeForm({}).condicoes.foro_comarca).toBe("Sorocaba");
  });
  it("troca de unidade antes de salvar acompanha a nova cidade", () => {
    const a = unit({ cidade: "Campinas" });
    const b = unit({ id: "u2", cidade: "Jundiaí" });
    expect(normalizeForm({}, a).condicoes.foro_comarca).toBe("Campinas");
    expect(normalizeForm({}, b).condicoes.foro_comarca).toBe("Jundiaí");
  });
});

describe("unidade da captação", () => {
  it("unidade nova usa o contrato-base com os dados dela", () => {
    const u = unit();
    expect(contractSource({ unit_id: "u1", template: "remax-padrao" }, [u])).toEqual({
      file: "remax-padrao",
      unit: u,
    });
  });
  it("chave contrato_antigo volta ao PDF antigo; desligada usa o contrato-base", () => {
    const legacy = unit({ id: "u2", legacy_template: "campolim", contrato_antigo: true });
    expect(contractSource({ unit_id: null, template: "campolim" }, [legacy]).file).toBe("campolim");
    const off = { ...legacy, contrato_antigo: false };
    expect(contractSource({ unit_id: null, template: "campolim" }, [off]).file).toBe(
      "remax-padrao",
    );
  });
  it("captação antiga sem unidade cadastrada segue no PDF gravado", () => {
    expect(contractSource({ unit_id: null, template: "barao-de-tatui" }, [])).toEqual({
      file: "barao-de-tatui",
      unit: null,
    });
    expect(captureUnitLabel({ unit_id: null, template: "barao-de-tatui" }, [])).toContain("II");
  });
  it("contrato-base sem unidade acessível falha fechado", () => {
    expect(() => contractSource({ unit_id: "x", template: "remax-padrao" }, [])).toThrow();
  });

  const base = "assets/exclusividade/remax-padrao.pdf";
  it.skipIf(!existsSync(base))("preenche os campos da unidade no contrato-base", async () => {
    const capture = {
      id: "c1",
      template: "remax-padrao",
      unit_id: "u1",
      form_data: { proprietario_1: emptyOwner() },
      broker_name: "Corretor Teste",
      broker_cpf: "",
      broker_creci: "",
      created_on_sp: "2026-10-04",
    } as unknown as Capture;
    const out = await fillExclusiveTemplate(
      new Uint8Array(readFileSync(base)),
      capture,
      false,
      "2026-10-04",
      unit(),
    );
    const { PDFDocument } = await import("pdf-lib");
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField("REMAX").getText()).toBe("TESTE NEGÓCIOS IMOBILIÁRIOS LTDA");
    expect(form.getTextField("undefined_2").getText()).toBe("11.222.333/0001-81");
    expect(form.getTextField("REMAX_2").getText()).toBe("TESTE");
    expect(form.getTextField("Franquia").getText()).toBe("Unidade Teste");
    // Nome sob o logo centralizado, como nos PDFs antigos.
    expect(form.getTextField("Franquia").getAlignment()).toBe(1);
    if (process.env.UNIT_PDF_OUT)
      writeFileSync(
        process.env.UNIT_PDF_OUT,
        await fillExclusiveTemplate(
          new Uint8Array(readFileSync(base)),
          capture,
          true,
          "2026-10-04",
          unit(),
        ),
      );
  });

  it.skipIf(!existsSync(base))("textos longos da unidade cabem inteiros nos campos", async () => {
    const longa = unit({
      nome: "Horizonte Campinas Cambuí Premium",
      razao_social: "HORIZONTE CAMPINAS NEGÓCIOS IMOBILIÁRIOS E PARTICIPAÇÕES LTDA",
      endereco: "Avenida Doutor Moraes Salles, 1234 - Sala 1501 - Centro - Edifício Exemplo",
      nome_comercial: "RE/MAX Horizonte Campinas Cambuí",
    });
    const capture = {
      id: "c1",
      template: "remax-padrao",
      unit_id: "u1",
      form_data: { proprietario_1: emptyOwner() },
      broker_name: "",
      broker_cpf: "",
      broker_creci: "",
      created_on_sp: "2026-10-04",
    } as unknown as Capture;
    const out = await fillExclusiveTemplate(
      new Uint8Array(readFileSync(base)),
      capture,
      false,
      "2026-10-04",
      longa,
    );
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdf = await PDFDocument.load(out);
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const names = ["Franquia", "REMAX", "undefined", "with", "undefined_2", "REMAX_2"];
    for (const name of names) {
      const field = pdf.getForm().getTextField(name);
      const text = field.getText() ?? "";
      for (const w of field.acroField.getWidgets()) {
        const size = Number(/([\d.]+)\s+Tf/.exec(w.getDefaultAppearance() ?? "")?.[1]);
        const f = name === "Franquia" ? bold : helv;
        expect(size, name).toBeGreaterThan(3);
        expect(f.widthOfTextAtSize(text, size), name).toBeLessThanOrEqual(
          w.getRectangle().width - 2,
        );
      }
    }
  });
});
