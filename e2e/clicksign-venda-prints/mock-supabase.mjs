// Mock local de Supabase (GoTrue + PostgREST + Edge Functions) para os prints da Clicksign na VENDA
// e na CAPTAÇÃO. Dados 100% fictícios (só @example.com); nenhuma chamada externa, nada vai à
// Clicksign. Cenário trocável em /__mock/scenario?name=pronta|falta-email|em-assinatura|assinado.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54398);
const ORG = "11111111-1111-4111-8111-111111111111";
const GESTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CORRETOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SALE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const CAPTURE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const UNIT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const users = {
  "tok-gestor": { id: GESTOR, email: "gestora@example.com", nome: "Gestora Fictícia" },
};

let scenario = "pronta";

const doc = (tipo, parte, i, extra = {}) => ({
  id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`,
  sale_id: SALE,
  tipo,
  parte,
  status: "aprovado",
  file_name: `${tipo}.pdf`,
  file_path: `${SALE}/${parte}/${tipo}.pdf`,
  created_at: "2026-10-08T00:00:00Z",
  ...extra,
});

function fresh() {
  const status =
    scenario === "em-assinatura"
      ? "aguardando_assinatura"
      : scenario === "assinado"
        ? "contrato_assinado"
        : "contrato_ok_corretor";
  let i = 0;
  const docs = [
    ...["comprador_1", "vendedor_1"].flatMap((p) =>
      ["rg", "cpf", "certidao", "comprovante_endereco"].map((t) => doc(t, p, ++i)),
    ),
    doc("matricula", "imovel", ++i),
    doc("iptu", "imovel", ++i),
    doc("contrato", "contrato", ++i, { file_name: "contrato-compra-venda-FICT-001-v2.pdf" }),
  ];
  if (scenario === "assinado")
    docs.push(
      doc("contrato_assinado", "contrato", 99, {
        file_name: "contrato-compra-venda-FICT-001-assinado.pdf",
        created_at: "2026-10-18T13:40:00Z",
      }),
    );
  const sale = {
    id: SALE,
    organization_id: ORG,
    corretor_id: CORRETOR,
    gestor_id: GESTOR,
    status,
    modalidade: "pronto",
    imovel_id: "FICT-001",
    codigo_interno: null,
    matricula: "12345",
    imovel_logradouro: "Rua Fictícia",
    imovel_numero: "100",
    imovel_bairro: "Centro",
    imovel_cidade: "Sorocaba",
    imovel_uf: "SP",
    midia: "Portal",
    valor_negociado: 500000,
    valor_total_comissao: 30000,
    percentual_comissao: 6,
    contrato_libera_assinatura: true,
    parceria_externa_venda: true,
    parceria_tipo: "imobiliaria_externa",
    parceria_nome: "Imobiliária Parceira Fictícia",
    parceria_email: "parceira@example.com",
    created_at: "2026-10-08T00:00:00Z",
    updated_at: "2026-10-18T00:00:00Z",
  };
  const party = (id, papel, nome, email, cpf) => ({
    id,
    sale_id: SALE,
    papel,
    nome,
    email,
    cpf_cnpj: cpf,
    tipo_pessoa: "fisica",
    telefone: "(15) 90000-0000",
  });
  return {
    user_roles: [{ organization_id: ORG, user_id: GESTOR, role: "gestor" }],
    organization_members: [{ organization_id: ORG, user_id: GESTOR, ativo: true }],
    organizations: [
      { id: ORG, slug: "ficticia", nome: "Imobiliária Fictícia", status: "ativa", legacy_default: true },
    ],
    profiles: [
      { id: GESTOR, nome: "Gestora Fictícia", organization_id: ORG, ativo: true },
      { id: CORRETOR, nome: "Corretor Fictício", organization_id: ORG, ativo: true },
    ],
    sales: [sale],
    sale_parties: [
      party("p1", "vendedor_1", "Valéria Vendedora Fictícia", "vendedora@example.com", "00000000191"),
      party(
        "p2",
        "comprador_1",
        "Carlos Comprador Fictício",
        scenario === "falta-email" ? null : "comprador@example.com",
        "00000000272",
      ),
    ],
    sale_payment: [{ id: "pay1", sale_id: SALE, tipo_pagamento: "vista", entrada_valor: 500000 }],
    sale_documents: docs,
    exclusive_captures: [capture()],
    exclusive_documents: [
      {
        id: "99999999-9999-4999-8999-000000000001",
        capture_id: CAPTURE,
        kind: "gerado",
        owner: 0,
        file_name: "contrato-exclusividade-FICT.pdf",
        storage_path: `${ORG}/${CAPTURE}/gerado.pdf`,
        created_at: "2026-10-17T10:00:00Z",
      },
    ],
    exclusive_units: [{ id: UNIT, nome: "Unidade Fictícia", cidade: "Sorocaba", estado: "SP", ativo: true }],
  };
}

function capture() {
  return {
    id: CAPTURE,
    organization_id: ORG,
    unit_id: UNIT,
    broker_id: GESTOR,
    broker_cpf: "000.000.001-91",
    broker_creci: "000000-F",
    status: "em_assinatura",
    manual: false,
    archived_at: null,
    created_at: "2026-10-17T09:00:00Z",
    updated_at: "2026-10-17T10:00:00Z",
    form_data: {
      proprietario_1: { nome_completo: "Paula Proprietária Fictícia", email: "proprietaria@example.com" },
      imovel: { endereco: "Rua Fictícia, 200", cidade: "Sorocaba", estado: "SP" },
    },
  };
}

let tables = fresh();
const log = [];

const saleConfig = () => {
  const base = {
    enabled: true,
    test_mode: true,
    can_send: true,
    witnesses: 2,
    deadline_days: 30,
    libera_assinatura: true,
    contrato: { id: "dddddddd-dddd-4ddd-8ddd-000000000011", file_name: "contrato-compra-venda-FICT-001-v2.pdf" },
    imobiliaria: [{ id: "imob-1", nome: "Diretora Fictícia" }],
    corretores: [{ nome: "Corretor Fictício", email_ok: true }],
    envelope: null,
  };
  if (scenario === "em-assinatura")
    base.envelope = {
      status: "running",
      is_test: true,
      created_at: "2026-10-18T12:00:00Z",
      error_code: null,
      signed: false,
      notify_available_at: null,
    };
  if (scenario === "assinado")
    base.envelope = {
      status: "closed",
      is_test: true,
      created_at: "2026-10-18T12:00:00Z",
      error_code: null,
      signed: true,
    };
  return base;
};

const signer = (idx, papel, label, nome, email, st) => ({
  idx,
  papel,
  label,
  nome,
  email,
  signed: st === "assinou",
  opened: st !== "enviado",
  status: st,
  found: true,
  editable: st !== "assinou",
});
const saleSigners = [
  signer(0, "seller", "Vendedor(a) 1", "Valéria Vendedora Fictícia", "ve***@example.com", "assinou"),
  signer(1, "buyer", "Comprador(a) 1", "Carlos Comprador Fictício", "co***@example.com", "abriu"),
  signer(2, "broker", "Corretor(a)", "Corretor Fictício", "co***@example.com", "assinou"),
  signer(3, "imobiliaria", "Pela imobiliária", "Diretora Fictícia", "di***@example.com", "enviado"),
  signer(4, "witness", "Testemunha 1", "Tânia Testemunha Fictícia", "te***@example.com", "abriu"),
  signer(5, "witness", "Testemunha 2", "Tiago Testemunha Fictício", "ti***@example.com", "enviado"),
  signer(6, "lawyer", "Advogado(a)", "Ana Advogada Fictícia", "ad***@example.com", "enviado"),
];
const captureSigners = [
  signer(0, "owner", "Proprietário(a) 1", "Paula Proprietária Fictícia", "pr***@example.com", "assinou"),
  signer(1, "broker", "Corretor(a)", "Gestora Fictícia", "ge***@example.com", "abriu"),
  signer(2, "imobiliaria", "Pela imobiliária", "Diretora Fictícia", "di***@example.com", "enviado"),
  signer(3, "witness", "Testemunha 1", "Tânia Testemunha Fictícia", "te***@example.com", "assinou"),
  signer(4, "witness", "Testemunha 2", "Tiago Testemunha Fictício", "ti***@example.com", "enviado"),
];

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

    if (url.pathname === "/__mock/scenario") {
      scenario = url.searchParams.get("name") || "pronta";
      tables = fresh();
      return send(res, 200, { ok: true, scenario });
    }
    if (url.pathname === "/__mock/log") return send(res, 200, log.splice(0));
    if (url.pathname.startsWith("/auth/v1/user")) {
      if (!u) return send(res, 401, { msg: "invalid jwt" });
      return send(res, 200, { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: { nome: u.nome } });
    }
    if (url.pathname.startsWith("/auth/v1/")) return send(res, 200, {});

    // Edge functions: nada sai daqui; respostas fictícias no formato do servidor.
    if (url.pathname === "/functions/v1/clicksign-sale") {
      if (json.action === "status") return send(res, 200, { ok: true, signers: saleSigners });
      return send(res, 400, { error: "Mock: ação desabilitada (sem chamada à Clicksign)" });
    }
    if (url.pathname === "/functions/v1/clicksign-manage") {
      if (json.action === "status") return send(res, 200, { ok: true, signers: captureSigners });
      return send(res, 400, { error: "Mock: ação desabilitada (sem chamada à Clicksign)" });
    }
    if (url.pathname.startsWith("/functions/v1/")) return send(res, 200, { ok: true });

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      if (fn === "current_org_id") return send(res, 200, ORG);
      if (fn === "is_platform_super_admin") return send(res, 200, false);
      if (fn === "sale_management_capabilities")
        return send(res, 200, { can_manage: true, can_edit: true, team_owner: true });
      if (fn === "clicksign_sale_config") return send(res, 200, saleConfig());
      if (fn === "clicksign_sale_extra_candidates")
        return send(res, 200, [
          { ref: "corretor:22222222-2222-4222-8222-222222222222", tipo: "corretor", nome: "Renata Corretora Fictícia", email: "re***@example.com" },
          { ref: "parceiro:33333333-3333-4333-8333-333333333333", tipo: "parceiro", nome: "Paulo Parceiro Fictício", email: "pa***@example.com" },
        ]);
      if (fn === "clicksign_sale_signed")
        return scenario === "assinado"
          ? send(res, 200, {
              document_id: "dddddddd-dddd-4ddd-8ddd-000000000099",
              is_test: true,
              closed_at: "2026-10-18T13:40:00Z",
              auto_marked: true,
              signers: saleSigners.map((s) => ({ papel: s.papel, label: s.label, nome: s.nome })),
            })
          : send(res, 200, null);
      if (fn === "exclusive_capture_enabled") return send(res, 200, true);
      if (fn === "exclusive_history_view") return send(res, 200, []);
      if (fn === "exclusive_profile_registration") return send(res, 200, []);
      if (fn === "clicksign_capture_config")
        return send(res, 200, {
          enabled: true,
          test_mode: true,
          can_send: true,
          witnesses: 2,
          deadline_days: 30,
          imobiliaria: [{ id: "imob-1", nome: "Diretora Fictícia" }],
          corretor_email_ok: true,
          envelope: { status: "running", is_test: true, created_at: "2026-10-17T10:05:00Z", error_code: null, signed: false },
        });
      if (fn === "clicksign_capture_signed") return send(res, 200, null);
      if (fn === "calcular_distribuicao_venda") return send(res, 200, []);
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
