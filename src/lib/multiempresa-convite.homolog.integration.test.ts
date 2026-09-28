/**
 * E2E de convite (multiempresa) — Supabase de HOMOLOGAÇÃO real (adm-max-homolog).
 *
 * Ciclo completo sem enviar e-mail:
 *  1. super-admin da plataforma cadastra uma agência nova pela MESMA função da tela
 *     /plataforma/imobiliarias (createOrganizationFlow), com 1º administrador;
 *  2. o link de convite devolvido (generateLink, sem envio) é consumido programaticamente como o
 *     navegador faria: /auth/v1/verify → sessão → definir senha (mesmo passo de /redefinir-senha);
 *  3. esse admin cadastra um corretor e um gestor pela MESMA função da tela Usuários
 *     (createAgencyUser); corretor não gerencia equipe; gestor não cria/promove admin;
 *  4. admin/corretor da agência nova não leem nem alteram dados e Storage de A/B.
 *
 * Só dados fictícios (@example.test). Roda apenas com MT2A_HOMOLOG_ENV apontando para o arquivo
 * protegido de chaves; recusa qualquer projeto que não seja o ref de homologação e bloqueia fetch
 * para outro destino. Nunca imprime chaves, links nem tokens. Limpa tudo o que criou.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScopeError, resolveActiveOrg, type OrgAdminClient } from "./org-scope";
import { createOrganizationFlow, listOrganizations } from "./platform-organizations.server";
import { createAgencyUser, setAgencyUserRole } from "./user-management.server";

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
// Sufixo aleatório: com os E2E rodando em paralelo, dois arquivos podem nascer no mesmo ms e a
// limpeza de um (filtrada por RUN) apagaria arquivos do outro.
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = `Homolog-${RUN}-x9!`;
const REDIRECT = "https://homolog.invalid/redefinir-senha";
const IMOVEL = `E2EC-${RUN}`; // prefixo das vendas fictícias deste ensaio
const DOCS = "sale-documents";

function cnpjDoRun(): string {
  const base = ((Date.now() + 7) % 1e12).toString().padStart(12, "0");
  const dv = (d: string, w: number[]) => {
    const r = w.reduce((a, x, i) => a + Number(d[i]) * x, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}

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
const scoped = () => admin as unknown as OrgAdminClient;
const createdUsers: string[] = [];
const createdOrgs: string[] = [];
const uploaded: string[] = [];
const ids: Record<string, string> = {};
const sales: Record<string, string> = {};
const fixtureEmail = (key: string) => `e2ec-${RUN}-${key}@example.test`;
const ADMIN_EMAIL = `admin.teste+${RUN}@example.test`;
const CORRETOR_EMAIL = `corretor.teste+${RUN}@example.test`;
const CORRETOR2_EMAIL = `corretor2.teste+${RUN}@example.test`;
const GESTOR_EMAIL = `gestor.teste+${RUN}@example.test`;

/** Resultado por cenário (só rótulo e passou/falhou, sem dados sensíveis). */
const report: [string, "PASSOU" | "FALHOU"][] = [];
async function scenario(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    report.push([name, "PASSOU"]);
  } catch (e) {
    report.push([name, "FALHOU"]);
    throw e;
  }
}

async function makeFixture(key: string, org: string, role: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: fixtureEmail(key),
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
    const ins = await admin
      .from("user_roles")
      .insert({ organization_id: org, user_id: data.user.id, role });
    if (ins.error) throw new Error(ins.error.message);
  }
}

