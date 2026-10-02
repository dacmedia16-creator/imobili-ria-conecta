import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  enabled: vi.fn(),
  from: vi.fn(),
  redirect: vi.fn(() => new Error("Rota bloqueada")),
}));
vi.mock("@tanstack/react-router", () => ({ redirect: mocks.redirect }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.getSession }, from: mocks.from },
}));
vi.mock("./exclusive-captures-db", () => ({ exclusiveEnabled: mocks.enabled }));
const platform = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock("./platform-context", () => ({ fetchPlatformState: platform.state }));

import { guardExclusiveRoute } from "./exclusive-captures-guard";

describe("guarda de rota das captações", () => {
  let active: boolean;
  let roles: { role: string }[];

  beforeEach(() => {
    vi.resetAllMocks();
    active = true;
    roles = [{ role: "corretor" }];
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "actor" } } } });
    mocks.enabled.mockResolvedValue(true);
    platform.state.mockResolvedValue({ isPlatformAdmin: false, context: null });
    mocks.from.mockImplementation((table: string) => ({
      select: () => ({
        eq: () =>
          table === "user_roles"
            ? Promise.resolve({ data: roles, error: null })
            : {
                maybeSingle: () => Promise.resolve({ data: { ativo: active }, error: null }),
              },
      }),
    }));
  });

  it("nega acesso anônimo sem consultar a configuração", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(guardExclusiveRoute()).rejects.toThrow("Rota bloqueada");
    expect(mocks.enabled).not.toHaveBeenCalled();
  });

  it("nega quando a migração ou flag ainda não habilitou o módulo", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(guardExclusiveRoute()).rejects.toThrow("Rota bloqueada");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("nega perfil inativo ou papel revogado, mesmo com sessão e flag", async () => {
    active = false;
    await expect(guardExclusiveRoute()).rejects.toThrow("Rota bloqueada");
    active = true;
    roles = [];
    await expect(guardExclusiveRoute()).rejects.toThrow("Rota bloqueada");
    expect(mocks.redirect).toHaveBeenCalledWith({ to: "/dashboard" });
  });

  it("permite sessão ativa com papel autorizado", async () => {
    await expect(guardExclusiveRoute()).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("permite o super-admin da plataforma no contexto de uma imobiliária", async () => {
    platform.state.mockResolvedValue({
      isPlatformAdmin: true,
      context: { organizationId: "o", organizationName: "X", expiresAt: "2999-01-01T00:00:00Z" },
    });
    active = false; // o perfil dele não é visível na outra imobiliária
    roles = [];
    await expect(guardExclusiveRoute()).resolves.toBeUndefined();
  });

  it("não libera o contexto quando o módulo está desligado", async () => {
    mocks.enabled.mockResolvedValue(false);
    platform.state.mockResolvedValue({
      isPlatformAdmin: true,
      context: { organizationId: "o", organizationName: "X", expiresAt: "2999-01-01T00:00:00Z" },
    });
    await expect(guardExclusiveRoute()).rejects.toThrow("Rota bloqueada");
  });
});
