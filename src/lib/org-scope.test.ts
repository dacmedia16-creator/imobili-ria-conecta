import { describe, expect, it, vi } from "vitest";

import {
  assertNotInPlatformContext,
  OrgScopeError,
  PLATFORM_CONTEXT_CHECK_FAILED,
  PLATFORM_CONTEXT_WRITE_BLOCKED,
  resolveCallerScope,
  type OrgAdminClient,
} from "@/lib/org-scope";

const CTX_ORG = "22222222-2222-2222-2222-222222222222";
const HOME_ORG = "11111111-1111-1111-1111-111111111111";

const caller = (result: { data: unknown; error: unknown }) => ({
  rpc: vi.fn(async () => result),
});

/** Cliente service_role que resolve a imobiliária de origem do ator (HOME_ORG). */
function homeAdmin(): OrgAdminClient {
  const chain = (row: unknown) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = async () => ({ data: row, error: null });
    return q;
  };
  return {
    from: (table: string) =>
      chain(table === "organization_members" ? { organization_id: HOME_ORG } : { id: HOME_ORG }),
  } as unknown as OrgAdminClient;
}

describe("escopo de quem chama no contexto da plataforma (falha fechada)", () => {
  it("com contexto ativo usa a org destino", async () => {
    const scope = await resolveCallerScope(
      caller({ data: { organization_id: CTX_ORG }, error: null }),
      homeAdmin(),
      "u",
    );
    expect(scope).toEqual({ orgId: CTX_ORG, inPlatformContext: true });
  });

  it("sem contexto (null) usa a imobiliária de origem", async () => {
    const scope = await resolveCallerScope(caller({ data: null, error: null }), homeAdmin(), "u");
    expect(scope).toEqual({ orgId: HOME_ORG, inPlatformContext: false });
  });

  it("RPC inexistente (banco sem migration) = sem contexto", async () => {
    for (const error of [
      { code: "PGRST202", message: "x" },
      { code: "42883", message: "x" },
      { message: "Could not find the function public.platform_current_org" },
    ]) {
      const scope = await resolveCallerScope(caller({ data: null, error }), homeAdmin(), "u");
      expect(scope.orgId).toBe(HOME_ORG);
      await expect(assertNotInPlatformContext(caller({ data: null, error }))).resolves.toBe(
        undefined,
      );
    }
  });

  it("erro de rede/5xx NÃO cai na imobiliária de origem nem libera gravação", async () => {
    for (const error of [
      { code: "", message: "TypeError: fetch failed" },
      { code: "57014", message: "canceling statement due to statement timeout" },
      { code: "PGRST000", message: "503" },
    ]) {
      const user = caller({ data: null, error });
      await expect(resolveCallerScope(user, homeAdmin(), "u")).rejects.toThrow(
        PLATFORM_CONTEXT_CHECK_FAILED,
      );
      await expect(assertNotInPlatformContext(user)).rejects.toBeInstanceOf(OrgScopeError);
    }
  });

  it("gravação service_role bloqueada no contexto e liberada fora dele", async () => {
    await expect(
      assertNotInPlatformContext(caller({ data: { organization_id: CTX_ORG }, error: null })),
    ).rejects.toThrow(PLATFORM_CONTEXT_WRITE_BLOCKED);
    await expect(
      assertNotInPlatformContext(caller({ data: null, error: null })),
    ).resolves.toBeUndefined();
  });
});
