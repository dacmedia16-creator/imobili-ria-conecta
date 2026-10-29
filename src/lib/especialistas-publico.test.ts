import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agencyLocationLabel,
  directAgencySlug,
  isValidAgencySlug,
  regionNorm,
  specialistsCountLabel,
} from "./especialistas-publico";

const MIG = readFileSync(
  "supabase/migrations/20261029150000_especialistas_por_imobiliaria.sql",
  "utf8",
);

describe("página pública de especialistas (t_6d8de1d7)", () => {
  it("só 1 imobiliária publicada vai direto para a página dela", () => {
    expect(directAgencySlug([{ slug: "unica-escolha", cidade: null, uf: null }])).toBe("unica-escolha");
    expect(directAgencySlug([])).toBeNull();
    expect(
      directAgencySlug([
        { slug: "a", cidade: null, uf: null },
        { slug: "b", cidade: null, uf: null },
      ]),
    ).toBeNull();
  });
  it("cartão: cidade/UF e contagem", () => {
    expect(agencyLocationLabel({ cidade: "Sorocaba", uf: "sp" })).toBe("Sorocaba — SP");
    expect(agencyLocationLabel({ cidade: null, uf: null })).toBe("");
    expect(specialistsCountLabel(1)).toBe("1 especialista");
    expect(specialistsCountLabel(3)).toBe("3 especialistas");
  });
  it("slug e normalização de nome iguais ao banco", () => {
    expect(isValidAgencySlug("remax-capacita")).toBe(true);
    expect(isValidAgencySlug("../x")).toBe(false);
    expect(regionNorm("  Jardim   NÔVO ")).toBe("jardim novo");
  });
  it("migration: grants mínimos e sem e-mail na exposição pública", () => {
    expect(MIG).toContain("REVOKE ALL ON public.positioning_region_orgs FROM PUBLIC, anon, authenticated;");
    expect(MIG).toMatch(/positioning_region_obter_ou_criar\(uuid, uuid, text, text, text, text, text\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(MIG).not.toMatch(/list_public_org_specialists[\s\S]*?p\.email/);
    expect(MIG).toContain("SELECT o.id, 'especialistas_publico', o.legacy_default FROM public.organizations o");
  });
});
