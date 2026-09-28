/**
 * Fase 2a (multiempresa) — E2E no Supabase de HOMOLOGAÇÃO real (adm-max-homolog).
 *
 * Auth (auth.admin.createUser/updateUserById, login por senha) e Storage (API real) com a regra
 * única de gestão de usuários aplicada antes do service_role. Só dados fictícios (@example.test).
 * Roda apenas com MT2A_HOMOLOG_ENV apontando para o arquivo protegido de chaves da homologação;
 * recusa qualquer projeto que não seja o ref de homologação. Nunca imprime chaves.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScopeError, resolveActiveOrg, type OrgAdminClient } from "./org-scope";
import { assertCreateAllowed, assertUserActionAllowed, loadActor } from "./user-management.server";
import type { ManagedRole } from "./user-management-policy";

const HOMOLOG_REF = "qvhyepwduhlgqwpgmpvh";
const ENV_FILE = process.env.MT2A_HOMOLOG_ENV ?? "";
const env: Record<string, string> = {};
if (ENV_FILE && existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1).trim();
  }
}
const URL_ = env.HOMOLOG_URL ?? "";
const ENABLED =
  env.HOMOLOG_REF === HOMOLOG_REF &&
  URL_ === `https://${HOMOLOG_REF}.supabase.co` &&
  Boolean(env.HOMOLOG_SERVICE_ROLE_KEY && env.HOMOLOG_ANON_KEY);

const ORG_A = "00000000-0000-4000-8000-000000000001"; // organização legada (sem dados reais)
const ORG_B = "2a000000-0000-4000-8000-0000000000b0"; // Agência B fictícia
const RUN = Date.now().toString(36);
const PASSWORD = `Homolog-${RUN}-x9!`;

const guardFetch: typeof fetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(URL_)) throw new Error("Destino fora da homologação bloqueado");
  return fetch(input, init);
};
const opts = {
  global: { fetch: guardFetch },
  auth: { persistSession: false, autoRefreshToken: false },
};

let admin: SupabaseClient;
const created: string[] = [];
const ids: Record<string, string> = {};

async function makeUser(key: string, org: string, role: ManagedRole, nome: string) {
  const email = `h2a-${RUN}-${key}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { nome },
    app_metadata: { organization_id: org },
  });
  if (error || !data.user) throw new Error(`createUser ${key}: ${error?.message}`);
  created.push(data.user.id);
  ids[key] = data.user.id;
  if (role !== "corretor") {
    await admin.from("user_roles").delete().eq("organization_id", org).eq("user_id", data.user.id);
    const ins = await admin
      .from("user_roles")
      .insert({ organization_id: org, user_id: data.user.id, role });
    if (ins.error) throw new Error(ins.error.message);
  }
  return { id: data.user.id, email };
}

async function signIn(key: string) {
  const c = createClient(URL_, env.HOMOLOG_ANON_KEY, opts);
  const email = `h2a-${RUN}-${key}@example.test`;
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login ${key}: ${error.message}`);
  return c;
}

async function actorOf(userId: string) {
  const a = admin as unknown as OrgAdminClient;
  return loadActor(a, await resolveActiveOrg(a, userId), userId);
}

describe.skipIf(!ENABLED)("multiempresa 2a — homologação real (Auth + Storage)", () => {
  beforeAll(async () => {
    admin = createClient(URL_, env.HOMOLOG_SERVICE_ROLE_KEY, opts);
    await makeUser("a_admin", ORG_A, "admin", "A Admin Ficticio");
    await makeUser("a_gestor", ORG_A, "gestor", "A Gestor Ficticio");
    await makeUser("b_admin", ORG_B, "admin", "B Admin Ficticio");
    await makeUser("b_cor", ORG_B, "corretor", "B Corretor Ficticio");
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    // Remove os dados fictícios deste ensaio (vendas H2A e usuários h2a-*), depois os arquivos.
    await admin.from("sales").delete().like("imovel_id", `H2A-${RUN}`);
    for (const id of created) await admin.auth.admin.deleteUser(id);
    for (const bucket of ["sale-documents", "avatars"]) {
      for (const prefix of [ORG_A, ORG_B]) {
        const { data } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
        for (const dir of data ?? []) {
          const { data: files } = await admin.storage
            .from(bucket)
            .list(`${prefix}/${dir.name}`, { limit: 100 });
          const paths: string[] = [];
          for (const f of files ?? []) {
            if (f.id) paths.push(`${prefix}/${dir.name}/${f.name}`);
            else {
              const { data: deep } = await admin.storage
                .from(bucket)
                .list(`${prefix}/${dir.name}/${f.name}`, { limit: 100 });
              for (const d of deep ?? []) paths.push(`${prefix}/${dir.name}/${f.name}/${d.name}`);
            }
          }
          if (paths.length) await admin.storage.from(bucket).remove(paths);
        }
      }
    }
  }, 60_000);

  // ---------------- Auth ----------------
  it("auth: createUser pelo servidor nasce na agência de quem cadastra (app_metadata)", async () => {
    const adminA = await actorOf(ids.a_admin);
    expect(adminA.orgId).toBe(ORG_A);
    assertCreateAllowed(adminA, "corretor");
    const u = await makeUser("a_cor_new", adminA.orgId as string, "corretor", "A Corretor Novo");
    const { data: prof } = await admin
      .from("profiles")
      .select("organization_id, ativo")
      .eq("id", u.id)
      .single();
    expect(prof).toEqual({ organization_id: ORG_A, ativo: true });
    const { data: mem } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", u.id)
      .single();
    expect((mem as { organization_id: string }).organization_id).toBe(ORG_A);
    expect((await actorOf(ids.b_admin)).orgId).toBe(ORG_B);
  });

  it("auth: fronteira de cadastro — gestor só corretor; admin não cria admin", async () => {
    const gestorA = await actorOf(ids.a_gestor);
    expect(() => assertCreateAllowed(gestorA, "corretor")).not.toThrow();
    expect(() => assertCreateAllowed(gestorA, "admin")).toThrow(OrgScopeError);
    const adminA = await actorOf(ids.a_admin);
    expect(() => assertCreateAllowed(adminA, "admin")).toThrow(OrgScopeError);
  });

  it("auth: updateUserById (e-mail) só após a regra; admin A não edita usuário de B", async () => {
    const a = admin as unknown as OrgAdminClient;
    const adminA = await actorOf(ids.a_admin);
    await expect(assertUserActionAllowed(a, adminA, "edit_user", ids.b_cor)).rejects.toThrow(
      "não encontrado",
    );
    await assertUserActionAllowed(a, adminA, "edit_user", ids.a_cor_new);
    const newEmail = `h2a-${RUN}-a_cor_new2@example.test`;
    const upd = await admin.auth.admin.updateUserById(ids.a_cor_new, {
      email: newEmail,
      email_confirm: true,
    });
    expect(upd.error).toBeNull();
    const prof = await admin
      .from("profiles")
      .update({ email: newEmail, nome: "A Corretor Editado" })
      .eq("organization_id", ORG_A)
      .eq("id", ids.a_cor_new)
      .select("id");
    expect((prof.data ?? []).length).toBe(1);
    const { data: got } = await admin.auth.admin.getUserById(ids.a_cor_new);
    expect(got.user?.email).toBe(newEmail);
  });

  it("auth: desativar pelo servidor; gestor não desativa corretor fora da equipe", async () => {
    const a = admin as unknown as OrgAdminClient;
    await expect(
      assertUserActionAllowed(a, await actorOf(ids.a_gestor), "set_active", ids.a_cor_new),
    ).rejects.toBeInstanceOf(OrgScopeError);
    await expect(
      assertUserActionAllowed(a, await actorOf(ids.b_admin), "set_active", ids.a_cor_new),
    ).rejects.toThrow("não encontrado");
    await assertUserActionAllowed(a, await actorOf(ids.a_admin), "set_active", ids.a_cor_new);
    const off = await admin
      .from("profiles")
      .update({ ativo: false })
      .eq("organization_id", ORG_A)
      .eq("id", ids.a_cor_new)
      .select("id");
    expect(off.error).toBeNull();
    expect((off.data ?? []).length).toBe(1);
  });

  it("auth + banco: JWT real — cada agência só enxerga os próprios perfis; admin A não desativa B", async () => {
    const ca = await signIn("a_admin");
    const cb = await signIn("b_admin");
    const { data: pa } = await ca.from("profiles").select("id, organization_id");
    const { data: pb } = await cb.from("profiles").select("id, organization_id");
    expect((pa ?? []).length).toBeGreaterThan(0);
    expect((pb ?? []).length).toBeGreaterThan(0);
    expect((pa ?? []).every((p: { organization_id: string }) => p.organization_id === ORG_A)).toBe(
      true,
    );
    expect((pb ?? []).every((p: { organization_id: string }) => p.organization_id === ORG_B)).toBe(
      true,
    );
    const hit = await ca.from("profiles").update({ ativo: false }).eq("id", ids.b_cor).select("id");
    expect((hit.data ?? []).length).toBe(0);
    const move = await ca
      .from("organization_members")
      .update({ organization_id: ORG_B })
      .eq("user_id", ids.a_gestor)
      .select();
    expect(move.error !== null || (move.data ?? []).length === 0).toBe(true);
    const org = await cb.rpc("platform_create_organization", { _slug: `x-${RUN}`, _nome: "X" });
    expect(org.error).not.toBeNull();
  });

  it("postgrest: embed document_extractions → sale_documents com FK nomeada (sem PGRST201)", async () => {
    const ambiguous = await admin
      .from("document_extractions")
      .select("id, sale_documents(tipo)")
      .limit(1);
    expect(ambiguous.error?.code).toBe("PGRST201");
    const hinted = await admin
      .from("document_extractions")
      .select("id, sale_documents!document_extractions_document_id_fkey(tipo, parte)")
      .limit(1);
    expect(hinted.error).toBeNull();
  });

  // ---------------- Storage ----------------
  it("storage: documentos de venda A↔B pela API real", async () => {
    const saleA = crypto.randomUUID();
    const saleB = crypto.randomUUID();
    for (const [id, org, cor] of [
      [saleA, ORG_A, ids.a_admin],
      [saleB, ORG_B, ids.b_cor],
    ]) {
      const r = await admin
        .from("sales")
        .insert({ id, organization_id: org, corretor_id: cor, imovel_id: `H2A-${RUN}` });
      if (r.error) throw new Error(r.error.message);
    }
    const ca = await signIn("a_admin");
    const cb = await signIn("b_admin");
    const pdf = new Blob(["%PDF-1.4 ficticio"], { type: "application/pdf" });
    const pathA = `${ORG_A}/${saleA}/outros/a-${RUN}.pdf`;
    const pathB = `${ORG_B}/${saleB}/outros/b-${RUN}.pdf`;

    expect((await ca.storage.from("sale-documents").upload(pathA, pdf)).error).toBeNull();
    expect((await cb.storage.from("sale-documents").upload(pathB, pdf)).error).toBeNull();
    // Escrita cruzada: prefixo da outra agência e venda da outra agência no próprio prefixo.
    expect(
      (await ca.storage.from("sale-documents").upload(`${ORG_B}/${saleB}/outros/x.pdf`, pdf)).error,
    ).not.toBeNull();
    expect(
      (await cb.storage.from("sale-documents").upload(`${ORG_B}/${saleA}/outros/x.pdf`, pdf)).error,
    ).not.toBeNull();
    // Leitura/listagem/URL assinada cruzadas.
    expect((await ca.storage.from("sale-documents").download(pathA)).error).toBeNull();
    expect((await ca.storage.from("sale-documents").download(pathB)).error).not.toBeNull();
    expect((await cb.storage.from("sale-documents").download(pathA)).error).not.toBeNull();
    const listB = await ca.storage.from("sale-documents").list(`${ORG_B}/${saleB}/outros`);
    expect((listB.data ?? []).length).toBe(0);
    expect(
      (await cb.storage.from("sale-documents").createSignedUrl(pathA, 60)).error,
    ).not.toBeNull();
    // Exclusão cruzada não apaga; própria exclusão funciona.
    const cross = await ca.storage.from("sale-documents").remove([pathB]);
    expect(cross.data ?? []).toHaveLength(0);
    expect((await cb.storage.from("sale-documents").download(pathB)).error).toBeNull();
    const own = await cb.storage.from("sale-documents").remove([pathB]);
    expect(own.error).toBeNull();
    expect((own.data ?? []).map((o) => o.name)).toEqual([pathB]);
    const left = await admin.storage.from("sale-documents").list(`${ORG_B}/${saleB}/outros`);
    expect((left.data ?? []).map((o) => o.name)).not.toContain(`b-${RUN}.pdf`);
  });

  it("storage: avatars exigem prefixo da própria agência + próprio usuário", async () => {
    const ca = await signIn("a_admin");
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    expect(
      (await ca.storage.from("avatars").upload(`${ORG_A}/${ids.a_admin}/avatar-${RUN}.png`, png))
        .error,
    ).toBeNull();
    expect(
      (await ca.storage.from("avatars").upload(`${ORG_B}/${ids.a_admin}/x.png`, png)).error,
    ).not.toBeNull();
    expect(
      (await ca.storage.from("avatars").upload(`${ids.a_admin}/sem-prefixo.png`, png)).error,
    ).not.toBeNull();
    const cb = await signIn("b_admin");
    const listA = await cb.storage.from("avatars").list(`${ORG_A}/${ids.a_admin}`);
    expect((listA.data ?? []).length).toBe(0);
  });
});
