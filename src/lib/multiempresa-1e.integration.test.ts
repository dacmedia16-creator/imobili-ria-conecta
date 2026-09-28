/**
 * Marco 1e (multiempresa) — fronteira admin/gestor contra o CLONE LOCAL descartável.
 *
 * Servidor: a regra única (user-management.server.ts) com service_role via PostgREST local.
 * Banco: as mesmas tentativas proibidas feitas DIRETO pela API com JWT de usuário (sem passar pelo
 * servidor) precisam falhar. Roda só com MT1E_REST_URL em 127.0.0.1 (ver run-1e.sh); nunca fala
 * com o Supabase real. Fixture sintética em supabase/multiempresa/tests/fixture_1e_rest.sql.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgScopeError, resolveActiveOrg, type OrgAdminClient } from "./org-scope";
import {
  assertCreateAllowed,
  assertUserActionAllowed,
  loadActor,
} from "./user-management.server";

const REST_URL = process.env.MT1E_REST_URL ?? "";
const TOKEN_FILE = process.env.MT1E_REST_TOKEN_FILE ?? "";
const SECRET_FILE = process.env.MT1E_REST_SECRET_FILE ?? "";
const ENABLED =
  /^http:\/\/127\.0\.0\.1:\d+$/.test(REST_URL) && TOKEN_FILE.length > 0 && SECRET_FILE.length > 0;

const ORG_A = "00000000-0000-4000-8000-000000000001";
const ORG_B = "3e000000-0000-4000-8000-0000000000b0";
const A_SUPER = "3e000000-0000-4000-8000-00000000a000";
const A_ADMIN = "3e000000-0000-4000-8000-00000000a001";
const A_GESTOR = "3e000000-0000-4000-8000-00000000a002";
const A_COR1 = "3e000000-0000-4000-8000-00000000a003"; // equipe do gestor A
const A_COR2 = "3e000000-0000-4000-8000-00000000a004"; // sem equipe
const A_ADMIN2 = "3e000000-0000-4000-8000-00000000a005";
const B_ADMIN = "3e000000-0000-4000-8000-00000000b001";
const B_COR = "3e000000-0000-4000-8000-00000000b002";

const localFetch: typeof fetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input).replace("/rest/v1", "");
  if (!url.startsWith(REST_URL)) throw new Error(`Destino não local bloqueado: ${url}`);
  return fetch(url, init);
};
const client = (token: string) =>
  createClient(REST_URL, token, {
    global: { fetch: localFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as OrgAdminClient;

function userToken(sub: string) {
  const secret = readFileSync(SECRET_FILE, "utf8").trim();
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

let admin: OrgAdminClient;

async function actorOf(userId: string) {
  const orgId = await resolveActiveOrg(admin, userId);
  return loadActor(admin, orgId, userId);
}

describe.skipIf(!ENABLED)("multiempresa 1e — fronteira admin/gestor (clone local)", () => {
  beforeAll(() => {
    admin = client(readFileSync(TOKEN_FILE, "utf8").trim());
  });

  // ---------------- Servidor ----------------
  it("servidor: papéis do ator vêm só da agência ativa dele", async () => {
    expect((await actorOf(A_GESTOR)).roles).toEqual(expect.arrayContaining(["gestor"]));
    expect((await actorOf(B_ADMIN)).orgId).toBe(ORG_B);
  });

  const matrix: [string, string, string, "edit_user" | "reset_password" | "set_active", boolean][] =
    [];
  for (const action of ["edit_user", "reset_password", "set_active"] as const) {
    matrix.push(
      ["super admin A", A_SUPER, A_COR2, action, true],
      ["admin A", A_ADMIN, A_COR2, action, true],
      ["admin A", A_ADMIN, B_COR, action, false],
      ["gestor A", A_GESTOR, A_COR1, action, true],
      ["gestor A", A_GESTOR, A_COR2, action, false],
      ["gestor A", A_GESTOR, A_ADMIN2, action, false],
      ["gestor A", A_GESTOR, B_COR, action, false],
      ["corretor A", A_COR1, A_COR2, action, false],
      ["admin B", B_ADMIN, B_COR, action, true],
      ["admin B", B_ADMIN, A_COR1, action, false],
    );
  }
  it.each(matrix)("servidor: %s → %s sobre %s (%s) = %s", async (_l, actorId, target, action, ok) => {
    const actor = await actorOf(actorId);
    const p = assertUserActionAllowed(admin, actor, action, target);
    if (ok) await expect(p).resolves.toBeUndefined();
    else await expect(p).rejects.toBeInstanceOf(OrgScopeError);
  });

  it("servidor: alvo de outra agência responde 'não encontrado'", async () => {
    await expect(
      assertUserActionAllowed(admin, await actorOf(A_ADMIN), "edit_user", B_COR),
    ).rejects.toThrow("não encontrado");
  });

  it("servidor: papéis — admin A concede gestor, não concede admin; gestor não altera papéis", async () => {
    const adminA = await actorOf(A_ADMIN);
    await expect(
      assertUserActionAllowed(admin, adminA, "change_roles", A_COR2, "gestor"),
    ).resolves.toBeUndefined();
    await expect(
      assertUserActionAllowed(admin, adminA, "change_roles", A_COR2, "admin"),
    ).rejects.toThrow("super admin");
    await expect(
      assertUserActionAllowed(admin, await actorOf(A_SUPER), "change_roles", A_COR2, "admin"),
    ).resolves.toBeUndefined();
    const gestorA = await actorOf(A_GESTOR);
    await expect(
      assertUserActionAllowed(admin, gestorA, "change_roles", A_COR1, "admin"),
    ).rejects.toThrow();
    await expect(
      assertUserActionAllowed(admin, gestorA, "change_roles", A_GESTOR, "admin"),
    ).rejects.toThrow("próprio papel");
  });

  it("servidor: cadastro — gestor só cadastra corretor; admin não cadastra admin", async () => {
    const gestorA = await actorOf(A_GESTOR);
    expect(() => assertCreateAllowed(gestorA, "corretor")).not.toThrow();
    expect(() => assertCreateAllowed(gestorA, "admin")).toThrow(OrgScopeError);
    const adminA = await actorOf(A_ADMIN);
    expect(() => assertCreateAllowed(adminA, "financeiro")).not.toThrow();
    expect(() => assertCreateAllowed(adminA, "admin")).toThrow(OrgScopeError);
    const corretorA = await actorOf(A_COR1);
    expect(() => assertCreateAllowed(corretorA, "corretor")).toThrow(OrgScopeError);
  });

  // ---------------- Banco (direto pela API, sem passar pelo servidor) ----------------
  it("banco: gestor A não promove corretor a admin nem altera o próprio papel", async () => {
    const g = client(userToken(A_GESTOR));
    const ins = await g.from("user_roles").insert({ user_id: A_COR1, role: "admin" });
    expect(ins.error).not.toBeNull();
    const upd = await g
      .from("user_roles")
      .update({ role: "admin" })
      .eq("user_id", A_GESTOR)
      .eq("role", "gestor")
      .select();
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const { data } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", A_GESTOR)
      .eq("organization_id", ORG_A);
    expect((data ?? []).map((r: { role: string }) => r.role)).not.toContain("admin");
  });

  it("banco: admin A não concede admin, não mexe em B, não move usuário de agência", async () => {
    const a = client(userToken(A_ADMIN));
    expect((await a.from("user_roles").insert({ user_id: A_COR2, role: "admin" })).error).not.toBeNull();
    expect((await a.from("user_roles").insert({ user_id: B_COR, role: "gestor" })).error).not.toBeNull();
    const deact = await a.from("profiles").update({ ativo: false }).eq("id", B_COR).select();
    expect((deact.data ?? []).length).toBe(0);
    const move = await a
      .from("organization_members")
      .update({ organization_id: ORG_B })
      .eq("user_id", A_COR2)
      .select();
    expect(move.error !== null || (move.data ?? []).length === 0).toBe(true);
    const moveProfile = await a
      .from("profiles")
      .update({ organization_id: ORG_B })
      .eq("id", A_COR2)
      .select();
    expect(moveProfile.error).not.toBeNull();
    const { data: still } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", A_COR2)
      .single();
    expect((still as { organization_id: string }).organization_id).toBe(ORG_A);
  });

  it("banco: nenhum papel de agência cria, edita ou suspende imobiliária", async () => {
    for (const who of [A_SUPER, A_ADMIN, A_GESTOR, A_COR1, B_ADMIN]) {
      const c = client(userToken(who));
      expect((await c.rpc("platform_create_organization", { _slug: "x-1e", _nome: "X" })).error).not.toBeNull();
      expect(
        (await c.rpc("platform_set_organization_status", { _id: ORG_A, _status: "suspensa" })).error,
      ).not.toBeNull();
      expect(
        (await c.rpc("platform_update_organization", { _id: ORG_B, _nome: "Hack", _slug: null })).error,
      ).not.toBeNull();
      const direct = await c.from("organizations").update({ status: "suspensa" }).eq("id", ORG_B).select();
      expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true);
    }
    const { data } = await admin.from("organizations").select("status, nome").eq("id", ORG_B).single();
    expect(data).toEqual({ status: "ativa", nome: "Agencia B REST 1e" });
  });

  it("banco: gestor e corretor não desativam ninguém direto; admin B desativa só em B", async () => {
    for (const who of [A_GESTOR, A_COR1]) {
      const r = await client(userToken(who)).from("profiles").update({ ativo: false }).eq("id", A_COR2).select();
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    }
    const b = client(userToken(B_ADMIN));
    const own = await b.from("profiles").update({ ativo: false }).eq("id", B_COR).select("id");
    expect(own.error).toBeNull();
    expect((own.data ?? []).length).toBe(1);
    await admin.from("profiles").update({ ativo: true }).eq("organization_id", ORG_B).eq("id", B_COR);
    const { data } = await admin.from("profiles").select("ativo").eq("id", A_COR2).single();
    expect((data as { ativo: boolean }).ativo).toBe(true);
  });

  it("servidor + banco: desativação pelo servidor passa só após a regra (gestor → corretor da equipe)", async () => {
    const gestorA = await actorOf(A_GESTOR);
    await assertUserActionAllowed(admin, gestorA, "set_active", A_COR1);
    const off = await admin
      .from("profiles")
      .update({ ativo: false })
      .eq("organization_id", ORG_A)
      .eq("id", A_COR1)
      .select("id");
    expect(off.error).toBeNull();
    expect((off.data ?? []).length).toBe(1);
    await admin.from("profiles").update({ ativo: true }).eq("organization_id", ORG_A).eq("id", A_COR1);
    // O servidor nunca move usuário de agência, nem com service_role.
    const move = await admin
      .from("organization_members")
      .update({ organization_id: ORG_B })
      .eq("user_id", A_COR1);
    expect(move.error).not.toBeNull();
  });
});
