// Mock local de Supabase para os prints da tela "Assinatura digital" (t_7508c6b6). Dados 100%
// fictícios (@example.com), nenhuma chamada externa: a edge clicksign-config é simulada aqui e o
// "Testar conexão" NÃO fala com a Clicksign (resposta fictícia). Usuários: super admin e admin.
// Estado em memória, reiniciável em /__mock/reset.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54431);
const ORG = "11111111-1111-4111-8111-111111111111";
const SUPER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const users = {
  "tok-super": {
    id: SUPER,
    email: "super@example.com",
    nome: "Super Admin Fictício",
    role: "super_admin",
  },
  "tok-admin": { id: ADMIN, email: "admin@example.com", nome: "Admin Fictício", role: "admin" },
};
const candidates = [
  {
    id: "c1111111-1111-4111-8111-111111111111",
    nome: "Diretora Fictícia",
    email: "di***@example.com",
    email_ok: true,
  },
  {
    id: "c2222222-2222-4222-8222-222222222222",
    nome: "Gerente Fictício",
    email: "ge***@example.com",
    email_ok: true,
  },
  {
    id: "c3333333-3333-4333-8333-333333333333",
    nome: "Sócia Sem E-mail Fictícia",
    email: "",
    email_ok: false,
  },
];
let st;
const reset = () => {
  st = {
    enabled: false,
    sale_enabled: false,
    test_mode: true,
    allowlist: [],
    deadline_days: 30,
    signer_ids: [],
    token: null,
    token_at: null,
    webhook: null,
    webhook_at: null,
    conn: null,
    conn_at: null,
    audit: [],
  };
};
reset();
const now = () => new Date().toISOString();
const audit = (action, detail) =>
  st.audit.unshift({ action, detail, created_at: now(), actor: "Super Admin Fictício" });
const view = () => ({
  enabled: st.enabled,
  sale_enabled: st.sale_enabled,
  test_mode: st.test_mode,
  allowlist_count: st.allowlist.length,
  deadline_days: st.deadline_days,
  signer_ids: st.signer_ids,
  valid_signers: st.signer_ids.filter((id) => candidates.find((c) => c.id === id)?.email_ok).length,
  token: { configured: !!st.token, set_at: st.token_at },
  webhook: { configured: !!st.webhook, set_at: st.webhook_at, slug: "f".repeat(36) },
  webhook_url: `https://projeto-ficticio.supabase.co/functions/v1/clicksign-webhook/${"f".repeat(36)}`,
  connection: { ok: st.conn, checked_at: st.conn_at },
  candidates,
  audit: st.audit.slice(0, 20),
});

function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "access-control-expose-headers": "content-range",
    ...extra,
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const userFrom = (req) => {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  for (const [k, u] of Object.entries(users)) if (tok.includes(k)) return u;
  return null;
};

