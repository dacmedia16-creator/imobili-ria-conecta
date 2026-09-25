import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
  redirect: vi.fn(() => new Error("Rota bloqueada")),
}));
vi.mock("@tanstack/react-router", () => ({ redirect: mocks.redirect }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.getSession }, from: mocks.from },
}));
import { guardExclusiveSettingsRoute } from "./exclusive-capture-settings-guard";

describe("configurações de captações: guarda independente da flag", () => {
  let active: boolean;
  let roles: string[];
  beforeEach(() => {
    vi.resetAllMocks();
    active = true;
    roles = ["super_admin"];
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "actor" } } } });
    mocks.from.mockImplementation((table: string) => ({
      select: () => ({
        eq: () =>
          table === "user_roles"
            ? Promise.resolve({ data: roles.map((role) => ({ role })), error: null })
            : { maybeSingle: () => Promise.resolve({ data: { ativo: active }, error: null }) },
      }),
    }));
  });

  it("bloqueia sessão anônima", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(["admin", "gestor", "team_leader", "corretor"])(
    "bloqueia %s sem papel super_admin",
    async (role) => {
      roles = [role];
      await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
    },
  );

  it("bloqueia super_admin inativo e papel revogado", async () => {
    active = false;
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
    active = true;
    roles = [];
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
  });

  it("permite super_admin ativo sem consultar a flag (inclusive desligada)", async () => {
    await expect(guardExclusiveSettingsRoute()).resolves.toBeUndefined();
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
});
