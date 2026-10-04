import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261004210000_exclusividade_unidades_org.sql",
    import.meta.url,
  ),
  "utf8",
);
const fn = (name: string) => {
  const start = migration.indexOf(`FUNCTION public.${name}(`);
  return migration.slice(start, migration.indexOf("END $$;", start));
};

describe("migration de unidades por imobiliária (isolamento por org)", () => {
  it("leitura de exclusive_units só da organização atual, sem escrita direta", () => {
    expect(migration).toContain("ALTER TABLE public.exclusive_units ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain(
      "REVOKE ALL ON public.exclusive_units FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain("GRANT SELECT ON public.exclusive_units TO authenticated");
    expect(migration).not.toMatch(
      /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*exclusive_units TO authenticated/,
    );
    expect(migration).toMatch(
      /CREATE POLICY exclusive_units_read[\s\S]*?organization_id = \(SELECT public\.current_org_id\(\)\)/,
    );
  });

  it("exclusive_create_unit só aceita unidade ativa da organização do usuário", () => {
    const body = fn("exclusive_create_unit");
    expect(body).toContain("organization_id = public.current_org_id() AND ativo");
    expect(body).toContain("RAISE EXCEPTION 'Unidade inválida'");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.exclusive_create_unit(uuid) FROM PUBLIC, anon",
    );
  });

  it("captação e unidade ficam na mesma organização (FK composta)", () => {
    expect(migration).toContain(
      "FOREIGN KEY (unit_id, organization_id) REFERENCES public.exclusive_units(id, organization_id)",
    );
  });

  it("captações antigas continuam válidas e o legado fica restrito à própria org", () => {
    expect(migration).toMatch(/unit_id IS NOT NULL OR template IN \('campolim','barao-de-tatui'\)/);
    const legacy = fn("exclusive_create");
    expect(legacy).toContain(
      "organization_id = public.current_org_id() AND legacy_template = _template",
    );
    // Única Escolha segue nos PDFs antigos até a aprovação de Denis.
    expect(migration).toMatch(/'RE\/MAX ÚNICA ESCOLHA', v\.tpl, true/);
  });
});
