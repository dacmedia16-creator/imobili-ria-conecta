// Mock local de Supabase para os prints da "Data de nascimento" (t_dff88e75). Dados 100% fictícios
// (@example.com), nenhuma chamada externa. Usuários: admin, corretor antigo e corretor novo.
// Estado em memória, reiniciável em /__mock/reset.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54441);
const ORG = "11111111-1111-4111-8111-111111111111";
const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANTIGO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOVO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const users = {
  "tok-admin": { id: ADMIN, email: "admin@example.com", nome: "Admin Fictício", role: "admin" },
  "tok-antigo": {
    id: ANTIGO,
    email: "corretor.antigo@example.com",
    nome: "Carla Antiga Fictícia",
    role: "corretor",
    created_at: "2026-09-01T12:00:00Z",
  },
  "tok-novo": {
    id: NOVO,
    email: "corretor.novo@example.com",
    nome: "Nelson Novo Fictício",
    role: "corretor",
    created_at: "2026-10-21T12:00:00Z",
  },
};
const byId = Object.fromEntries(Object.values(users).map((u) => [u.id, u]));
let st;
const reset = () => {
  st = { birth: { [ADMIN]: "1980-03-10" }, calls: [] };
};
reset();

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
  if (tok.includes("mock-service-key")) return { id: null, role: "service" };
  return null;
};
const profile = (u) => ({
  id: u.id,
  nome: u.nome,
  email: u.email,
  telefone: u.id === NOVO ? null : "(15) 99123-4567",
  ativo: true,
  // Corretor antigo com perfil completo: prova que a data, sozinha, não trava nem lembra ninguém.
  avatar_url: u.id === ANTIGO ? `http://127.0.0.1:${PORT}/avatar-ficticio.png` : null,
  remax_id: null,
  organization_id: ORG,
  pagina_pessoal_url: null,
  instagram_url: null,
});
const valida = (d) => {
  const hoje = new Date();
  const max = new Date(Date.UTC(hoje.getUTCFullYear() - 16, hoje.getUTCMonth(), hoje.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= "1900-01-01" && d <= max;
};

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let body = "";
    for await (const ch of req) body += ch;
    let json = {};
    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      json = {};
    }
    const u = userFrom(req);
    if (url.pathname === "/__mock/reset") {
      reset();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__mock/state") return send(res, 200, st);
    if (process.env.MOCK_DEBUG && url.pathname.startsWith("/auth/"))
      console.log(req.method, url.pathname, (req.headers.authorization || "").slice(-20));
    if (url.pathname.startsWith("/auth/v1/user")) {
      if (!u || !u.id) return send(res, 401, { msg: "invalid jwt" });
      return send(res, 200, {
        id: u.id,
        aud: "authenticated",
        role: "authenticated",
        email: u.email,
        created_at: u.created_at ?? "2026-01-01T00:00:00Z",
        app_metadata: {},
        user_metadata: { nome: u.nome },
      });
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      const alvo = byId[url.pathname.split("/").pop()];
      if (!alvo) return send(res, 404, { msg: "User not found" });
      return send(res, 200, {
        id: alvo.id,
        email: alvo.email,
        aud: "authenticated",
        role: "authenticated",
        created_at: alvo.created_at ?? "2026-01-01T00:00:00Z",
        app_metadata: { organization_id: ORG },
        user_metadata: { nome: alvo.nome },
      });
    }
    if (url.pathname.startsWith("/auth/v1/admin/users")) return send(res, 200, { users: [] });
    if (url.pathname.startsWith("/auth/v1/")) return send(res, 200, {});
    if (url.pathname.startsWith("/functions/v1/")) return send(res, 200, { ok: true });
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      st.calls.push({ fn, by: u?.id ?? null, args: json });
      if (fn === "current_org_id") return send(res, 200, ORG);
      if (fn === "is_platform_super_admin") return send(res, 200, false);
      if (fn === "platform_current_org") return send(res, 200, null);
      if (fn === "exclusive_capture_enabled") return send(res, 200, true);
      if (fn === "exclusive_profile_registration") {
        const lista = u?.role === "admin" ? Object.values(users) : u ? [u] : [];
        return send(
          res,
          200,
          lista.map((x) => ({
            user_id: x.id,
            cpf: x.id === NOVO ? null : "529.982.247-25",
            creci: x.id === NOVO ? null : "123456-F",
          })),
        );
      }
      if (fn === "profile_set_birthdate") {
        if (!u?.id) return send(res, 401, { code: "42501", message: "Sem sessao" });
        if (json._data == null) delete st.birth[u.id];
        else if (!valida(json._data))
          return send(res, 400, { code: "22023", message: "Data de nascimento invalida" });
        else st.birth[u.id] = json._data;
        return send(res, 200, json._data ?? null);
      }
      if (fn === "profile_birthdate_get_for_user" || fn === "profile_birthdate_set_for_user") {
        const alvo = json._user;
        if (u?.role !== "admin" || !byId[alvo] || alvo === u.id)
          return send(res, 403, { code: "42501", message: "Sem permissao" });
        if (fn === "profile_birthdate_get_for_user") return send(res, 200, st.birth[alvo] ?? null);
        if (json._data == null) delete st.birth[alvo];
        else if (!valida(json._data))
          return send(res, 400, { code: "22023", message: "Data de nascimento invalida" });
        else st.birth[alvo] = json._data;
        return send(res, 200, json._data ?? null);
      }
      return send(res, 200, null);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      const one = (req.headers.accept || "").includes("vnd.pgrst.object");
      const eqId = (url.searchParams.get("id") || url.searchParams.get("user_id") || "").replace(
        /^eq\./,
        "",
      );
      let rows = [];
      const todos = u?.role === "admin" || u?.role === "service";
      if (table === "user_roles")
        rows = (todos ? Object.values(users) : u ? [u] : []).map((x) => ({
          role: x.role,
          organization_id: ORG,
          user_id: x.id,
          notificar_whatsapp: true,
          notificar_toda_atualizacao: true,
        }));
      if (table === "profiles") {
        rows = (todos ? Object.values(users) : u ? [u] : []).map(profile);
        if (eqId) rows = rows.filter((r) => r.id === eqId);
      }
      if (table === "profile_birthdates")
        rows = u?.id && st.birth[u.id] ? [{ user_id: u.id, data_nascimento: st.birth[u.id] }] : [];
      if (table === "organization_members")
        rows = (todos ? Object.values(users) : u ? [u] : []).map((x) => ({
          organization_id: ORG,
          user_id: x.id,
          ativo: true,
          participa_sessenta: false,
        }));
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
