import { describe, expect, it } from "vitest";
import { fixedLogoForOrganization, letterheadForOrganization } from "./agency-letterhead";

describe("cabeçalho impresso por imobiliária", () => {
  it("preserva a razão social e o CRECI da agência histórica", () => {
    expect(
      letterheadForOrganization(
        "Única Escolha",
        "IMOBILIÁRIA RE/MAX ÚNICA NEGÓCIOS IMOB. LTDA",
        "CRECI: 29.886-J",
      ),
    ).toEqual({
      name: "IMOBILIÁRIA RE/MAX ÚNICA NEGÓCIOS IMOB. LTDA",
      creci: "CRECI: 29.886-J",
    });
  });
  it("não atribui marca ou CRECI da Única Escolha à agência piloto", () => {
    expect(letterheadForOrganization(" Agência B ", null, null)).toEqual({
      name: "Agência B",
      creci: null,
    });
  });
  it("usa a marca fixa RE/MAX só para a agência histórica sem logo próprio", () => {
    expect(fixedLogoForOrganization("00000000-0000-4000-8000-000000000001")).toBe(
      "/remax-icon.png",
    );
    expect(fixedLogoForOrganization("2a000000-0000-4000-8000-0000000000b0")).toBeNull();
  });
  it("recusa uma imobiliária sem nome", () => {
    expect(() => letterheadForOrganization(" ", null, null)).toThrow();
  });
});
