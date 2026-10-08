// Mock local de Supabase (GoTrue + PostgREST) para o teste "levar ao campo que falta".
// Dados 100% fictícios; nenhuma chamada externa. Uma venda em rascunho completa, menos a Mídia.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54399);
const ORG = "11111111-1111-4111-8111-111111111111";
const CORRETOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SALE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const users = { "tok-corretor": { id: CORRETOR, email: "corretor@example.test", nome: "Corretor Teste" } };

const doc = (tipo, parte, i) => ({
  id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`,
  sale_id: SALE,
  tipo,
  parte,
  status: "enviado",
  file_name: `${tipo}.pdf`,
  file_path: `${SALE}/${parte}/${tipo}.pdf`,
  created_at: "2026-10-08T00:00:00Z",
});
let i = 0;
const docs = [
  ...["comprador_1", "vendedor_1"].flatMap((p) =>
    ["rg", "cpf", "certidao", "comprovante_endereco"].map((t) => doc(t, p, ++i)),
  ),
  doc("matricula", "imovel", ++i),
  doc("iptu", "imovel", ++i),
];

const venda = {
  id: SALE,
  organization_id: ORG,
  corretor_id: CORRETOR,
  status: "rascunho",
  modalidade: "pronto",
  imovel_id: "FICT-001",
  codigo_interno: null,
  matricula: "12345",
  imovel_logradouro: "Rua Fictícia",
  imovel_numero: "100",
  imovel_bairro: "Centro",
  imovel_cidade: "Sorocaba",
  imovel_uf: "SP",
  midia: null, // <- o único campo que falta
  valor_negociado: 500000,
  valor_total_comissao: 30000,
  percentual_comissao: 6,
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
};

const fresh = () => ({
  user_roles: [{ organization_id: ORG, user_id: CORRETOR, role: "corretor" }],
  organization_members: [{ organization_id: ORG, user_id: CORRETOR, ativo: true }],
  organizations: [
    { id: ORG, slug: "ficticia", nome: "Imobiliária Fictícia", status: "ativa", legacy_default: true },
  ],
  profiles: [{ id: CORRETOR, nome: "Corretor Teste", organization_id: ORG, ativo: true }],
  sales: [{ ...venda }],
  sale_parties: [
    { id: "p1", sale_id: SALE, papel: "vendedor_1", nome: "Vendedor Fictício", cpf_cnpj: "00000000191", tipo_pessoa: "fisica" },
    { id: "p2", sale_id: SALE, papel: "comprador_1", nome: "Comprador Fictício", cpf_cnpj: "00000000272", tipo_pessoa: "fisica" },
  ],
  sale_payment: [{ id: "pay1", sale_id: SALE, tipo_pagamento: "vista", entrada_valor: 500000 }],
  sale_documents: docs,
});
let tables = fresh();
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
  for (const [k, u] of Object.entries(users)) if (tok.includes(k)) return u;
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
    const json = body ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : {};
    const u = userFrom(req);
    log.push(`${req.method} ${url.pathname}${url.search}`);

    if (url.pathname === "/__mock/reset") { tables = fresh(); return send(res, 200, { ok: true }); }
    if (url.pathname === "/__mock/log") return send(res, 200, log.splice(0));
    if (url.pathname.startsWith("/auth/v1/user")) {
      if (!u) return send(res, 401, { msg: "invalid jwt" });
      return send(res, 200, { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: { nome: u.nome } });
    }
    if (url.pathname.startsWith("/auth/v1/")) return send(res, 200, {});

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      if (fn === "current_org_id") return send(res, 200, ORG);
      if (fn === "is_platform_super_admin") return send(res, 200, false);
      if (fn === "sale_management_capabilities") return send(res, 200, { can_manage: false, can_edit: true });
      if (fn === "change_sale_status") {
        // Mesma trava do banco (migration 20261008130000): sem Mídia, 23514.
        const s = tables.sales.find((r) => r.id === json._sale_id);
        if (s && !String(s.midia ?? "").trim())
          return send(res, 400, {
            code: "23514",
            message: "Informe a Mídia da venda (de onde veio o cliente) antes de enviar. Sem ela a venda não sai do rascunho.",
          });
        if (s) s.status = json._new_status;
        return send(res, 200, null);
      }
      return send(res, 200, null);
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      let rows = tables[table] ?? [];
      if (req.method === "GET" || req.method === "HEAD") {
        rows = filterRows(rows, url.searchParams);
        if ((req.headers.accept || "").includes("vnd.pgrst.object")) {
          if (rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "no rows" });
          return send(res, 200, rows[0]);
        }
        return send(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
      }
      if (req.method === "PATCH") {
        const alvo = filterRows(rows, url.searchParams);
        for (const r of alvo) Object.assign(r, json);
        if ((req.headers.accept || "").includes("vnd.pgrst.object")) return send(res, 200, alvo[0] ?? null);
        return send(res, 200, alvo);
      }
      return send(res, 201, []);
    }
    return send(res, 404, { message: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${PORT}`));
