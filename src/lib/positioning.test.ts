import { describe, expect, it } from "vitest";
import { addPositioningRegion, groupRegions, MAX_POSITIONING_REGIONS, normalizeExternalUrl, normalizeInstagramUrl, parseSpecialistRegions, whatsappDigits, whatsappSpecialistUrl } from "./positioning";

describe("positioning", () => {
  it("normaliza WhatsApp brasileiro sem duplicar o DDI", () => {
    expect(whatsappDigits("(15) 99999-0000")).toBe("5515999990000");
    expect(whatsappDigits("+55 15 99999-0000")).toBe("5515999990000");
  });

  it("monta mensagem contextualizada para o especialista", () => {
    const url = whatsappSpecialistUrl({ id: "1", nome: "Ana", avatar_url: null, telefone: "15999990000", pagina_pessoal_url: null, instagram_url: null, regioes: [] }, "Campolim");
    expect(url).toContain("https://wa.me/5515999990000");
    expect(decodeURIComponent(url)).toContain("região de Campolim");
  });

  it("normaliza página pessoal e Instagram com protocolos seguros", () => {
    expect(normalizeExternalUrl("corretora.com.br")).toBe("https://corretora.com.br/");
    expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeInstagramUrl("@corretora.sp")).toBe("https://www.instagram.com/corretora.sp/");
    expect(normalizeInstagramUrl("https://exemplo.com/corretora")).toBeNull();
  });

  it("descarta regiões públicas malformadas", () => {
    expect(parseSpecialistRegions([{ id: 1, nome: "Campolim", cidade: "Sorocaba", zona: "Sul", tipo: "bairro" }, null])).toHaveLength(1);
    expect(parseSpecialistRegions("Campolim")).toEqual([]);
  });

  it("agrupa catálogo por cidade e zona", () => {
    const groups = groupRegions([
      { id: 1, cidade: "Sorocaba", zona: "Sul", nome: "Campolim", tipo: "bairro" },
      { id: 2, cidade: "Votorantim", zona: null, nome: "Votorantim", tipo: "cidade" },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Sorocaba — Sul", "Votorantim"]);
  });

  it("limita o posicionamento do corretor a dois locais", () => {
    expect(MAX_POSITIONING_REGIONS).toBe(2);
    expect(addPositioningRegion([1], 2)).toEqual({ ids: [1, 2], limitReached: false });
    expect(addPositioningRegion([1, 2], 3)).toEqual({ ids: [1, 2], limitReached: true });
    expect(addPositioningRegion([1, 2], 2)).toEqual({ ids: [1, 2], limitReached: false });
  });
});
