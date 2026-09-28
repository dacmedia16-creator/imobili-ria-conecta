/**
 * Fase 2b (multiempresa) — E2E no Supabase de HOMOLOGAÇÃO real (adm-max-homolog).
 *
 * Cadastro de imobiliárias pela plataforma (RPCs platform_* com JWT real + Auth/Storage pelo
 * servidor) e último acesso por agência (sem paginar auth.users global). Só dados fictícios
 * (@example.test). Roda apenas com MT2A_HOMOLOG_ENV apontando para o arquivo protegido de chaves;
 * recusa qualquer projeto que não seja o ref de homologação. Nunca imprime chaves nem envia e-mail
 * (convite por generateLink, que só devolve o link).
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listOrgLastSignIns, OrgScopeError, type OrgAdminClient } from "./org-scope";
import {
  createOrganizationFlow,
  inviteOrganizationAdmin,
  LOGO_BUCKET,
  listOrganizations,
  setOrganizationStatus,
  updateOrganizationFlow,
} from "./platform-organizations.server";

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
const REDIRECT = "https://homolog.invalid/redefinir-senha";
/** CNPJ fictício válido e único por execução (evita colisão com sobras de execuções anteriores). */
function cnpjDoRun(): string {
  const base = (Date.now() % 1e12).toString().padStart(12, "0");
  const dv = (d: string, w: number[]) => {
    const r = w.reduce((a, x, i) => a + Number(d[i]) * x, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}
const CNPJ = cnpjDoRun();
// PNG 1×1 transparente.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

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
const createdUsers: string[] = [];
const createdOrgs: string[] = [];
const ids: Record<string, string> = {};
const emailOf = (key: string) => `h2b-${RUN}-${key}@example.test`;

async function makeUser(key: string, org: string, role: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emailOf(key),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { nome: `${key} Ficticio` },
    app_metadata: { organization_id: org },
  });
  if (error || !data.user) throw new Error(`createUser ${key}: ${error?.message}`);
  createdUsers.push(data.user.id);
  ids[key] = data.user.id;
  if (role !== "corretor") {
    await admin.from("user_roles").delete().eq("organization_id", org).eq("user_id", data.user.id);
    const ins = await admin.from("user_roles").insert({ organization_id: org, user_id: data.user.id, role });
    if (ins.error) throw new Error(ins.error.message);
  }
  return data.user.id;
}

async function signIn(key: string) {
  const c = createClient(URL_, env.HOMOLOG_ANON_KEY, opts);
  const { error } = await c.auth.signInWithPassword({ email: emailOf(key), password: PASSWORD });
  if (error) throw new Error(`login ${key}: ${error.message}`);
  return c;
}

