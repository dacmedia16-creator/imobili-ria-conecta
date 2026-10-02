// Mock local de Supabase (GoTrue + PostgREST) só para o teste de telas da Parte 2/3.
// Dados 100% fictícios; nenhuma chamada externa.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54399);
const UNICA = "11111111-1111-4111-8111-111111111111";
const FICT = "22222222-2222-4222-8222-222222222222";
const DAC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMUM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const users = {
  "tok-dac": { id: DAC, email: "dacmedia@example.test", nome: "Dac Media (plataforma)" },
  "tok-comum": { id: COMUM, email: "corretor@example.test", nome: "Corretor Comum" },
};

const orgName = { [UNICA]: "Única Escolha", [FICT]: "Imobiliária Fictícia Teste" };
const tables = {
  platform_admins: [{ user_id: DAC }],
  organizations: [
    { id: UNICA, slug: "unica-escolha", nome: "Única Escolha", status: "ativa", legacy_default: true, cnpj: null, cor_primaria: "#0b1f4b", cor_secundaria: "#c9a227", logo_path: null, created_at: "2026-01-01T00:00:00Z" },
    { id: FICT, slug: "ficticia-teste", nome: "Imobiliária Fictícia Teste", status: "ativa", legacy_default: false, cnpj: null, cor_primaria: "#14532d", cor_secundaria: "#86efac", logo_path: null, created_at: "2026-10-02T00:00:00Z" },
  ],
  organization_members: [
    { organization_id: UNICA, user_id: COMUM, ativo: true },
    { organization_id: UNICA, user_id: DAC, ativo: true },
    { organization_id: UNICA, user_id: "c1", ativo: true },
    { organization_id: FICT, user_id: "c2", ativo: true },
  ],
  user_roles: [
    { organization_id: UNICA, user_id: COMUM, role: "corretor", notificar_whatsapp: false, notificar_toda_atualizacao: false },
    { organization_id: UNICA, user_id: "c1", role: "super_admin" },
    { organization_id: FICT, user_id: "c2", role: "admin" },
  ],
  profiles: [
    { id: COMUM, nome: "Corretor Comum", organization_id: UNICA, ativo: true, email: "corretor@example.test" },
    { id: DAC, nome: "Dac Media (plataforma)", organization_id: UNICA, ativo: true, email: "dacmedia@example.test" },
  ],
};

// Contexto por usuário (no banco real fica preso à sessão de login).
const ctx = {};
let expireInMs = null;

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

function userFrom(req) {
  const auth = req.headers.authorization || "";
  const tok = auth.replace(/^Bearer\s+/i, "");
  for (const [k, u] of Object.entries(users)) if (tok.includes(k)) return u;
  return null; // service_role / anon
}

function filterRows(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    if (v.startsWith("eq.")) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith("in.(")) {
      const set = new Set(v.slice(4, -1).split(",").map((s) => s.replace(/^"|"$/g, "")));
      out = out.filter((r) => set.has(String(r[k])));
    }
  }
  return out;
}

function ctxFor(u) {
  const c = u && ctx[u.id];
  if (!c) return null;
  if (Date.parse(c.expires_at) <= Date.now()) return null;
  return c;
}

const log = [];

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let body = "";
  for await (const ch of req) body += ch;
  const json = body ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : {};
  const u = userFrom(req);
  log.push(`${req.method} ${url.pathname}${url.search} as=${u ? u.email : "service/anon"}`);

  // Controles do teste
  if (url.pathname === "/__mock/expire-soon") {
    expireInMs = Number(url.searchParams.get("ms") || 4000);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/__mock/reset") {
    for (const k of Object.keys(ctx)) delete ctx[k];
    expireInMs = null;
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/__mock/log") return send(res, 200, log.splice(0));

  if (url.pathname.startsWith("/auth/v1/user")) {
    if (!u) return send(res, 401, { msg: "invalid jwt" });
    return send(res, 200, { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: { nome: u.nome } });
  }
  if (url.pathname.startsWith("/auth/v1/")) return send(res, 200, {});

  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.slice("/rest/v1/rpc/".length);
    const isDac = u?.id === DAC;
    switch (fn) {
      case "is_platform_super_admin":
        return send(res, 200, isDac);
      case "platform_current_org": {
        const c = ctxFor(u);
        return send(res, 200, c);
      }
      case "platform_enter_org": {
        if (!isDac) return send(res, 403, { code: "42501", message: "apenas administrador da plataforma" });
        const id = json.org_id;
        if (!orgName[id]) return send(res, 400, { code: "P0001", message: "imobiliaria indisponivel" });
        const ms = expireInMs ?? 8 * 3600 * 1000;
        expireInMs = null;
        ctx[u.id] = { organization_id: id, organization_name: orgName[id], expires_at: new Date(Date.now() + ms).toISOString() };
        return send(res, 200, ctx[u.id]);
      }
      case "platform_exit_org":
        if (!isDac) return send(res, 403, { code: "42501", message: "apenas administrador da plataforma" });
        if (u) delete ctx[u.id];
        return send(res, 200, null);
      case "current_org_id": {
        const c = ctxFor(u);
        return send(res, 200, c ? c.organization_id : UNICA);
      }
      default:
        return send(res, 200, null);
    }
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length);
    let rows = tables[table] ?? [];
    if (req.method === "GET" || req.method === "HEAD") {
      // RLS simulada: user_roles do próprio usuário
      if (u && table === "user_roles") rows = rows.filter((r) => r.user_id === u.id);
      rows = filterRows(rows, url.searchParams);
      const accept = req.headers.accept || "";
      if (accept.includes("vnd.pgrst.object")) {
        if (rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "no rows" });
        return send(res, 200, rows[0]);
      }
      return send(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    }
    return send(res, 201, []);
  }
  if (url.pathname.startsWith("/storage/v1/")) return send(res, 404, { message: "not found" });
  return send(res, 404, { message: "not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${PORT}`));
