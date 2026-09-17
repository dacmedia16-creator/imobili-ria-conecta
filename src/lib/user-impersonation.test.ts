import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  impersonationMatchesSession,
  readOperationalImpersonation,
  writeOperationalImpersonation,
} from "./user-impersonation";

describe("operational impersonation state", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => values.set(k, v),
        removeItem: (k: string) => values.delete(k),
      },
      dispatchEvent: vi.fn(),
    });
  });

  it("persists metadata without privileged return tokens", () => {
    const value = {
      auditId: crypto.randomUUID(),
      actorUserId: crypto.randomUUID(),
      actorEmail: "admin@test.com",
      targetUserId: crypto.randomUUID(),
      targetName: "Teste",
      targetEmail: "user@test.com",
      startedAt: new Date().toISOString(),
    };
    writeOperationalImpersonation(value);
    const stored = window.localStorage.getItem("adm-max:operational-impersonation:v1") ?? "";
    expect(stored).not.toContain("AccessToken");
    expect(stored).not.toContain("RefreshToken");
    expect(readOperationalImpersonation()).toMatchObject({
      auditId: value.auditId,
      targetUserId: value.targetUserId,
    });
    writeOperationalImpersonation(null);
    expect(readOperationalImpersonation()).toBeNull();
  });

  it("ignores legacy token fields when reading an existing session", () => {
    const value = {
      auditId: crypto.randomUUID(),
      actorUserId: crypto.randomUUID(),
      actorEmail: "admin@test.com",
      targetUserId: crypto.randomUUID(),
      targetName: "Teste",
      targetEmail: "user@test.com",
      startedAt: new Date().toISOString(),
      actorAccessToken: "legacy-access",
      actorRefreshToken: "legacy-refresh",
    };
    window.localStorage.setItem("adm-max:operational-impersonation:v1", JSON.stringify(value));
    const state = readOperationalImpersonation();
    expect(state).toMatchObject({ auditId: value.auditId, targetUserId: value.targetUserId });
    expect(state).not.toHaveProperty("actorAccessToken");
    expect(state).not.toHaveProperty("actorRefreshToken");
    const sanitized = window.localStorage.getItem("adm-max:operational-impersonation:v1") ?? "";
    expect(sanitized).not.toContain("legacy-access");
    expect(sanitized).not.toContain("legacy-refresh");
  });

  it("only matches the selected target session", () => {
    const value = {
      auditId: "a",
      actorUserId: "b",
      actorEmail: "a@a.com",
      targetUserId: "target",
      targetName: "T",
      targetEmail: "t@a.com",
      startedAt: "now",
    };
    expect(impersonationMatchesSession(value, { user: { id: "target" } } as never)).toBe(true);
    expect(impersonationMatchesSession(value, { user: { id: "other" } } as never)).toBe(false);
  });
});