describe.skipIf(!ENABLED)("multiempresa 2b — homologação real (imobiliárias + listUsers)", () => {
  beforeAll(async () => {
    admin = createClient(URL_, env.HOMOLOG_SERVICE_ROLE_KEY, opts);
    // Denis fictício: super-admin da PLATAFORMA (não tem papel de agência que conceda isso).
    await makeUser("plataforma", ORG_A, "corretor");
    const pa = await admin.from("platform_admins").insert({ user_id: ids.plataforma });
    if (pa.error) throw new Error(pa.error.message);
    await makeUser("a_admin", ORG_A, "admin");
    await makeUser("a_super", ORG_A, "super_admin");
    await makeUser("b_admin", ORG_B, "admin");
    await makeUser("b_cor", ORG_B, "corretor");
  }, 90_000);

  afterAll(async () => {
    if (!admin) return;
    for (const org of createdOrgs) {
      const { data } = await admin.storage.from(LOGO_BUCKET).list(org, { limit: 100 });
      const paths = (data ?? []).map((f) => `${org}/${f.name}`);
      if (paths.length) await admin.storage.from(LOGO_BUCKET).remove(paths);
    }
    // Usuários primeiro (ON DELETE CASCADE em membros/perfis/papéis), depois as agências fictícias.
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
    for (const org of new Set(createdOrgs)) {
      if ([ORG_A, ORG_B].includes(org)) continue;
      // Trilha de auditoria da agência fictícia (FK activity_logs_org_fk) sai junto; sem isso a
      // agência C sobrava na homologação a cada execução.
      await admin.from("activity_logs").delete().eq("organization_id", org);
      const r = await admin.from("organizations").delete().eq("id", org);
      if (r.error) console.log(`LIMPEZA agência: ${r.error.message}`);
    }
  }, 90_000);

  it("superadmin da plataforma cria a agência C com CNPJ, cores, logo e 1º admin por convite", async () => {
    const denis = await signIn("plataforma");
    const r = await createOrganizationFlow(denis, admin, ids.plataforma, {
      form: {
        nome: `Agência C ${RUN}`,
        slug: `agencia-c-${RUN}`,
        cnpj: CNPJ,
        corPrimaria: "#1a2b3c",
        corSecundaria: "#ffffff",
      },
      logo: { base64: PNG_1X1, contentType: "image/png" },
      firstAdmin: { nome: "Carla Administradora", email: emailOf("c_admin"), role: "super_admin" },
      redirectTo: REDIRECT,
    });
    if (r.organizationId) {
      createdOrgs.push(r.organizationId);
      ids.orgC = r.organizationId;
    }
    const falha = r.steps.find((s) => s.status === "erro");
    if (falha) console.log(`ETAPA_FALHOU ${falha.key}: ${falha.message}`);
    expect(r.steps.map((s) => [s.key, s.status])).toEqual([
      ["organizacao", "ok"],
      ["dados", "ok"],
      ["logo", "ok"],
      ["administrador", "ok"],
      ["convite", "ok"],
    ]);
    expect(r.organizationId).toBeTruthy();
    const orgC = r.organizationId as string;
    createdOrgs.push(orgC);
    ids.orgC = orgC;
    expect(r.inviteLink).toMatch(new RegExp(`^${URL_}/auth/v1/verify\\?token=.+type=recovery`));

    const { data: org } = await admin
      .from("organizations")
      .select("nome, status, cnpj, cor_primaria, cor_secundaria, logo_path, created_by")
      .eq("id", orgC)
      .single();
    expect(org).toMatchObject({
      status: "ativa",
      cnpj: CNPJ,
      cor_primaria: "#1a2b3c",
      cor_secundaria: "#ffffff",
      created_by: ids.plataforma,
    });
    expect(String(org?.logo_path)).toMatch(new RegExp(`^${orgC}/logo-\\d+\\.png$`));
    // Logo público (marca da agência): a URL pública responde sem login.
    const pub = admin.storage.from(LOGO_BUCKET).getPublicUrl(String(org?.logo_path)).data.publicUrl;
    expect((await fetch(pub)).status).toBe(200);

    // 1º admin nasceu na agência C, como super_admin da agência (não da plataforma), sem senha.
    const { data: prof } = await admin
      .from("profiles")
      .select("id, organization_id")
      .eq("email", emailOf("c_admin"))
      .single();
    expect(prof?.organization_id).toBe(orgC);
    createdUsers.push(prof?.id as string);
    ids.c_admin = prof?.id as string;
    const { data: roles } = await admin.from("user_roles").select("role, organization_id").eq("user_id", ids.c_admin);
    expect(roles).toEqual([{ role: "super_admin", organization_id: orgC }]);
    const { data: isPlat } = await admin.from("platform_admins").select("user_id").eq("user_id", ids.c_admin);
    expect(isPlat ?? []).toHaveLength(0);
  });

  it("superadmin edita a agência C, troca o logo e a lista mostra contagens", async () => {
    const denis = await signIn("plataforma");
    const { data: before } = await admin.from("organizations").select("logo_path").eq("id", ids.orgC).single();
    const r = await updateOrganizationFlow(denis, admin, ids.plataforma, {
      organizationId: ids.orgC,
      form: { nome: `Agência C Editada ${RUN}`, slug: `agencia-c-${RUN}`, cnpj: "", corPrimaria: "#000000" },
      logo: { base64: PNG_1X1, contentType: "image/png" },
    });
    expect(r.steps.every((s) => s.status === "ok")).toBe(true);
    const { data: after } = await admin
      .from("organizations")
      .select("nome, cnpj, cor_primaria, logo_path")
      .eq("id", ids.orgC)
      .single();
    expect(after).toMatchObject({ nome: `Agência C Editada ${RUN}`, cnpj: null, cor_primaria: "#000000" });
    expect(after?.logo_path).not.toBe(before?.logo_path);
    const { data: files } = await admin.storage.from(LOGO_BUCKET).list(ids.orgC);
    expect((files ?? []).map((f) => `${ids.orgC}/${f.name}`)).toEqual([after?.logo_path]);

    const list = await listOrganizations(admin, ids.plataforma);
    const c = list.find((o) => o.id === ids.orgC);
    expect(c).toMatchObject({ membros: 1, administradores: 1 });
    expect(c?.logoUrl).toContain(`/${LOGO_BUCKET}/${ids.orgC}/`);
    expect(list.some((o) => o.id === ORG_B)).toBe(true);
  });

  it("CNPJ duplicado aparece como erro claro na etapa e as seguintes ficam puladas", async () => {
    const denis = await signIn("plataforma");
    await updateOrganizationFlow(denis, admin, ids.plataforma, {
      organizationId: ids.orgC,
      form: { nome: `Agência C Editada ${RUN}`, slug: `agencia-c-${RUN}`, cnpj: CNPJ },
    });
    const r = await createOrganizationFlow(denis, admin, ids.plataforma, {
      form: { nome: `Agência D ${RUN}`, slug: `agencia-d-${RUN}`, cnpj: CNPJ },
      logo: { base64: PNG_1X1, contentType: "image/png" },
      redirectTo: REDIRECT,
    });
    if (r.organizationId) createdOrgs.push(r.organizationId);
    expect(r.steps.map((s) => [s.key, s.status])).toEqual([
      ["organizacao", "ok"],
      ["dados", "erro"],
      ["logo", "pulado"],
      ["administrador", "pulado"],
      ["convite", "pulado"],
    ]);
    expect(r.steps[1].message).toMatch(/CNPJ/);
  });

  it("convite de admin para agência existente: novo link sem duplicar; e-mail de outra agência recusado", async () => {
    const again = await inviteOrganizationAdmin(admin, ids.plataforma, {
      organizationId: ids.orgC,
      nome: "Carla Administradora",
      email: emailOf("c_admin"),
      role: "super_admin",
      redirectTo: REDIRECT,
    });
    expect(again.steps.map((s) => [s.key, s.status])).toEqual([
      ["administrador", "pulado"],
      ["convite", "ok"],
    ]);
    expect(again.inviteLink).toBeTruthy();
    await expect(
      inviteOrganizationAdmin(admin, ids.plataforma, {
        organizationId: ids.orgC,
        nome: "B Admin Ficticio",
        email: emailOf("b_admin"),
        role: "admin",
        redirectTo: REDIRECT,
      }),
    ).rejects.toThrow(/outra imobiliária/);
  });

  it("admin (e super_admin) da agência A não vê nem cria/edita/suspende imobiliária", async () => {
    for (const key of ["a_admin", "a_super"]) {
      const c = await signIn(key);
      // Servidor: barra antes de usar o service_role.
      await expect(listOrganizations(admin, ids[key])).rejects.toBeInstanceOf(OrgScopeError);
      await expect(
        createOrganizationFlow(c, admin, ids[key], {
          form: { nome: "Invasora", slug: `invasora-${RUN}` },
          redirectTo: REDIRECT,
        }),
      ).rejects.toBeInstanceOf(OrgScopeError);
      await expect(
        setOrganizationStatus(c, admin, ids[key], ids.orgC, "suspensa"),
      ).rejects.toBeInstanceOf(OrgScopeError);
      // Banco com JWT real: RPCs recusam e a lista só mostra a própria agência.
      expect((await c.rpc("is_platform_super_admin")).data).toBe(false);
      const create = await c.rpc("platform_create_organization", { _slug: `x-${RUN}`, _nome: "X" });
      expect(create.error?.code).toBe("42501");
      const prof = await c.rpc("platform_update_organization_profile", {
        _id: ORG_A,
        _cnpj: CNPJ,
        _cor_primaria: "#000000",
        _cor_secundaria: "",
      });
      expect(prof.error?.code).toBe("42501");
      const upd = await c.rpc("platform_update_organization", { _id: ORG_A, _nome: "Hack", _slug: "" });
      expect(upd.error?.code).toBe("42501");
      const { data: visiveis } = await c.from("organizations").select("id");
      expect((visiveis ?? []).map((o) => o.id)).toEqual([ORG_A]);
      const direct = await c.from("organizations").update({ nome: "Hack" }).eq("id", ORG_A).select("id");
      expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true);
      // Logo: sem policy de escrita para usuário no bucket da plataforma.
      const up = await c.storage
        .from(LOGO_BUCKET)
        .upload(`${ORG_A}/x-${RUN}.png`, new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
      expect(up.error).not.toBeNull();
    }
    const { data: nome } = await admin.from("organizations").select("nome").eq("id", ORG_A).single();
    expect(nome?.nome).not.toBe("Hack");
  });

  it("suspender pela plataforma bloqueia o acesso da agência; reativar devolve; legada não suspende", async () => {
    const denis = await signIn("plataforma");
    await setOrganizationStatus(denis, admin, ids.plataforma, ids.orgC, "suspensa");
    expect((await admin.from("organizations").select("status").eq("id", ids.orgC).single()).data?.status).toBe(
      "suspensa",
    );
    // Usuário da agência suspensa fica sem agência ativa (current_org_id nulo → RLS fecha tudo).
    expect((await admin.rpc("user_org", { _user: ids.c_admin })).data).toBeNull();
    await setOrganizationStatus(denis, admin, ids.plataforma, ids.orgC, "ativa");
    expect((await admin.rpc("user_org", { _user: ids.c_admin })).data).toBe(ids.orgC);
    await expect(setOrganizationStatus(denis, admin, ids.plataforma, ORG_A, "suspensa")).rejects.toThrow(
      /original/,
    );
  });

  it("listUsers/último acesso: agência A não traz usuários da B (e vice-versa)", async () => {
    await signIn("a_admin");
    await signIn("b_admin");
    const a = admin as unknown as OrgAdminClient;
    const mapA = await listOrgLastSignIns(a, ORG_A);
    const mapB = await listOrgLastSignIns(a, ORG_B);
    expect(Object.keys(mapA)).toEqual(expect.arrayContaining([ids.a_admin, ids.a_super]));
    for (const id of [ids.b_admin, ids.b_cor, ids.c_admin]) expect(mapA).not.toHaveProperty(id);
    expect(Object.keys(mapB)).toEqual(expect.arrayContaining([ids.b_admin, ids.b_cor]));
    for (const id of [ids.a_admin, ids.a_super]) expect(mapB).not.toHaveProperty(id);
    expect(mapA[ids.a_admin]).not.toBeNull(); // último acesso preenchido pelo login acima
    // Cruzamento com o banco: todos os ids devolvidos são membros da agência pedida.
    const { data: membrosB } = await admin.from("organization_members").select("user_id").eq("organization_id", ORG_B);
    expect(new Set(Object.keys(mapB))).toEqual(new Set((membrosB ?? []).map((m) => m.user_id)));
  });

  it("listUsers: a RPC por agência não responde a usuário comum nem a anônimo", async () => {
    const ca = await signIn("a_admin");
    expect((await ca.rpc("mt_2b_org_auth_users", { _org: ORG_A })).error).not.toBeNull();
    const anon = createClient(URL_, env.HOMOLOG_ANON_KEY, opts);
    expect((await anon.rpc("mt_2b_org_auth_users", { _org: ORG_A })).error).not.toBeNull();
  });

  it("financial-rules: a fonte canônica que substituiu visao_executiva_stats responde ao servidor", async () => {
    expect((await admin.rpc("participacoes_comerciais_validas")).error).toBeNull();
    expect((await admin.rpc("vendas_comerciais_canonicas")).error).toBeNull();
    expect((await admin.rpc("visao_executiva_stats" as never)).error).not.toBeNull();
  });
});
