import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  displayStatus,
  INVITE_TOKEN_RE,
  inviteErrorMessage,
  inviteModules,
  newInviteToken,
  pendingInviteStorage,
  savePendingInvite,
  selfSignupSchema,
  sha256Hex,
  takePendingInvite,
} from "./org-invites";
import { ORGANIZATION_MODULES } from "./platform-organizations";
import { reservarConvite } from "../../supabase/functions/conta-max-bridge/convite";
import { enviarConvite } from "../../supabase/functions/_shared/email-convite/envio";
import { renderEmailConvite } from "../../supabase/functions/_shared/email-convite/render";
import { runContaMaxInvite } from "../routes/conta-max-flow";
import { LOGIN_SO_GOOGLE } from "./login-so-google";

const MIGRATION = readFileSync(
  "supabase/migrations/20261020200000_convite_autocadastro_imobiliaria.sql",
  "utf8",
);

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("token e status do convite", () => {
  it("token tem 32 bytes aleatórios em base64url e o banco guarda só o hash", async () => {
    const a = newInviteToken();
    expect(a).toMatch(INVITE_TOKEN_RE);
    expect(newInviteToken()).not.toBe(a);
    expect(await sha256Hex(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(MIGRATION).toMatch(/token_hash text NOT NULL UNIQUE/);
    expect(MIGRATION).not.toMatch(/\btoken text\b/);
  });

  it("convite enviado vira expirado depois de 7 dias", () => {
    const row = { status: "enviado" as const, expires_at: "2026-10-27T12:00:00Z" };
    expect(displayStatus(row, new Date("2026-10-27T11:59:00Z"))).toBe("enviado");
    expect(displayStatus(row, new Date("2026-10-27T12:00:00Z"))).toBe("expirado");
    expect(displayStatus({ ...row, status: "aceito" }, new Date("2027-01-01"))).toBe("aceito");
  });

  it("token pendente no navegador é uso único e vence em 30 min", () => {
    const s = memStorage();
    const t = newInviteToken();
    savePendingInvite(s, t, 1_000);
    expect(takePendingInvite(s, 2_000)).toBe(t);
    expect(takePendingInvite(s, 2_000)).toBeNull();
    savePendingInvite(s, t, 0);
    expect(takePendingInvite(s, 31 * 60_000)).toBeNull();
  });

  it("token pendente vai para o localStorage (sobrevive à troca de aba do Gmail no celular)", () => {
    const local = memStorage();
    const session = memStorage();
    const w = { localStorage: local, sessionStorage: session } as unknown as {
      localStorage: Storage;
      sessionStorage: Storage;
    };
    const t = newInviteToken();
    // aba 1 (navegador interno do Gmail) guarda
    savePendingInvite(pendingInviteStorage(w), t, 1_000);
    expect(session.getItem("adm_max_convite_token")).toBeNull();
    // aba 2 (volta do login) lê no mesmo localStorage, dentro dos 30 min, uma vez só
    expect(takePendingInvite(pendingInviteStorage(w), 29 * 60_000)).toBe(t);
    expect(local.getItem("adm_max_convite_token")).toBeNull();
    // passado 30 min, mesmo no localStorage, não vale e é apagado
    savePendingInvite(pendingInviteStorage(w), t, 0);
    expect(takePendingInvite(pendingInviteStorage(w), 30 * 60_000 + 1)).toBeNull();
    expect(local.getItem("adm_max_convite_token")).toBeNull();
    // localStorage bloqueado: cai para a aba
    const bloqueado = {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
      sessionStorage: session as unknown as Storage,
    };
    savePendingInvite(pendingInviteStorage(bloqueado), t, 1_000);
    expect(takePendingInvite(session, 2_000)).toBe(t);
  });

  it("as telas usam o localStorage para o token pendente", () => {
    for (const f of ["src/routes/convite.$token.tsx", "src/routes/conta-max.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/PendingInvite\(pendingInviteStorage\(window\)/);
      expect(src).not.toMatch(/PendingInvite\(window\.sessionStorage/);
    }
  });

  it("mensagens claras para link inválido, expirado, usado, cancelado e conta errada", () => {
    expect(inviteErrorMessage("convite_outro_email", "x")).toMatch(/outro e-mail/);
    expect(inviteErrorMessage("convite_expirado", "x")).toMatch(/expirou/);
    expect(inviteErrorMessage("convite_ja_usado", "x")).toMatch(/já foi usado/);
    expect(inviteErrorMessage("convite_cancelado", "x")).toMatch(/cancelado/);
    expect(inviteErrorMessage('duplicate key "organizations_cnpj_unique"', "x")).toMatch(/CNPJ/);
    expect(inviteErrorMessage("qualquer outra coisa", "padrão")).toBe("padrão");
  });
});

describe("módulos da imobiliária criada pelo convite", () => {
  it("todos ligados, exceto Oportunidades e Leads (piloto)", () => {
    const m = inviteModules();
    expect(m.oportunidades).toBe(false);
    expect(m.leads).toBe(false);
    for (const k of ORGANIZATION_MODULES.filter((x) => x !== "oportunidades" && x !== "leads"))
      expect(m[k]).toBe(true);
  });

  it("a migration liga exatamente a mesma lista de módulos do sistema", () => {
    const lista = MIGRATION.match(/FOREACH _m IN ARRAY ARRAY\[([^\]]+)\]/)?.[1] ?? "";
    const mods = [...lista.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    // "leads" (t_2472761a) é posterior ao convite: sem linha no organization_modules = desligado.
    expect(mods).toEqual([...ORGANIZATION_MODULES].filter((x) => x !== "leads").sort());
    expect(MIGRATION).toMatch(/_m <> 'oportunidades'/);
  });
});

describe("migration: segurança", () => {
  it("RLS ligada, leitura só para super-admin e funções só para o servidor", () => {
    expect(MIGRATION).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON public\.organization_invites FROM PUBLIC, anon, authenticated/,
    );
    expect(MIGRATION).toMatch(/USING \(\(SELECT public\.is_platform_super_admin\(\)\)\)/);
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
    const fns = [...MIGRATION.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)/g)].map(
      (x) => x[1],
    );
    for (const f of fns) expect(MIGRATION).toContain(`'${f}(`);
  });

  it("aceite trava a linha do convite (FOR UPDATE) e só aceita status enviado", () => {
    const accept = MIGRATION.slice(MIGRATION.indexOf("FUNCTION public.org_invite_accept("));
    expect(accept).toMatch(/WHERE claim_hash = _claim_hash FOR UPDATE/);
    expect(accept).toMatch(/IF _row\.status = 'aceito' THEN RAISE EXCEPTION 'convite_ja_usado'/);
    expect(accept).toMatch(/'ativa'/);
  });
});

describe("cadastro do dono", () => {
  const ok = {
    nome: "Imobiliária Exemplo",
    razaoSocial: "",
    cnpj: "11.222.333/0001-81",
    creci: "",
    cidade: "Sorocaba",
    uf: "sp",
    corPrimaria: "",
    corSecundaria: "",
    donoNome: "Maria Exemplo",
    donoTelefone: "(15) 99999-0000",
  };
  it("aceita dados completos e exige CNPJ válido, cidade/UF e nome completo", () => {
    expect(selfSignupSchema.parse(ok).uf).toBe("SP");
    expect(selfSignupSchema.safeParse({ ...ok, cnpj: "11.111.111/1111-11" }).success).toBe(false);
    expect(selfSignupSchema.safeParse({ ...ok, donoNome: "Maria" }).success).toBe(false);
    expect(selfSignupSchema.safeParse({ ...ok, uf: "S" }).success).toBe(false);
    expect(selfSignupSchema.safeParse({ ...ok, donoTelefone: "123" }).success).toBe(false);
  });
  it("não tem campo de senha", () => {
    expect(Object.keys(selfSignupSchema.shape)).not.toContain("senha");
  });
});

describe("ponte Conta MAX: conferência do e-mail Google", () => {
  function fakeAdmin(invite: { email: string; tokenHash: string }) {
    const calls: Array<Record<string, unknown>> = [];
    return {
      calls,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, ...args });
        if (fn !== "org_invite_claim") throw new Error("rpc inesperada");
        if (args._token_hash !== invite.tokenHash)
          return { data: null, error: { message: "convite_invalido" } };
        if (String(args._email).trim().toLowerCase() !== invite.email)
          return { data: null, error: { message: "convite_outro_email" } };
        return { data: invite.email, error: null };
      },
    };
  }

  it("e-mail igual (sem diferença de maiúsculas) recebe reserva; banco recebe só hashes", async () => {
    const token = newInviteToken();
    const admin = fakeAdmin({ email: "dono@exemplo.com", tokenHash: await sha256Hex(token) });
    const r = await reservarConvite(admin, {
      inviteToken: token,
      email: "Dono@Exemplo.com",
      sub: "user_1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.claim).toMatch(INVITE_TOKEN_RE);
    expect(admin.calls[0]._claim_hash).toBe(await sha256Hex(r.claim));
    expect(JSON.stringify(admin.calls)).not.toContain(token);
  });

  it("conta Google de outro e-mail é recusada com código claro", async () => {
    const token = newInviteToken();
    const admin = fakeAdmin({ email: "dono@exemplo.com", tokenHash: await sha256Hex(token) });
    expect(
      await reservarConvite(admin, { inviteToken: token, email: "outra@exemplo.com", sub: "u" }),
    ).toEqual({ ok: false, status: 403, error: "convite_outro_email" });
  });

  it("token malformado nem chega ao banco", async () => {
    const admin = fakeAdmin({ email: "a@b.com", tokenHash: "x" });
    expect(
      await reservarConvite(admin, { inviteToken: "abc", email: "a@b.com", sub: "u" }),
    ).toEqual({ ok: false, status: 400, error: "convite_invalido" });
    expect(admin.calls).toHaveLength(0);
  });

  it("a tela de volta repassa o código de erro da ponte", async () => {
    const r = await runContaMaxInvite({
      ticket: "t",
      inviteToken: newInviteToken(),
      invoke: async () => ({
        data: null,
        error: { context: { status: 403, json: async () => ({ error: "convite_outro_email" }) } },
      }),
    });
    expect(r).toEqual({ ok: false, code: "convite_outro_email" });
    expect(
      await runContaMaxInvite({
        ticket: null,
        inviteToken: "x",
        invoke: async () => ({ data: null, error: null }),
      }),
    ).toEqual({ ok: false, code: "invalid_ticket" });
  });
});