async function signIn(email: string) {
  const c = createClient(URL_, env.HOMOLOG_ANON_KEY, opts);
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login falhou (${error.message})`);
  return c;
}

async function insertSale(key: string, org: string, corretor: string) {
  const id = crypto.randomUUID();
  const r = await admin
    .from("sales")
    .insert({ id, organization_id: org, corretor_id: corretor, imovel_id: `${IMOVEL}-${key}` });
  if (r.error) throw new Error(`venda ${key}: ${r.error.message}`);
  sales[key] = id;
  return id;
}

async function uploadAs(key: string, org: string, saleId: string) {
  const path = `${org}/${saleId}/outros/${key}-${RUN}.pdf`;
  const up = await admin.storage
    .from(DOCS)
    .upload(path, new Blob(["%PDF-1.4 ficticio"], { type: "application/pdf" }));
  if (up.error) throw new Error(`upload ${key}: ${up.error.message}`);
  uploaded.push(path);
  return path;
}

describe.skipIf(!ENABLED)("multiempresa — convite E2E: nova agência + 1º admin + corretor", () => {
  beforeAll(async () => {
    admin = createClient(URL_, env.HOMOLOG_SERVICE_ROLE_KEY, opts);
    // Super-admin fictício da PLATAFORMA (o papel de Denis), sem papel de agência que conceda isso.
    await makeFixture("plataforma", ORG_A, "corretor");
    const pa = await admin.from("platform_admins").insert({ user_id: ids.plataforma });
    if (pa.error) throw new Error(pa.error.message);
    // Dados-alvo de A e B para os testes negativos (vendas + documento no Storage).
    await makeFixture("a_admin", ORG_A, "admin");
    await makeFixture("b_cor", ORG_B, "corretor");
    await insertSale("A", ORG_A, ids.a_admin);
    await insertSale("B", ORG_B, ids.b_cor);
    ids.pathA = await uploadAs("a", ORG_A, sales.A);
    ids.pathB = await uploadAs("b", ORG_B, sales.B);
  }, 90_000);

  afterAll(async () => {
    if (!admin) return;
    if (uploaded.length) await admin.storage.from(DOCS).remove(uploaded);
    const del = await admin.from("sales").delete().like("imovel_id", `${IMOVEL}-%`);
    if (del.error) console.log(`LIMPEZA vendas: ${del.error.message}`);
    for (const id of createdUsers) {
      const r = await admin.auth.admin.deleteUser(id);
      if (r.error) console.log(`LIMPEZA usuário: ${r.error.message}`);
    }
    // Agências deste ensaio (inclusive sobras de execução interrompida, pelo slug exclusivo do E2E).
    const { data: sobras } = await admin
      .from("organizations")
      .select("id")
      .like("slug", "agencia-teste-convite-e2e-%");
    for (const o of sobras ?? []) if (!createdOrgs.includes(o.id)) createdOrgs.push(o.id);
    for (const org of createdOrgs) {
      if ([ORG_A, ORG_B].includes(org)) continue;
      // Trilha de auditoria da agência fictícia (FK activity_logs_org_fk) sai junto com ela.
      await admin.from("activity_logs").delete().eq("organization_id", org);
      const r = await admin.from("organizations").delete().eq("id", org);
      if (r.error) console.log(`LIMPEZA agência: ${r.error.message}`);
    }
    console.log(["RESULTADO E2E CONVITE", ...report.map(([n, s]) => `  [${s}] ${n}`)].join("\n"));
  }, 90_000);

  it("1. super-admin da plataforma cadastra a agência nova pela função da tela", () =>
    scenario("1. cadastro da agência nova pela plataforma", async () => {
      const denis = await signIn(fixtureEmail("plataforma"));
      const r = await createOrganizationFlow(denis, admin, ids.plataforma, {
        form: {
          nome: `Agência Teste Convite (fictícia) ${RUN}`,
          slug: `agencia-teste-convite-e2e-${RUN}`,
          cnpj: cnpjDoRun(),
        },
        firstAdmin: { nome: "Admin Teste", email: ADMIN_EMAIL, role: "super_admin" },
        redirectTo: REDIRECT,
      });
      if (r.organizationId) createdOrgs.push(r.organizationId);
      const falha = r.steps.find((s) => s.status === "erro");
      if (falha) console.log(`ETAPA_FALHOU ${falha.key}: ${falha.message}`);
      expect(r.steps.map((s) => [s.key, s.status])).toEqual([
        ["organizacao", "ok"],
        ["dados", "ok"],
        ["logo", "pulado"],
        ["administrador", "ok"],
        ["convite", "ok"],
      ]);
      // A tela avisa que nenhum e-mail foi enviado; o link volta para ser copiado.
      expect(r.steps[4].message).toMatch(/Nenhum e-mail foi enviado/);
      expect(r.inviteLink).toBeTruthy();
      ids.orgC = r.organizationId as string;
      ids.invite = r.inviteLink as string;
      expect([ORG_A, ORG_B]).not.toContain(ids.orgC);
      const { data: org } = await admin
        .from("organizations")
        .select("status, legacy_default, created_by")
        .eq("id", ids.orgC)
        .single();
      expect(org).toMatchObject({
        status: "ativa",
        legacy_default: false,
        created_by: ids.plataforma,
      });
    }));

  it("2. 1º admin aceita o convite pelo link (sem e-mail), define senha e fica só na agência nova", () =>
    scenario("2. convite consumido; vínculo e papel na agência nova; sem /plataforma", async () => {
      expect(ids.invite).toBeTruthy();
      // Navegador abre o link: /auth/v1/verify responde com redirect contendo a sessão no hash.
      const res = await guardFetch(ids.invite, { redirect: "manual" });
      expect([301, 302, 303, 307]).toContain(res.status);
      const hash = new URLSearchParams((res.headers.get("location") ?? "").split("#")[1] ?? "");
      expect(hash.get("error")).toBeNull();
      expect(hash.get("type")).toBe("recovery");
      const c = createClient(URL_, env.HOMOLOG_ANON_KEY, opts);
      const set = await c.auth.setSession({
        access_token: hash.get("access_token") ?? "",
        refresh_token: hash.get("refresh_token") ?? "",
      });
      expect(set.error).toBeNull();
      ids.c_admin = set.data.user?.id as string;
      createdUsers.push(ids.c_admin);
      expect(set.data.user?.email).toBe(ADMIN_EMAIL);
      // Mesmo passo da tela /redefinir-senha.
      expect((await c.auth.updateUser({ password: PASSWORD })).error).toBeNull();
      // Link é de uso único.
      const again = await guardFetch(ids.invite, { redirect: "manual" });
      const loc2 = again.headers.get("location") ?? "";
      expect(loc2.includes("access_token=")).toBe(false);

      // Login normal com a senha definida.
      const ca = await signIn(ADMIN_EMAIL);
      expect(await resolveActiveOrg(scoped(), ids.c_admin)).toBe(ids.orgC);
      const { data: mem } = await admin
        .from("organization_members")
        .select("organization_id, ativo")
        .eq("user_id", ids.c_admin);
      expect(mem).toEqual([{ organization_id: ids.orgC, ativo: true }]);
      const { data: roles } = await admin
        .from("user_roles")
        .select("role, organization_id")
        .eq("user_id", ids.c_admin);
      expect(roles).toEqual([{ role: "super_admin", organization_id: ids.orgC }]);
      const { data: plat } = await admin
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", ids.c_admin);
      expect(plat ?? []).toHaveLength(0);
      // Não vê /plataforma/imobiliarias: guarda da rota e menu usam is_platform_super_admin.
      expect((await ca.rpc("is_platform_super_admin")).data).toBe(false);
      await expect(listOrganizations(admin, ids.c_admin)).rejects.toBeInstanceOf(OrgScopeError);
      const { data: vis } = await ca.from("organizations").select("id");
      expect((vis ?? []).map((o) => o.id)).toEqual([ids.orgC]);
    }));

  it("3a. admin da agência nova cadastra corretor, 2º corretor e gestor na própria agência", () =>
    scenario("3a. admin cadastra corretor/gestor na própria agência", async () => {
      const base = { telefone: "15999990000", password: PASSWORD };
      const cor = await createAgencyUser(scoped(), ids.c_admin, {
        ...base,
        nome: "Corretor Teste",
        email: CORRETOR_EMAIL,
        role: "corretor",
      });
      createdUsers.push(cor.id);
      ids.c_cor = cor.id;
      const cor2 = await createAgencyUser(scoped(), ids.c_admin, {
        ...base,
        nome: "Corretora Dois",
        email: CORRETOR2_EMAIL,
        role: "corretor",
      });
      createdUsers.push(cor2.id);
      ids.c_cor2 = cor2.id;
      const ges = await createAgencyUser(scoped(), ids.c_admin, {
        ...base,
        nome: "Gestor Teste",
        email: GESTOR_EMAIL,
        role: "gestor",
      });
      createdUsers.push(ges.id);
      ids.c_gestor = ges.id;
      for (const [id, role] of [
        [ids.c_cor, "corretor"],
        [ids.c_cor2, "corretor"],
        [ids.c_gestor, "gestor"],
      ]) {
        const { data: prof } = await admin
          .from("profiles")
          .select("organization_id, ativo")
          .eq("id", id)
          .single();
        expect(prof).toEqual({ organization_id: ids.orgC, ativo: true });
        const { data: r } = await admin
          .from("user_roles")
          .select("role, organization_id")
          .eq("user_id", id);
        expect(r).toEqual([{ role, organization_id: ids.orgC }]);
      }
      // Vendas fictícias da agência nova: uma do corretor, outra da 2ª corretora.
      await insertSale("C1", ids.orgC, ids.c_cor);
      await insertSale("C2", ids.orgC, ids.c_cor2);
    }));

  it("3b. corretor vê só as próprias vendas e só a própria agência; não gerencia equipe", () =>
    scenario("3b. corretor restrito às próprias vendas; sem gestão de equipe", async () => {
      const cc = await signIn(CORRETOR_EMAIL);
      const { data: s } = await cc.from("sales").select("id, organization_id");
      expect((s ?? []).map((x) => x.id).sort()).toEqual([sales.C1]);
      const { data: orgs } = await cc.from("organizations").select("id");
      expect((orgs ?? []).map((o) => o.id)).toEqual([ids.orgC]);
      const { data: profs } = await cc.from("profiles").select("organization_id");
      expect((profs ?? []).every((p) => p.organization_id === ids.orgC)).toBe(true);
      expect((await cc.rpc("is_platform_super_admin")).data).toBe(false);
      // Servidor: cadastro e troca de papel recusados antes do service_role.
      await expect(
        createAgencyUser(scoped(), ids.c_cor, {
          nome: "Invasor Teste",
          email: fixtureEmail("invasor"),
          telefone: "15999990000",
          password: PASSWORD,
          role: "corretor",
        }),
      ).rejects.toBeInstanceOf(OrgScopeError);
      await expect(
        setAgencyUserRole(scoped(), ids.c_cor, { userId: ids.c_cor2, role: "gestor", grant: true }),
      ).rejects.toBeInstanceOf(OrgScopeError);
      // Banco com JWT real: não grava papel, não desativa colega.
      const ins = await cc
        .from("user_roles")
        .insert({ organization_id: ids.orgC, user_id: ids.c_cor, role: "admin" })
        .select();
      expect(ins.error !== null || (ins.data ?? []).length === 0).toBe(true);
      const off = await cc
        .from("profiles")
        .update({ ativo: false })
        .eq("id", ids.c_cor2)
        .select("id");
      expect((off.data ?? []).length).toBe(0);
      const { data: r } = await admin.from("user_roles").select("role").eq("user_id", ids.c_cor);
      expect(r).toEqual([{ role: "corretor" }]);
    }));

  it("3c. gestor não cria nem promove administrador (servidor e banco)", () =>
    scenario("3c. gestor não cria/promove admin", async () => {
      for (const role of ["admin", "super_admin"] as const) {
        await expect(
          createAgencyUser(scoped(), ids.c_gestor, {
            nome: "Admin Invasor",
            email: fixtureEmail(`g-${role}`),
            telefone: "15999990000",
            password: PASSWORD,
            role,
          }),
        ).rejects.toBeInstanceOf(OrgScopeError);
        await expect(
          setAgencyUserRole(scoped(), ids.c_gestor, { userId: ids.c_cor, role, grant: true }),
        ).rejects.toBeInstanceOf(OrgScopeError);
        await expect(
          setAgencyUserRole(scoped(), ids.c_gestor, { userId: ids.c_gestor, role, grant: true }),
        ).rejects.toBeInstanceOf(OrgScopeError);
      }
      const cg = await signIn(GESTOR_EMAIL);
      const ins = await cg
        .from("user_roles")
        .insert({ organization_id: ids.orgC, user_id: ids.c_cor, role: "admin" })
        .select();
      expect(ins.error !== null || (ins.data ?? []).length === 0).toBe(true);
      const self = await cg
        .from("user_roles")
        .insert({ organization_id: ids.orgC, user_id: ids.c_gestor, role: "super_admin" })
        .select();
      expect(self.error !== null || (self.data ?? []).length === 0).toBe(true);
      const { data: admins } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("organization_id", ids.orgC)
        .in("role", ["admin", "super_admin"]);
      expect((admins ?? []).map((a) => a.user_id)).toEqual([ids.c_admin]);
      // Nenhum usuário "invasor" chegou a ser criado.
      const { data: inv } = await admin
        .from("profiles")
        .select("id")
        .like("email", `e2ec-${RUN}-g-%`);
      expect(inv ?? []).toHaveLength(0);
    }));

  it("4. admin e corretor da agência nova não leem nem alteram dados e Storage de A/B", () =>
    scenario("4. acesso cruzado negado (dados + Storage A/B)", async () => {
      const pdf = new Blob(["%PDF-1.4 ficticio"], { type: "application/pdf" });
      for (const email of [ADMIN_EMAIL, CORRETOR_EMAIL]) {
        const c = await signIn(email);
        // Dados: vendas, perfis e agência de A/B invisíveis; escrita não afeta nada.
        for (const [org, saleId] of [
          [ORG_A, sales.A],
          [ORG_B, sales.B],
        ]) {
          const r = await c.from("sales").select("id").eq("id", saleId);
          expect(r.data ?? []).toHaveLength(0);
          expect(
            (await c.from("sales").select("id").eq("organization_id", org)).data ?? [],
          ).toHaveLength(0);
          expect(
            (await c.from("profiles").select("id").eq("organization_id", org)).data ?? [],
          ).toHaveLength(0);
          expect(
            (await c.from("organizations").select("id").eq("id", org)).data ?? [],
          ).toHaveLength(0);
          const upd = await c
            .from("sales")
            .update({ imovel_id: "HACK" })
            .eq("id", saleId)
            .select("id");
          expect((upd.data ?? []).length).toBe(0);
          const del = await c.from("sales").delete().eq("id", saleId).select("id");
          expect((del.data ?? []).length).toBe(0);
          const forged = await c
            .from("sales")
            .insert({
              organization_id: org,
              corretor_id: ids.c_cor,
              imovel_id: `${IMOVEL}-forjada`,
            })
            .select("id, organization_id");
          // Banco recusa (admin: venda de outro corretor → 42501) ou IGNORA o organization_id
          // informado e grava na agência de quem insere (gatilho de escopo). Nunca em A/B.
          for (const row of forged.data ?? []) expect(row.organization_id).toBe(ids.orgC);
        }
        const orgUpd = await c
          .from("organizations")
          .update({ nome: "Hack" })
          .eq("id", ORG_B)
          .select("id");
        expect(orgUpd.error !== null || (orgUpd.data ?? []).length === 0).toBe(true);
        // Storage: sem download, URL assinada, listagem, escrita ou exclusão em A/B.
        for (const [org, saleId, path] of [
          [ORG_A, sales.A, ids.pathA],
          [ORG_B, sales.B, ids.pathB],
        ]) {
          expect((await c.storage.from(DOCS).download(path)).error).not.toBeNull();
          expect((await c.storage.from(DOCS).createSignedUrl(path, 60)).error).not.toBeNull();
          expect(
            (await c.storage.from(DOCS).list(`${org}/${saleId}/outros`)).data ?? [],
          ).toHaveLength(0);
          expect(
            (await c.storage.from(DOCS).upload(`${org}/${saleId}/outros/x-${RUN}.pdf`, pdf)).error,
          ).not.toBeNull();
          // Venda de outra agência no PRÓPRIO prefixo também é recusada.
          expect(
            (await c.storage.from(DOCS).upload(`${ids.orgC}/${saleId}/outros/x-${RUN}.pdf`, pdf))
              .error,
          ).not.toBeNull();
          const rm = await c.storage.from(DOCS).remove([path]);
          expect(rm.data ?? []).toHaveLength(0);
        }
      }
      // Tudo continua intacto (conferido com service_role).
      const { data: still } = await admin
        .from("sales")
        .select("id, imovel_id")
        .in("id", [sales.A, sales.B]);
      expect((still ?? []).map((s) => s.imovel_id).sort()).toEqual([`${IMOVEL}-A`, `${IMOVEL}-B`]);
      expect((await admin.storage.from(DOCS).download(ids.pathA)).error).toBeNull();
      expect((await admin.storage.from(DOCS).download(ids.pathB)).error).toBeNull();
      const { data: forjadas } = await admin
        .from("sales")
        .select("organization_id")
        .eq("imovel_id", `${IMOVEL}-forjada`);
      expect((forjadas ?? []).filter((s) => s.organization_id !== ids.orgC)).toHaveLength(0);
      for (const org of [ORG_A, ORG_B]) {
        const { data: n } = await admin
          .from("sales")
          .select("id")
          .eq("organization_id", org)
          .like("imovel_id", `${IMOVEL}-%`);
        expect(n ?? []).toHaveLength(1); // só a venda-alvo original
      }
      // Controle positivo: o corretor grava documento da PRÓPRIA venda na PRÓPRIA agência.
      const cc = await signIn(CORRETOR_EMAIL);
      const own = `${ids.orgC}/${sales.C1}/outros/own-${RUN}.pdf`;
      const up = await cc.storage.from(DOCS).upload(own, pdf);
      if (!up.error) uploaded.push(own);
      expect(up.error).toBeNull();
      expect((await cc.storage.from(DOCS).download(own)).error).toBeNull();
    }));
});
