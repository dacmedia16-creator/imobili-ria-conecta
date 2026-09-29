import { describe, expect, it } from "vitest";
import { letterheadForOrganization } from "./agency-letterhead";

describe("cabeçalho impresso por imobiliária", () => {
  it("preserva a razão social e o CRECI da agência histórica", () => {
    expect(
      letterheadForOrganization("00000000-0000-4000-8000-000000000001", "Única Escolha"),
    ).toEqual({
      name: "IMOBILIÁRIA RE/MAX ÚNICA NEGÓCIOS IMOB. LTDA",
      creci: "CRECI: 29.886-J",
    });
  });
  it("não atribui marca ou CRECI da Única Escolha à agência piloto", () => {
    expect(
      letterheadForOrganization("2a000000-0000-4000-8000-0000000000b0", " Agência B "),
    ).toEqual({
      name: "Agência B",
      creci: null,
    });
  });
  it("recusa uma imobiliária sem nome", () => {
    expect(() => letterheadForOrganization("2a000000-0000-4000-8000-0000000000b0", " ")).toThrow();
  });
});