function edge(u, b) {
  if (!u || u.role !== "super_admin")
    return [403, { error: "Apenas o super admin da imobiliária configura a assinatura digital" }];
  const ok = (extra = {}) => [200, { ok: true, ...extra, config: view() }];
  switch (b.action) {
    case "view":
      return ok();
    case "save_secret": {
      const v = String(b.value || "").trim();
      if (v.length < 16 || /\s/.test(v))
        return [
          400,
          {
            error:
              "Chave de API inválida: cole a chave inteira, sem espaços (16 a 512 caracteres).",
          },
        ];
      const had = b.kind === "access_token" ? !!st.token : !!st.webhook;
      if (b.kind === "access_token") {
        st.token = "guardado";
        st.token_at = now();
        st.conn = null;
        st.conn_at = null;
      } else {
        st.webhook = "guardado";
        st.webhook_at = now();
      }
      audit(b.kind === "access_token" ? "chave_api" : "segredo_webhook", {
        operacao: had ? "trocou" : "cadastrou",
      });
      return ok();
    }
    case "save": {
      const d = {};
      if (typeof b.test_mode === "boolean") {
        st.test_mode = b.test_mode;
        d.modo_teste = b.test_mode;
      }
      if (Array.isArray(b.signer_ids)) {
        st.signer_ids = b.signer_ids;
        d.assinam_pela_imobiliaria = b.signer_ids.length;
      }
      if (Array.isArray(b.allowlist)) {
        st.allowlist = b.allowlist;
        d.emails_teste = b.allowlist.length;
      }
      if (typeof b.deadline_days === "number") {
        st.deadline_days = b.deadline_days;
        d.prazo_dias = b.deadline_days;
      }
      audit("configuracao", d);
      return ok();
    }
    case "test": {
      if (!st.token) return [400, { error: "Salve a chave de API antes de testar a conexão." }];
      // Cenário de falha opcional: /__mock/fail-next
      const pass = !st.failNext;
      st.failNext = false;
      st.conn = pass;
      st.conn_at = now();
      audit("teste_conexao", pass ? { ok: true } : { ok: false, codigo: "chave_recusada" });
      return ok({
        test: pass
          ? { ok: true, code: null, message: "Conexão com a Clicksign funcionando." }
          : {
              ok: false,
              code: "chave_recusada",
              message:
                "A Clicksign recusou a chave. Confira se copiou a chave de API inteira, da conta de produção (não do sandbox), e se ela não foi apagada.",
            },
      });
    }
    case "set_enabled": {
      if (b.on) {
        const falta = [];
        if (!st.token) falta.push("chave de API");
        if (!st.webhook) falta.push("segredo do webhook");
        if (!view().valid_signers) falta.push("quem assina pela imobiliária");
        if (st.conn !== true) falta.push("teste de conexão aprovado");
        if (falta.length) return [400, { error: `Para ligar falta: ${falta.join(", ")}` }];
      }
      audit(b.on ? "ligar" : "desligar", {});
      st.enabled = !!b.on;
      st.sale_enabled = !!b.on;
      return ok();
    }
  }
  return [400, { error: "Ação inválida" }];
}

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let body = "";
    for await (const ch of req) body += ch;
    const json = body
      ? (() => {
          try {
            return JSON.parse(body);
          } catch {
            return {};
          }
        })()
      : {};
    const u = userFrom(req);
    if (url.pathname === "/__mock/reset") {
      reset();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__mock/fail-next") {
      st.failNext = true;
      return send(res, 200, { ok: true });
    }
    if (url.pathname.startsWith("/auth/v1/user")) {
      if (!u) return send(res, 401, { msg: "invalid jwt" });
      return send(res, 200, {
        id: u.id,
        aud: "authenticated",
        role: "authenticated",
        email: u.email,
        app_metadata: {},
        user_metadata: { nome: u.nome },
      });
    }
    if (url.pathname.startsWith("/auth/v1/")) return send(res, 200, {});
    if (url.pathname === "/functions/v1/clicksign-config") {
      const [s, b] = edge(u, json);
      return send(res, s, b);
    }
    if (url.pathname.startsWith("/functions/v1/")) return send(res, 200, { ok: true });
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      if (fn === "current_org_id") return send(res, 200, ORG);
      if (fn === "is_platform_super_admin") return send(res, 200, false);
      if (fn === "platform_current_org") return send(res, 200, null);
      if (fn === "exclusive_capture_enabled") return send(res, 200, true);
      return send(res, 200, null);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      const one = (req.headers.accept || "").includes("vnd.pgrst.object");
      let rows = [];
      if (table === "user_roles")
        rows = u ? [{ role: u.role, organization_id: ORG, user_id: u.id }] : [];
      if (table === "profiles")
        rows = u
          ? [{ id: u.id, nome: u.nome, ativo: true, organization_id: ORG, email: u.email }]
          : [];
      if (table === "organization_members")
        rows = u ? [{ organization_id: ORG, user_id: u.id, ativo: true }] : [];
      if (table === "organizations")
        rows = [{ id: ORG, slug: "ficticia", nome: "Imobiliária Fictícia", status: "ativa" }];
      if (one)
        return rows.length === 1
          ? send(res, 200, rows[0])
          : send(res, 406, { code: "PGRST116", message: "no rows" });
      return send(res, 200, rows, {
        "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
      });
    }
    return send(res, 404, { message: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${PORT}`));
