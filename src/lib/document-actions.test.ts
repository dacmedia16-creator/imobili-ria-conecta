import { afterEach, describe, expect, it, vi } from "vitest";
import { openDocumentPrintWindow, printDocumentUrls } from "./document-actions";

afterEach(() => vi.unstubAllGlobals());

describe("impressão de documentos privados", () => {
  it("abre a janela no clique e remove o acesso ao opener", () => {
    const popup = {
      opener: {},
      document: { title: "", write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    };
    const open = vi.fn(() => popup);
    vi.stubGlobal("window", { open });

    const prepared = openDocumentPrintWindow();
    expect(prepared).toBe(popup);
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(popup.opener).toBeNull();
    expect(popup.document.title).toBe("Preparando impressão");

    printDocumentUrls([{ file_name: '<img src=x onerror="alert(1)">.pdf', url: "https://example.invalid/a?x=<evil>" }], prepared!);
    expect(open).toHaveBeenCalledTimes(1);
    expect(popup.document.write).toHaveBeenCalledTimes(1);
    const html = popup.document.write.mock.calls[0][0];
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("https://example.invalid/a?x=&lt;evil&gt;");
  });
});