describe("e-mail do convite (mesmo SMTP das boas-vindas)", () => {
  it("texto em pt-BR, marca UniHub, link do app e validade", () => {
    const r = renderEmailConvite({
      link: "https://app.somosmaxhub.com.br/convite/abc",
      expiraEm: new Date("2026-10-27T15:00:00Z"),
      email: "dono@exemplo.com",
    });
    expect(r.subject).toMatch(/ADM MAX/);
    expect(r.html).toMatch(/Uni<span[^>]*>Hub/);
    expect(r.text).toContain("https://app.somosmaxhub.com.br/convite/abc");
    expect(r.text).toMatch(/27\/10\/2026/);
    expect(r.text).toMatch(/uma única vez/);
  });

  async function cenario(over: Partial<{ status: string; expires_at: string; hash: string }> = {}) {
    const token = newInviteToken();
    const marcas: Array<[boolean, string | undefined]> = [];
    const enviados: Array<{ to: string; from: string; text: string }> = [];
    const r = await enviarConvite(
      {
        dados: async () => ({
          email: "dono@exemplo.com",
          token_hash: over.hash ?? (await sha256Hex(token)),
          status: over.status ?? "enviado",
          expires_at: over.expires_at ?? "2099-01-01T00:00:00Z",
        }),
        marcar: async (_id, ok, erro) => void marcas.push([ok, erro]),
      },
      async (m) => {
        enviados.push(m);
        return "id";
      },
      {
        inviteId: "11111111-1111-4111-8111-111111111111",
        token,
        appUrl: "https://app.somosmaxhub.com.br",
      },
      { from: '"UniHub" <no-reply@somosmaxhub.com.br>', dominio: "somosmaxhub.com.br" },
      () => "erro",
    );
    return { r, marcas, enviados, token };
  }

  it("envia só para o e-mail gravado no convite, pelo no-reply", async () => {
    const { r, enviados, token } = await cenario();
    expect(r.ok).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe("dono@exemplo.com");
    expect(enviados[0].from).toContain("no-reply@somosmaxhub.com.br");
    expect(enviados[0].text).toContain(`/convite/${token}`);
  });

  it("não envia com token trocado, convite cancelado ou expirado", async () => {
    expect((await cenario({ hash: "0".repeat(64) })).enviados).toHaveLength(0);
    expect((await cenario({ status: "cancelado" })).enviados).toHaveLength(0);
    expect((await cenario({ expires_at: "2000-01-01T00:00:00Z" })).enviados).toHaveLength(0);
  });
});

describe("login atual intacto", () => {
  it("o login continua só pela Conta MAX (Google) e a tela /auth não mudou de destino", () => {
    expect(LOGIN_SO_GOOGLE).toBe(true);
    const auth = readFileSync("src/routes/auth.tsx", "utf8");
    expect(auth).toContain("https://conta.somosmaxhub.com.br/login?app=adm-max");
    expect(auth).not.toMatch(/signInWithOAuth/);
  });
  it("a ponte só desvia para o convite quando o pedido traz invite_token", () => {
    const idx = readFileSync("supabase/functions/conta-max-bridge/index.ts", "utf8");
    expect(idx).toMatch(
      /if \(invite_token !== undefined && invite_token !== null && invite_token !== ""\)/,
    );
    expect(idx).toMatch(/resolveBridgeLink\(admin, String\(payload\.sub\), payload\.email\)/);
  });
});
