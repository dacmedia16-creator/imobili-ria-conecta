/**
 * Convite de autocadastro (t_6e4dab96) — Supabase de HOMOLOGAÇÃO real (adm-max-homolog).
 * Usa as MESMAS funções do servidor (org-invites.server.ts) e as funções org_invite_* do banco.
 * Não envia e-mail (envio injetado e falso). Só dados fictícios (@example.test). Limpa tudo o que criou.
 * Roda apenas com MT2A_HOMOLOG_ENV apontando para o arquivo protegido; recusa outro projeto.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newInviteToken, sha256Hex, type SelfSignupForm } from "./org-invites";
import {
  acceptInvite,
  cancelInvite,
  createInvite,
  listInvites,
  readClaim,
  resendInvite,
} from "./org-invites.server";
import { reservarConvite } from "../../supabase/functions/conta-max-bridge/convite";

const HOMOLOG_REF = "qvhyepwduhlgqwpgmpvh";
const env: Record<string, string> = {};
const ENV_FILE = process.env.MT2A_HOMOLOG_ENV ?? "";
if (ENV_FILE && existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const URL_ = env.HOMOLOG_URL ?? "";
const ENABLED =
  env.HOMOLOG_REF === HOMOLOG_REF &&
  URL_ === `https://${HOMOLOG_REF}.supabase.co` &&
  Boolean(env.HOMOLOG_SERVICE_ROLE_KEY);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const mail = (n: string) => `convite-${n}-${RUN}@example.test`;

function cnpj(seed: number): string {
  const base = ((Date.now() + seed) % 1e12).toString().padStart(12, "0");
  const dv = (d: string, w: number[]) => {
    const r = w.reduce((a, x, i) => a + Number(d[i]) * x, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${dv(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

const form = (seed: number): SelfSignupForm => ({
  nome: `Imob Convite ${RUN} ${seed}`,
  razaoSocial: "",
  cnpj: cnpj(seed),
  creci: "",
  cidade: "Sorocaba",
  uf: "SP",
  corPrimaria: "",
  corSecundaria: "",
  donoNome: "Dono Ficticio Teste",
  donoTelefone: "15999990000",
});

const fakeSend = async () => ({ ok: true });

describe.skipIf(!ENABLED)("convite de autocadastro — homologação real", () => {
  let admin: SupabaseClient;
  let actor: string;
  const orgs: string[] = [];
  const users: string[] = [];

  async function claimFor(email: string, sub = `sub-${RUN}-${Math.random()}`) {
    const created = await createInvite(admin, actor, { email, appUrl: "https://x" }, async (i) => {
      // O token real vai só no link; aqui o teste o captura do envio falso.
      expect(i.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      captured = i.token;
      return { ok: true };
    });
    const r = await reservarConvite(admin, { inviteToken: captured, email, sub });
    return { created, r, token: captured };
  }
  let captured = "";

  beforeAll(async () => {
    admin = createClient(URL_, env.HOMOLOG_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await admin.from("platform_admins").select("user_id").limit(1).single();
    actor = (data as { user_id: string }).user_id;
  });

  afterAll(async () => {
    if (!ENABLED) return;
    for (const u of users) await admin.auth.admin.deleteUser(u);
    await admin.from("organization_invites").delete().like("email", `%-${RUN}@example.test`);
    for (const o of orgs) await admin.from("organizations").delete().eq("id", o);
  });

  it("caminho feliz: e-mail certo → reserva → cadastro → imobiliária ativa, dono admin, módulos sem Oportunidades", async () => {
    const email = mail("ok");
    const { r } = await claimFor(email);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await readClaim(admin, r.claim)).toEqual({ email });
    const res = await acceptInvite(admin, { claim: r.claim, form: form(1) });
    orgs.push(res.organizationId);
    const { data: org } = await admin
      .from("organizations")
      .select("status, cnpj, cidade, uf")
      .eq("id", res.organizationId)
      .single();
    expect(org).toMatchObject({ status: "ativa", cidade: "Sorocaba", uf: "SP" });
    const { data: prof } = await admin
      .from("profiles")
      .select("id, organization_id, telefone, nome")
      .eq("email", email)
      .single();
    users.push((prof as { id: string }).id);
    expect(prof).toMatchObject({ organization_id: res.organizationId, telefone: "15999990000" });
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", (prof as { id: string }).id);
    expect((roles ?? []).map((x) => x.role)).toEqual(["super_admin"]);
    const { data: mods } = await admin
      .from("organization_modules")
      .select("module, enabled")
      .eq("organization_id", res.organizationId);
    const m = Object.fromEntries((mods ?? []).map((x) => [x.module, x.enabled]));
    expect(m.oportunidades).toBe(false);
    expect(m.captacao_exclusiva && m.reserva_salas && m.feedback_proprietario).toBe(true);
    expect(m.mural_conquistas && m.ranking_valores).toBe(true);
    const { data: link } = await admin
      .from("conta_max_identity_links")
      .select("active")
      .eq("adm_user_id", (prof as { id: string }).id)
      .single();
    expect(link).toMatchObject({ active: true });
    const lista = await listInvites(admin, actor);
    expect(lista.find((i) => i.email === email)?.situacao).toBe("aceito");
  });

  it("conta Google de outro e-mail é recusada", async () => {
    const email = mail("outro");
    await createInvite(admin, actor, { email, appUrl: "https://x" }, async (i) => {
      captured = i.token;
      return { ok: true };
    });
    const r = await reservarConvite(admin, {
      inviteToken: captured,
      email: mail("intruso"),
      sub: "s",
    });
    expect(r).toEqual({ ok: false, status: 403, error: "convite_outro_email" });
    // Maiúsculas não importam:
    const ok = await reservarConvite(admin, { inviteToken: captured, email: email.toUpperCase(), sub: "s2" });
    expect(ok.ok).toBe(true);
  });

  it("aceite duplo concorrente cria UMA imobiliária só", async () => {
    const email = mail("corrida");
    const { r } = await claimFor(email);
    if (!r.ok) throw new Error("reserva falhou");
    const res = await Promise.allSettled([
      acceptInvite(admin, { claim: r.claim, form: form(2) }),
      acceptInvite(admin, { claim: r.claim, form: form(2) }),
    ]);
    const ok = res.filter((x) => x.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const orgId = (ok[0] as PromiseFulfilledResult<{ organizationId: string }>).value.organizationId;
    orgs.push(orgId);
    const { data: prof } = await admin.from("profiles").select("id").eq("email", email).single();
    users.push((prof as { id: string }).id);
    const { count } = await admin
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .like("nome", `Imob Convite ${RUN} 2`);
    expect(count).toBe(1);
  });

  it("token reutilizado (convite já aceito) é recusado", async () => {
    const email = mail("reuso");
    const { r, token } = await claimFor(email);
    if (!r.ok) throw new Error("reserva falhou");
    const res = await acceptInvite(admin, { claim: r.claim, form: form(3) });
    orgs.push(res.organizationId);
    const { data: prof } = await admin.from("profiles").select("id").eq("email", email).single();
    users.push((prof as { id: string }).id);
    expect(await reservarConvite(admin, { inviteToken: token, email, sub: "x" })).toMatchObject({
      ok: false,
      error: "convite_ja_usado",
    });
    await expect(acceptInvite(admin, { claim: r.claim, form: form(3) })).rejects.toThrow(/já foi usado|1 hora/);
  });

  it("convite cancelado e convite substituído (reenviado) deixam de funcionar", async () => {
    const email = mail("cancel");
    const a = await createInvite(admin, actor, { email, appUrl: "https://x" }, async (i) => {
      captured = i.token;
      return { ok: true };
    });
    const tokenA = captured;
    const b = await resendInvite(admin, actor, { inviteId: a.inviteId, appUrl: "https://x" }, async (i) => {
      captured = i.token;
      return { ok: true };
    });
    expect(await reservarConvite(admin, { inviteToken: tokenA, email, sub: "x" })).toMatchObject({
      error: "convite_substituido",
    });
    await cancelInvite(admin, actor, b.inviteId);
    expect(await reservarConvite(admin, { inviteToken: captured, email, sub: "x" })).toMatchObject({
      error: "convite_cancelado",
    });
  });

  it("convite expirado é recusado", async () => {
    const email = mail("expira");
    const token = newInviteToken();
    const { data: id, error } = await admin.rpc("org_invite_create", {
      _email: email,
      _token_hash: await sha256Hex(token),
      _actor: actor,
      _ttl: "1 second",
    });
    expect(error).toBeNull();
    expect(id).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1500));
    expect(await reservarConvite(admin, { inviteToken: token, email, sub: "x" })).toMatchObject({
      error: "convite_expirado",
    });
    const lista = await listInvites(admin, actor);
    expect(lista.find((i) => i.email === email)?.situacao).toBe("expirado");
  });

  it("só o super-admin cria convite; usuário comum não lê a tabela", async () => {
    await expect(
      createInvite(admin, "00000000-0000-4000-8000-00000000dead", { email: mail("x"), appUrl: "https://x" }, fakeSend),
    ).rejects.toThrow(/super-admin/);
    const anon = createClient(URL_, env.HOMOLOG_ANON_KEY, { auth: { persistSession: false } });
    const { data } = await anon.from("organization_invites").select("id").limit(1);
    expect(data ?? []).toHaveLength(0);
    const { error } = await anon.rpc("org_invite_claim", {
      _token_hash: "0".repeat(64),
      _email: "a@b.c",
      _workos_sub: "s",
      _claim_hash: "0".repeat(64),
    });
    expect(error).not.toBeNull();
  });
});
