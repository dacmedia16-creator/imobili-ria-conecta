import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./platform-organizations.server", () => ({
  assertPlatformAdmin: vi.fn(async (_admin: unknown, callerId: string) => {
    if (callerId !== "platform-admin")
      throw new Error("Acesso restrito ao super-admin da plataforma.");
  }),
}));

import {
  assertReason,
  listPlatformUsers,
  logPlatformUserAction,
  platformActorFor,
} from "./platform-users.server";

type Rows = Record<string, unknown[]>;

function fakeAdmin(rows: Rows, inserts: unknown[] = []) {
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return q;
      },
      maybeSingle: async () => ({
        data:
          (rows[table] ?? []).find((r) =>
            filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v),
          ) ?? null,
        error: null,
      }),
      insert: async (row: unknown) => {
        inserts.push({ table, row });
        return { error: null };
      },
      then: (res: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(res),
    };
    return q;
  };
  const rpc = async (_fn: string, args: { _org: string }) => ({
    data: (rows.auth ?? []).filter((r) => (r as { org: string }).org === args._org),
    error: null,
  });
  return { from, rpc } as unknown as SupabaseClient;
}

const rows: Rows = {
  organizations: [
    { id: "org-a", nome: "Alpha" },
    { id: "org-b", nome: "Beta" },
  ],
  profiles: [
    {
      id: "u1",
      nome: "Ana",
      email: "ana@a",
      telefone: null,
      ativo: true,
      organization_id: "org-a",
    },
    {
      id: "u2",
      nome: "Bruno",
      email: "b@b",
      telefone: null,
      ativo: false,
      organization_id: "org-b",
    },
    { id: "u3", nome: "Órfão", email: "x@x", telefone: null, ativo: true, organization_id: null },
  ],
  user_roles: [
    { user_id: "u1", organization_id: "org-a", role: "admin" },
    { user_id: "u2", organization_id: "org-b", role: "corretor" },
  ],
  auth: [{ org: "org-a", user_id: "u1", last_sign_in_at: "2026-10-01T10:00:00Z" }],
};

describe("platform users", () => {
  it("bloqueia quem não é super-admin da plataforma", async () => {
    await expect(listPlatformUsers(fakeAdmin(rows), "admin-imobiliaria")).rejects.toThrow(
      /super-admin/,
    );
    await expect(platformActorFor(fakeAdmin(rows), "admin-imobiliaria", "u1")).rejects.toThrow(
      /super-admin/,
    );
  });

  it("lista usuários de todas as imobiliárias com papéis e último acesso", async () => {
    const list = await listPlatformUsers(fakeAdmin(rows), "platform-admin");
    expect(list.map((u) => [u.nome, u.organizationNome, u.roles, u.lastSignInAt])).toEqual([
      ["Ana", "Alpha", ["admin"], "2026-10-01T10:00:00Z"],
      ["Bruno", "Beta", ["corretor"], null],
    ]);
  });

  it("usa a imobiliária do alvo lida do banco e recusa a própria conta", async () => {
    const actor = await platformActorFor(fakeAdmin(rows), "platform-admin", "u2");
    expect(actor.orgId).toBe("org-b");
    await expect(
      platformActorFor(fakeAdmin(rows), "platform-admin", "platform-admin"),
    ).rejects.toThrow(/Meu acesso/);
    await expect(platformActorFor(fakeAdmin(rows), "platform-admin", "u3")).rejects.toThrow(
      /sem imobiliária/,
    );
  });

  it("exige motivo e audita na imobiliária do alvo", async () => {
    expect(() => assertReason("  ab ")).toThrow(/motivo/);
    expect(assertReason("  pedido do admin ")).toBe("pedido do admin");
    const inserts: unknown[] = [];
    const actor = await platformActorFor(fakeAdmin(rows), "platform-admin", "u2");
    await logPlatformUserAction(
      fakeAdmin(rows, inserts),
      actor,
      "user_deactivated",
      { target_user: "u2" },
      "teste ok",
    );
    expect(inserts).toEqual([
      {
        table: "activity_logs",
        row: expect.objectContaining({
          organization_id: "org-b",
          autor_id: "platform-admin",
          acao: "user_deactivated_platform",
          payload: expect.objectContaining({ motivo: "teste ok", via: "plataforma_global" }),
        }),
      },
    ]);
  });
});
