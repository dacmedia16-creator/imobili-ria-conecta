import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reportSource = readFileSync(
  new URL("../routes/_authenticated/vendas.$id.tsx", import.meta.url),
  "utf8",
);

describe("acoes dos documentos no relatorio da venda", () => {
  it("oferece baixar e imprimir em cada documento interno", () => {
    expect(reportSource).toContain('aria-label={`Baixar ${d.file_name}`}');
    expect(reportSource).toContain('aria-label={`Imprimir ${d.file_name}`}');
    expect(reportSource).toContain("baixarDocumentoRelatorio(d)");
    expect(reportSource).toContain("imprimirDocumentoRelatorio(d)");
  });
});
