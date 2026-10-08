// Mock local de Supabase (GoTrue + PostgREST) para o teste da tela "Mapa de captações".
// Dados 100% fictícios; nenhuma chamada externa. mapa_captacoes() imita a regra do banco
// (migration 20261008150000): só aprovadas, sem proprietário/valor/comissão; endereço só com detalhe.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54399);
const ORG = "11111111-1111-4111-8111-111111111111";
const ORG_TESTE = "22222222-2222-4222-8222-222222222222";
const U = {
  corretor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  gestor: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  admin: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  teste: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
};
const users = {
  "tok-corretor": { id: U.corretor, org: ORG, role: "corretor", nome: "Corretor Fictício" },
  "tok-gestor": { id: U.gestor, org: ORG, role: "gestor", nome: "Gestor Fictício" },
  "tok-admin": { id: U.admin, org: ORG, role: "admin", nome: "Admin Fictício" },
  "tok-teste": { id: U.teste, org: ORG_TESTE, role: "corretor", nome: "Corretor REMAX-TESTE" },
};

// Captações da imobiliária fictícia "Única"; só a 1ª e a 2ª estão aprovadas (assinadas).
const capturas = [
  { id: "c1", org: ORG, codigo: "CAP-001", status: "aprovada", tipo_imovel: "Casa", bairro: "Campolim", cidade: "Sorocaba", captador: "Corretor Fictício", lat: -23.5245, lon: -47.4733, endereco: "Rua Fictícia, 100", signed_on: "2026-10-01", prazo_dias: "180", captador_id: U.corretor },
  { id: "c2", org: ORG, codigo: "CAP-002", status: "aprovada", tipo_imovel: "Apartamento", bairro: "Centro", cidade: "Sorocaba", captador: "Outro Corretor", lat: -23.5015, lon: -47.4526, endereco: "Av. Exemplo, 200", signed_on: "2026-09-20", prazo_dias: "90", captador_id: "x" },
  { id: "c3", org: ORG, codigo: "CAP-003", status: "rascunho", tipo_imovel: "Casa", bairro: "Éden", cidade: "Sorocaba", captador: "Outro", lat: -23.42, lon: -47.4, endereco: "Rua Rascunho, 1", signed_on: null, prazo_dias: null, captador_id: "x" },
];

function mapaCaptacoes(u) {
  const amplo = ["gestor", "admin", "super_admin"].includes(u.role);
  return capturas
    .filter((c) => c.org === u.org && c.status === "aprovada")
    .map((c) => {
      const podeAbrir = u.role === "admin" || c.captador_id === u.id;
      const detalhe = amplo || podeAbrir;
      return {
        id: c.id,
        codigo: c.codigo,
        tipo_imovel: c.tipo_imovel,
        bairro: c.bairro,
        cidade: c.cidade,
        captador: c.captador,
        geo_lat: c.lat,
        geo_lon: c.lon,
        detalhe,
        pode_abrir: podeAbrir,
        endereco: detalhe ? c.endereco : null,
        status: detalhe ? c.status : null,
        signed_on: detalhe ? c.signed_on : null,
        prazo_dias: detalhe ? c.prazo_dias : null,
        estado: podeAbrir ? "SP" : null,
        geo_key: podeAbrir ? "k" : null,
      };
    });
}

const tables = () => ({
  user_roles: Object.values(users).map((u) => ({ organization_id: u.org, user_id: u.id, role: u.role })),
  organization_members: Object.values(users).map((u) => ({ organization_id: u.org, user_id: u.id, ativo: true })),
  organizations: [
    { id: ORG, slug: "unica-ficticia", nome: "Imobiliária Fictícia", status: "ativa", legacy_default: true, cidade: "Sorocaba", uf: "SP" },
    { id: ORG_TESTE, slug: "remax-teste", nome: "REMAX-TESTE", status: "ativa", legacy_default: false, cidade: "Sorocaba", uf: "SP" },
  ],
  profiles: Object.values(users).map((u) => ({ id: u.id, nome: u.nome, organization_id: u.org, ativo: true })),
});
const db = tables();
const log = [];

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
  for (const [k, u] of Object.entries(users)) if (tok.endsWith(k)) return u;
  return null;
};
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

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let body = "";
    for await (const ch of req) body += ch;
    const u = userFrom(req);
    log.push(`${u?.role ?? "-"} ${req.method} ${url.pathname}`);

    if (url.pathname === "/__mock/log") return send(res, 200, log.splice(0));
    if (url.pathname.startsWith("/auth/v1/user")) {
      if (!u) return send(res, 401, { msg: "invalid jwt" });
      return send(res, 200, { id: u.id, aud: "authenticated", role: "authenticated", email: `${u.role}@example.test`, app_metadata: {}, user_metadata: { nome: u.nome } });
    }
    if (url.pathname.startsWith("/auth/v1/")) return send(res, 200, {});

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      if (fn === "current_org_id") return send(res, 200, u?.org ?? null);
      if (fn === "is_platform_super_admin") return send(res, 200, false);
      if (fn === "exclusive_capture_enabled") return send(res, 200, true);
      if (fn === "mapa_captacoes") return u ? send(res, 200, mapaCaptacoes(u)) : send(res, 401, { code: "42501" });
      if (fn === "vendas_por_regiao_todos") return send(res, 200, []);
      if (fn.endsWith("_enabled")) return send(res, 200, false);
      return send(res, 200, null);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      let rows = filterRows(db[table] ?? [], url.searchParams);
      if ((req.headers.accept || "").includes("vnd.pgrst.object")) {
        if (rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "no rows" });
        return send(res, 200, rows[0]);
      }
      return send(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    }
    return send(res, 404, { message: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${PORT}`));
