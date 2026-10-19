// Comprovante de residência POR PROPRIETÁRIO (t_8e496afb). Dados sintéticos; nenhuma chamada à IA.
import { describe, expect, it } from "vitest";
import { buildCapturePrompt, fieldsFromDocument } from "./exclusive-captures-ai";
import {
  applySuggestedFields,
  emptyForm,
  emptyOwner,
  manualPendencies,
  missingRequirements,
  type CaptureDocument,
} from "./exclusive-captures";

const doc = (kind: CaptureDocument["kind"], owner_index = 0) =>
  ({ kind, owner_index }) as CaptureDocument;
const ENDERECO = "Rua Fictícia, 100, Jardim Teste, Sorocaba/SP, 18000-000";

describe("comprovante de residência do proprietário", () => {
  it("prompt do proprietário pede o endereço do titular; o do imóvel continua igual", () => {
    const owner = buildCapturePrompt("residencia", "owner");
    expect(owner).toContain("comprovante de residência");
    expect(owner).toContain('"endereco_completo": endereço do titular em uma linha');
    expect(owner).toContain('"endereco_completo": string|null');
    expect(owner).not.toContain("apenas o endereço do imóvel");
    const imovel = buildCapturePrompt("residencia", "property");
    expect(imovel).toContain("Preencha apenas o endereço do imóvel.");
    expect(imovel).not.toContain("endereco_completo");
  });

  it("do comprovante do proprietário só o endereço é aproveitado (titular pode ser outra pessoa)", () => {
    const lido = { endereco_completo: ENDERECO, nome_completo: "Titular da Conta" };
    expect(fieldsFromDocument("residencia", 1, lido)).toEqual({ endereco_completo: ENDERECO });
    expect(fieldsFromDocument("residencia", 2, lido)).toEqual({ endereco_completo: ENDERECO });
    expect(fieldsFromDocument("residencia", 1, { nome_completo: "X" })).toEqual({});
    // Comprovante do imóvel e demais documentos: sem filtro (comportamento anterior).
    const imovel = { endereco: "Rua A, 1", bairro: "Centro" };
    expect(fieldsFromDocument("residencia", 0, imovel)).toBe(imovel);
    const cnh = { nome_completo: "Fulana", cpf: "529.982.247-25" };
    expect(fieldsFromDocument("cnh", 1, cnh)).toBe(cnh);
  });

  it("preenche o endereço só do proprietário certo e só se estiver vazio", () => {
    const form = emptyForm();
    form.proprietario_2 = emptyOwner();
    const valores = fieldsFromDocument("residencia", 2, { endereco_completo: ENDERECO });
    const next = applySuggestedFields(form, "proprietario_2", valores);
    expect(next.proprietario_2?.endereco_completo).toBe(ENDERECO);
    expect(next.proprietario_1.endereco_completo).toBe("");
    expect(next.imovel.endereco).toBe("");
    // Já digitado: não sobrescreve.
    form.proprietario_1.endereco_completo = "Endereço digitado pelo corretor";
    const mantido = applySuggestedFields(form, "proprietario_1", valores);
    expect(mantido.proprietario_1.endereco_completo).toBe("Endereço digitado pelo corretor");
  });

  it("não é obrigatório: não trava o envio nem conta como comprovante do imóvel", () => {
    const form = emptyForm();
    for (const key of Object.keys(form.proprietario_1) as (keyof typeof form.proprietario_1)[])
      form.proprietario_1[key] = "x";
    for (const key of Object.keys(form.imovel) as (keyof typeof form.imovel)[])
      form.imovel[key] = "x";
    const base = [doc("cnh", 1), doc("matricula"), doc("iptu")];
    expect(missingRequirements(form, base, "123", "CRECI")).toEqual([]);
    expect(missingRequirements(form, [...base, doc("residencia", 1)], "123", "CRECI")).toEqual([]);
    // Cadastro manual: o do proprietário não apaga a pendência opcional do comprovante do imóvel.
    expect(manualPendencies(form, [doc("residencia", 1)]).optional).toContain(
      "Comprovante de residência",
    );
    expect(manualPendencies(form, [doc("residencia")]).optional).not.toContain(
      "Comprovante de residência",
    );
  });
});
