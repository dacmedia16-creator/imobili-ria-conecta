import { describe, expect, it } from "vitest";
import { bridgeOrgGate } from "../../supabase/functions/conta-max-bridge/core.ts";

type Rows = Record<string, Array<Record<string, unknown>>>;

function fakeAdmin(rows: Rows, failTable?: string) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return q;
        },
        maybeSingle: async () => {
          if (failTable === table) return { data: null, error: { message: "x" } };
          const hit = (rows[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v));
          return { data: hit ?? null, error: null };
        },
      };
      return q;
    },
  };
}

const ORG = "00000000-0000-4000-8000-000000000001";
const base: Rows = {
  organizations: [{ id: ORG, status: "ativa" }],
  organization_members: [{ user_id: "membro", organization_id: ORG, ativo: true }],
  platform_admins: [{ user_id: "plataforma" }],
};

describe("bridgeOrgGate", () => {
  it("membro ativo de agência ativa recebe sessão da agência", async () => {
    expect(await bridgeOrgGate(fakeAdmin(base), "membro")).toEqual({ ok: true, organizationId: ORG });
  });

  it("admin da plataforma sem agência recebe sessão sem agência", async () => {
    expect(await bridgeOrgGate(fakeAdmin(base), "plataforma")).toEqual({
      ok: true,
      organizationId: null,
    });
  });

  it("usuário sem agência e sem ser da plataforma continua barrado", async () => {
    expect(await bridgeOrgGate(fakeAdmin(base), "ninguem")).toEqual({
      ok: false,
      error: "organization_inactive",
    });
  });

  it("erro ao ler vínculo barra mesmo admin da plataforma", async () => {
    expect(await bridgeOrgGate(fakeAdmin(base, "organization_members"), "plataforma")).toEqual({
      ok: false,
      error: "organization_inactive",
    });
  });

  it("erro ao ler platform_admins barra", async () => {
    expect(await bridgeOrgGate(fakeAdmin(base, "platform_admins"), "plataforma")).toEqual({
      ok: false,
      error: "organization_inactive",
    });
  });

  it("membro com ticket de outra agência continua barrado", async () => {
    expect(await bridgeOrgGate(fakeAdmin(base), "membro", "outra")).toEqual({
      ok: false,
      error: "organization_mismatch",
    });
  });
});
