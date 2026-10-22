// Mock local de Supabase (GoTrue + PostgREST + Storage) para o teste de tela com 4 proprietários
// (t_58effd65). Dados 100% fictícios (@example.com); nenhuma chamada externa.
import http from "node:http";
import { readFileSync } from "node:fs";

const TEMPLATE = process.env.TEMPLATE || "assets/exclusividade/remax-padrao.pdf";
let lastUpload = null;

const PORT = Number(process.env.MOCK_PORT || 54398);
const ORG = "11111111-1111-4111-8111-111111111111";
const CORRETOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CAPTURE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const UNIT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const users = { "tok-corretor": { id: CORRETOR, email: "corretor@example.com", nome: "Corretor Fictício" } };

const owner = (nome, endereco = "") => ({
  nome_completo: nome,
  rg: "",
  cpf: "",
  nacionalidade: "",
  estado_civil: "",
  endereco_completo: endereco,
  email: "",
  telefone_1: "",
  telefone_2: "",
});
let docSeq = 0;
const docRow = (kind, owner_index, file_name) => ({
  id: `99999999-9999-4999-8999-${String(++docSeq).padStart(12, "0")}`,
  capture_id: CAPTURE,
  kind,
  owner_index,
  file_name,
  storage_path: `${ORG}/${CAPTURE}/${crypto.randomUUID()}.pdf`,
  created_at: new Date(Date.UTC(2026, 9, 19, 12, docSeq)).toISOString(),
});
function fresh() {
  return {
    user_roles: [{ organization_id: ORG, user_id: CORRETOR, role: "gestor" }],
    organization_members: [{ organization_id: ORG, user_id: CORRETOR, ativo: true }],
    organizations: [{ id: ORG, slug: "ficticia", nome: "Imobiliária Fictícia", status: "ativa", legacy_default: true }],
    profiles: [{ id: CORRETOR, nome: "Corretor Fictício", organization_id: ORG, ativo: true }],
    exclusive_captures: [
      {
        id: CAPTURE,
        organization_id: ORG,
        unit_id: UNIT,
        captor_id: CORRETOR,
        broker_name: "Corretor Fictício",
        broker_cpf: "000.000.001-91",
        broker_creci: "000000-F",
        template: "remax-padrao",
        status: "enviada",
        manual: false,
        archived_at: null,
        signed_on: null,
        created_on_sp: "2026-10-19",
        created_at: "2026-10-19T12:00:00Z",
        updated_at: "2026-10-19T12:00:00Z",
        form_data: {
          // 4 proprietários fictícios: 1º e 2º no formato antigo, 3º e 4º em proprietarios_extras.
          proprietario_1: owner("Ana Proprietária Fictícia", "Rua Fictícia A, 1"),
          proprietario_2: owner("Bruno Proprietário Fictício", "Rua Fictícia B, 2"),
          proprietarios_extras: [
            owner("Carla Proprietária Fictícia", "Rua Fictícia C, 3"),
            owner("Davi Proprietário Fictício", "Rua Fictícia D, 4"),
          ],
          imovel: { endereco: "Rua do Imóvel Fictício, 200", municipio: "Sorocaba", estado: "São Paulo" },
        },
      },
    ],
    exclusive_documents: [1, 2, 3, 4].map((n) => docRow("cnh", n, `cnh-ficticia-${n}.pdf`)),
    exclusive_units: [
      {
        id: UNIT, organization_id: ORG, nome: "Unidade Fictícia", creci: "99999-J", razao_social: "FICTICIA LTDA",
        endereco: "Rua Exemplo, 100", cidade: "Sorocaba", estado: "São Paulo", cnpj: "11.222.333/0001-81",
        nome_comercial: "RE/MAX FICTÍCIA", legacy_template: null, contrato_antigo: false, ativo: true,
      },
    ],
  };
}
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
  }
  return out;
}

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks);
    const json = (() => {
      try {
        return JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        return {};
      }
    })();
    const u = userFrom(req);
    log.push(`${req.method} ${url.pathname}${url.search}`);

    if (url.pathname === "/__mock/reset") {
      tables = fresh();
      // ?status=rascunho → tela editável (adicionar/remover); padrão "enviada" → gestor gera o PDF.
      if (url.searchParams.get("status")) tables.exclusive_captures[0].status = url.searchParams.get("status");
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__mock/log") return send(res, 200, log.splice(0));
    if (url.pathname === "/__mock/state") return send(res, 200, tables.exclusive_captures[0].form_data);
    if (url.pathname === "/__mock/upload") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(lastUpload ?? Buffer.alloc(0));
    }
    if (url.pathname.startsWith("/auth/v1/user")) {
      if (!u) return send(res, 401, { msg: "invalid jwt" });
      return send(res, 200, { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: { nome: u.nome } });
    }
    if (url.pathname.startsWith("/auth/v1/")) return send(res, 200, {});

    // Modelo-base: o PDF do repositório (assets/), igual ao do bucket exclusive-templates/base.
    if (url.pathname.includes("/exclusive-templates/") && url.pathname.endsWith("remax-padrao.pdf")) {
      res.writeHead(200, { "content-type": "application/pdf", "access-control-allow-origin": "*" });
      return res.end(readFileSync(TEMPLATE));
    }
    // Storage: upload guarda o último PDF enviado (o gerado); download devolve um PDF mínimo fictício.
    if (url.pathname.startsWith("/storage/v1/object/exclusive-captures/")) {
      const key = url.pathname.slice("/storage/v1/object/exclusive-captures/".length);
      if (req.method === "POST" || req.method === "PUT") {
        lastUpload = raw;
        return send(res, 200, { Key: `exclusive-captures/${key}` });
      }
      res.writeHead(200, { "content-type": "application/pdf", "access-control-allow-origin": "*" });
      return res.end(Buffer.from("%PDF-1.4\n% comprovante ficticio\n%%EOF\n"));
    }
    if (url.pathname.startsWith("/storage/v1/")) return send(res, 200, {});

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      if (fn === "current_org_id") return send(res, 200, ORG);
      if (fn === "is_platform_super_admin") return send(res, 200, false);
      if (fn === "exclusive_capture_enabled") return send(res, 200, true);
      if (fn === "exclusive_history_view") return send(res, 200, []);
      if (fn === "exclusive_profile_registration") return send(res, 200, []);
      if (fn === "exclusive_address_conflicts") return send(res, 200, []);
      if (fn === "exclusive_venda_da_captacao") return send(res, 200, { pode_virar: false, venda: null });
      if (fn === "exclusive_register_document") {
        // Mesma regra da migration nova (t_58effd65): proprietário 1..60; residência 0..60.
        const ok =
          (["rg", "cpf", "cnh"].includes(json._kind) && json._owner >= 1 && json._owner <= 60) ||
          (json._kind === "residencia" && json._owner >= 0 && json._owner <= 60) ||
          (["iptu", "matricula", "gerado", "assinado"].includes(json._kind) && json._owner === 0);
        if (!ok) return send(res, 400, { message: "Documento inválido", code: "P0001" });
        const docs = tables.exclusive_documents.filter((d) => !(d.kind === json._kind && d.owner_index === json._owner));
        docs.push({ ...docRow(json._kind, json._owner, json._file_name), storage_path: json._path });
        tables.exclusive_documents = docs;
        return send(res, 200, null);
      }
      if (fn === "exclusive_save") {
        tables.exclusive_captures[0].form_data = json._form;
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
          if (rows.length > 1) return send(res, 406, { code: "PGRST116", message: "many rows" });
          if (rows.length === 0) {
            // maybeSingle: o cliente trata 406 sem linhas como null.
            return send(res, 406, { code: "PGRST116", message: "no rows", details: "The result contains 0 rows" });
          }
          return send(res, 200, rows[0]);
        }
        return send(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
      }
      return send(res, 201, []);
    }
    return send(res, 404, { message: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${PORT}`));
