import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  contextBannerText,
  effectiveRoles,
  friendlyContextError,
  isContextExpired,
  parsePlatformContext,
} from "@/lib/platform-context";

const raw = {
  organization_id: "11111111-1111-1111-1111-111111111111",
  organization_name: "Única Escolha",
  expires_at: "2026-10-02T14:00:00Z",
};

describe("contexto do super-admin da plataforma", () => {
  it("converte o retorno da RPC e falha fechada em formato inesperado", () => {
    expect(parsePlatformContext(raw)).toEqual({
      organizationId: raw.organization_id,
      organizationName: "Única Escolha",
      expiresAt: raw.expires_at,
    });
    expect(parsePlatformContext(null)).toBeNull();
    expect(parsePlatformContext("x")).toBeNull();
    expect(parsePlatformContext({ organization_id: 1, expires_at: raw.expires_at })).toBeNull();
    expect(parsePlatformContext({ ...raw, expires_at: "amanhã" })).toBeNull();
  });

  it("trata expiração pelo horário do banco", () => {
    const ctx = parsePlatformContext(raw);
    expect(isContextExpired(ctx, Date.parse("2026-10-02T13:59:59Z"))).toBe(false);
    expect(isContextExpired(ctx, Date.parse("2026-10-02T14:00:00Z"))).toBe(true);
    expect(isContextExpired(null)).toBe(true);
  });

  it("usuário comum mantém os próprios papéis; no contexto valem os virtuais de admin", () => {
    expect(effectiveRoles(["corretor"], null)).toEqual(["corretor"]);
    expect(effectiveRoles([], parsePlatformContext(raw))).toEqual(["super_admin", "admin"]);
  });

  it("texto da faixa e mensagens de erro em português", () => {
    expect(contextBannerText(parsePlatformContext(raw)!)).toBe("Você está vendo a Única Escolha");
    expect(friendlyContextError("imobiliaria indisponivel")).toMatch(/suspensa/);
    expect(friendlyContextError("42501")).toMatch(/super-admin da plataforma/);
  });
});
