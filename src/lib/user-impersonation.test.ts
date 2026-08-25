import { describe, expect, it, beforeEach, vi } from "vitest";
import { impersonationMatchesSession, readOperationalImpersonation, writeOperationalImpersonation } from "./user-impersonation";

describe("operational impersonation state", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) },
      dispatchEvent: vi.fn(),
    });
  });

  it("persists and clears the return credentials", () => {
    const value = { auditId: crypto.randomUUID(), actorUserId: crypto.randomUUID(), actorEmail: "admin@test.com", targetUserId: crypto.randomUUID(), targetName: "Teste", targetEmail: "user@test.com", startedAt: new Date().toISOString(), actorAccessToken: "access", actorRefreshToken: "refresh" };
    writeOperationalImpersonation(value);
    expect(readOperationalImpersonation()).toEqual(value);
    writeOperationalImpersonation(null);
    expect(readOperationalImpersonation()).toBeNull();
  });

  it("only matches the selected target session", () => {
    const value = { auditId: "a", actorUserId: "b", actorEmail: "a@a.com", targetUserId: "target", targetName: "T", targetEmail: "t@a.com", startedAt: "now", actorAccessToken: "x", actorRefreshToken: "y" };
    expect(impersonationMatchesSession(value, { user: { id: "target" } } as any)).toBe(true);
    expect(impersonationMatchesSession(value, { user: { id: "other" } } as any)).toBe(false);
  });
});

