import { describe, expect, it } from "vitest";
import { podeBaixarDocumentosVenda } from "./document-access";

describe("download de documentos da venda", () => {
  it("permite baixar quando o usuário pode visualizar a venda, mesmo concluída", () => {
    expect(
      podeBaixarDocumentosVenda({ podeVisualizar: true, status: "ocorrencia_concluida" }),
    ).toBe(true);
  });

  it("não libera documentos para quem não pode visualizar a venda", () => {
    expect(
      podeBaixarDocumentosVenda({ podeVisualizar: false, status: "ocorrencia_concluida" }),
    ).toBe(false);
  });
});
