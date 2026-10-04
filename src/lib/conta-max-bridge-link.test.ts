import { describe, expect, it } from "vitest";
import { resolveBridgeLink } from "../../supabase/functions/conta-max-bridge/core.ts";

// Banco falso em memória: dados 100% fictícios.
type Link = { id: string; workos_user_id: string; adm_user_id: string; active: boolean };

function fakeAdmin(links: Link[], users: Array<{ id: string; email: string }>) {
  const writes: Array<{ op: string; row: unknown }> = [];
  const admin = {
    auth: { admin: { listUsers: async () => ({ data: { users }, error: null }) } },
    from(table: string) {
      if (table !== "conta_max_identity_links") throw new Error(`tabela inesperada ${table}`);
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return q;
        },
        maybeSingle: async () => ({
          data:
            links.find((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v)) ??
            null,
          error: null,
        }),
        insert: async (row: Omit<Link, "id">) => {
          writes.push({ op: "insert", row });
          if (links.some((l) => l.workos_user_id === row.workos_user_id || l.adm_user_id === row.adm_user_id))
            return { error: { message: "duplicate key" } };
          links.push({ id: `l${links.length + 1}`, ...row });
          return { error: null };
        },
        update: (row: unknown) => {
          writes.push({ op: "update", row });
          return q;
        },
      };
      return q;
    },
  };
  return { admin, writes, links };
}

const VITIMA = { id: "adm-vitima", email: "vitima@exemplo.test" };

describe("resolveBridgeLink (conta-max-bridge)", () => {
  it("primeiro vínculo: usuário sem vínculo → insert", async () => {
    const f = fakeAdmin([], [VITIMA]);
    expect(await resolveBridgeLink(f.admin, "sub-legitimo", VITIMA.email)).toEqual({
      ok: true,
      admUserId: VITIMA.id,
      created: true,
    });
    expect(f.links).toHaveLength(1);
    expect(f.writes.map((w) => w.op)).toEqual(["insert"]);
  });

  it("login com vínculo ativo do mesmo sub entra sem gravar nada", async () => {
    const f = fakeAdmin(
      [{ id: "l1", workos_user_id: "sub-legitimo", adm_user_id: VITIMA.id, active: true }],
      [VITIMA],
    );
    expect(await resolveBridgeLink(f.admin, "sub-legitimo", VITIMA.email)).toEqual({
      ok: true,
      admUserId: VITIMA.id,
      created: false,
    });
    expect(f.writes).toEqual([]);
  });

  it("outro sub com o mesmo e-mail é bloqueado e não sobrescreve o vínculo ativo", async () => {
    const f = fakeAdmin(
      [{ id: "l1", workos_user_id: "sub-legitimo", adm_user_id: VITIMA.id, active: true }],
      [VITIMA],
    );
    expect(await resolveBridgeLink(f.admin, "sub-atacante", VITIMA.email)).toEqual({
      ok: false,
      status: 403,
      error: "identity_conflict",
    });
    expect(f.writes).toEqual([]);
    expect(f.links[0]).toMatchObject({ workos_user_id: "sub-legitimo", active: true });
  });

  it("vínculo revogado de outro sub: bloqueia, não reaproveita nem reativa", async () => {
    const f = fakeAdmin(
      [{ id: "l1", workos_user_id: "sub-antigo", adm_user_id: VITIMA.id, active: false }],
      [VITIMA],
    );
    expect(await resolveBridgeLink(f.admin, "sub-novo", VITIMA.email)).toEqual({
      ok: false,
      status: 403,
      error: "identity_conflict",
    });
    expect(f.writes).toEqual([]);
    expect(f.links[0]).toMatchObject({ workos_user_id: "sub-antigo", active: false });
  });

  it("vínculo revogado do mesmo sub: bloqueia (reativação só por admin)", async () => {
    const f = fakeAdmin(
      [{ id: "l1", workos_user_id: "sub-legitimo", adm_user_id: VITIMA.id, active: false }],
      [VITIMA],
    );
    expect(await resolveBridgeLink(f.admin, "sub-legitimo", VITIMA.email)).toEqual({
      ok: false,
      status: 403,
      error: "identity_revoked",
    });
    expect(f.writes).toEqual([]);
  });

  it("sub ligado (revogado) a outro usuário do ADM: conflito", async () => {
    const outro = { id: "adm-outro", email: "outro@exemplo.test" };
    const f = fakeAdmin(
      [{ id: "l1", workos_user_id: "sub-x", adm_user_id: outro.id, active: false }],
      [VITIMA, outro],
    );
    expect(await resolveBridgeLink(f.admin, "sub-x", VITIMA.email)).toMatchObject({
      ok: false,
      error: "identity_conflict",
    });
    expect(f.writes).toEqual([]);
  });

  it("e-mail inexistente ou ambíguo continua barrado", async () => {
    expect(await resolveBridgeLink(fakeAdmin([], [VITIMA]).admin, "s", "nada@exemplo.test")).toMatchObject({
      ok: false,
      error: "account_email_not_found",
    });
    const dup = fakeAdmin([], [VITIMA, { id: "adm-2", email: " VITIMA@exemplo.test" }]);
    expect(await resolveBridgeLink(dup.admin, "s", VITIMA.email)).toMatchObject({
      ok: false,
      error: "account_email_ambiguous",
    });
  });
});
