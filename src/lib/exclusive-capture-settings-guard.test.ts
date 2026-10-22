import { beforeEach, describe, expect, it, vi } from "vitest";

// Só o Supabase é simulado: a guarda passa pelo caminho real (getRouteAccess → loadMyAccess →
// effectiveRoles), o mesmo que o menu e as outras guardas usam (card t_722085c6).
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn(() => new Error("Rota bloqueada")),
}));
vi.mock("@tanstack/react-router", () => ({ redirect: mocks.redirect }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: mocks.getSession, onAuthStateChange: vi.fn() },
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));
import { guardExclusiveSettingsRoute } from "./exclusive-capture-settings-guard";
import { clearPlatformStateCache } from "./platform-context";

const FUTURO = () => new Date(Date.now() + 3_600_000).toISOString();

describe("Configurações / Assinatura digital: guarda por papel efetivo", () => {
  let active: boolean | null;
  let roles: string[];
  let rolesError: boolean;
  let platformAdmin: boolean;
  let context: unknown;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.redirect.mockImplementation(() => new Error("Rota bloqueada"));
    clearPlatformStateCache(); // também descarta o cache das guardas (onPlatformStateReset)
    active = true;
    roles = ["super_admin"];
    rolesError = false;
    platformAdmin = false;
    context = null;
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "actor" } } } });
    mocks.from.mockImplementation((table: string) => ({
      select: () => ({
        eq: () =>
          table === "user_roles"
            ? Promise.resolve({
                data: rolesError ? null : roles.map((role) => ({ role })),
                error: rolesError ? { message: "falha" } : null,
              })
            : {
                maybeSingle: () =>
                  Promise.resolve({
                    data: active === null ? null : { ativo: active },
                    error: null,
                  }),
              },
      }),
    }));
    mocks.rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "is_platform_super_admin"
          ? { data: platformAdmin, error: null }
          : { data: context, error: null },
      ),
    );
  });

  it("bloqueia sessão anônima", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  // NÃO REGRESSÃO: usuário real sem Administrador principal continua barrado.
  it.each([
    ["Administrador comum", ["admin"]],
    ["gestor", ["gestor"]],
    ["team_leader", ["team_leader"]],
    ["corretor", ["corretor"]],
    ["financeiro", ["financeiro"]],
    ["admin + gestor", ["admin", "gestor"]],
    ["sem papel (revogado)", []],
  ])("bloqueia %s (usuário real)", async (_nome, r) => {
    roles = r;
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
    expect(mocks.redirect).toHaveBeenCalledWith({ to: "/dashboard" });
  });

  it("bloqueia Administrador principal inativo ou sem perfil", async () => {
    active = false;
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
    active = null;
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
  });

  it("bloqueia quando a leitura de papéis falha (falha fechada)", async () => {
    rolesError = true;
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
  });

  it("permite Administrador principal ativo (sem consultar a flag)", async () => {
    await expect(guardExclusiveSettingsRoute()).resolves.toBeUndefined();
    expect(mocks.from).toHaveBeenCalledWith("profiles");
    expect(mocks.from).toHaveBeenCalledTimes(2); // user_roles + profiles
  });

  it("admin da plataforma FORA de imobiliária (sem user_roles) continua barrado", async () => {
    platformAdmin = true;
    roles = [];
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
  });

  it('admin da plataforma no "Entrar como" (contexto válido) abre, sem perfil na imobiliária', async () => {
    platformAdmin = true;
    roles = [];
    active = null;
    context = { organization_id: "org-1", organization_name: "Imob", expires_at: FUTURO() };
    await expect(guardExclusiveSettingsRoute()).resolves.toBeUndefined();
    expect(mocks.from).not.toHaveBeenCalledWith("profiles");
  });

  it("contexto expirado volta a barrar", async () => {
    platformAdmin = true;
    roles = [];
    context = {
      organization_id: "org-1",
      organization_name: "Imob",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
  });

  it("usuário comum não ganha contexto mesmo que a RPC de contexto devolva algo", async () => {
    roles = ["admin"];
    context = { organization_id: "org-1", organization_name: "Imob", expires_at: FUTURO() };
    await expect(guardExclusiveSettingsRoute()).rejects.toThrow("Rota bloqueada");
    expect(mocks.rpc).not.toHaveBeenCalledWith("platform_current_org");
  });
});
