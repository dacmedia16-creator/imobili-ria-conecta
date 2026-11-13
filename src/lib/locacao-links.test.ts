import { describe, expect, it } from "vitest";
import { CAMPOS_CONTRATO } from "./locacao-contrato";
import { camposDaParte, partesParaLink, podeEnviarLinks, TOKEN_LINK_RE } from "./locacao-links";

describe("cliente preenche a locação", () => {
  it("exige um link enviado por parte, fiador apenas quando a garantia pede", () => {
    expect(partesParaLink("fiador")).toEqual(["proprietario", "locatario", "fiador"]);
    expect(partesParaLink("caucao")).toEqual(["proprietario", "locatario"]);
    const links = [
      { parte: "proprietario" as const, status: "enviado" },
      { parte: "locatario" as const, status: "enviado" },
    ];
    expect(podeEnviarLinks("cliente", "fiador", links)).toBe(false);
    expect(podeEnviarLinks("cliente", "caucao", links)).toBe(true);
    expect(podeEnviarLinks("corretor", "fiador", [])).toBe(true);
  });
  it("reaproveita somente campos próprios, sem valores da negociação", () => {
    for (const parte of partesParaLink("fiador")) {
      const campos = camposDaParte(parte, {});
      expect(campos.length).toBeGreaterThan(0);
      expect(campos.every((c) => CAMPOS_CONTRATO.includes(c))).toBe(true);
      expect(campos.some((c) => c.k.startsWith("imv_") || c.k === "prazo_meses")).toBe(false);
      expect(campos.map((c) => c.k).join(" ")).not.toMatch(/aluguel|iptu|taxa_adm/);
    }
    expect(camposDaParte("proprietario", {}).some((c) => c.k.startsWith("loc_"))).toBe(false);
    expect(camposDaParte("fiador", {}).some((c) => c.k.startsWith("prop_"))).toBe(false);
  });
  it("cônjuge só aparece quando casado/união estável", () => {
    expect(camposDaParte("proprietario", {}).some((c) => c.k === "prop_conj_nome")).toBe(false);
    expect(
      camposDaParte("proprietario", { prop_estado_civil: "casado(a)" }).some(
        (c) => c.k === "prop_conj_nome",
      ),
    ).toBe(true);
    expect(
      camposDaParte("fiador", { fia_estado_civil: "união estável" }).some(
        (c) => c.k === "fia_conj_nome",
      ),
    ).toBe(true);
  });
  it("rejeita tokens não aleatórios no formato esperado", () => {
    expect(TOKEN_LINK_RE.test("a".repeat(64))).toBe(true);
    expect(TOKEN_LINK_RE.test("a".repeat(63))).toBe(false);
    expect(TOKEN_LINK_RE.test("z".repeat(64))).toBe(false);
  });
});
