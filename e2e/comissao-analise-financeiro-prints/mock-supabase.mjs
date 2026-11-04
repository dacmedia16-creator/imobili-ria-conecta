// Mock local de Supabase (GoTrue + PostgREST) para os prints da comissão em "análise do Financeiro"
// (t_59cb12e0 / t_a10304e6). Dados 100% fictícios; nenhuma chamada externa.
// Venda em ocorrencia_analise_financeiro com parceria no lado vendedor: comissão total 6% = R$ 10.800,
// lado REMAX 3% = R$ 5.400, parceira R$ 5.400, captador R$ 3.240. A ocorrência ficou com 3% / R$ 5.400
// (o que acontecia antes da correção) para o aviso de divergência aparecer.
// MOCK_ACEITA=1 no /__mock/reset?aceita=1 deixa a ocorrência aceita pelo Financeiro (congelada).
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54466);
const ORG = "11111111-1111-4111-8111-111111111111";
const FIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CORRETOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SALE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OCC = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const users = {
  "tok-financeiro": {
    id: FIN,
    email: "financeiro@example.test",
    nome: "Fernanda Financeiro (fictícia)",
  },
};

const venda = {
  id: SALE,
  organization_id: ORG,
  corretor_id: CORRETOR,
  created_by: CORRETOR,
  corretor_captador_id: CORRETOR,
  corretor_captador: "Carlos Captador (fictício)",
  status: "ocorrencia_analise_financeiro",
  modalidade: "padrao",
  imovel_id: "FICT-266",
  codigo_interno: "999999999-266",
  midia: "Placa",
  matricula: "12345",
  imovel_logradouro: "Rua Fictícia",
  imovel_numero: "100",
  imovel_bairro: "Centro",
  imovel_cidade: "Sorocaba",
  imovel_uf: "SP",
  valor_anunciado: 180000,
  valor_negociado: 180000,
  percentual_comissao: 6,
  valor_total_comissao: 10800,
  percentual_remax: 3,
  valor_remax: 5400,
  valor_comissao_captador: 3240,
  percentual_comissao_captador: 30,
  parceria_tipo: "imobiliaria_externa",
  parceria_nome: "Imobiliária Parceira Exemplo",
  parceria_percentual: 3,
  parceria_valor: 5400,
  parceria_externa_venda: true,
  parceria_externa_captacao: false,
  previsao_recebimento_valor: 5400,
  previsao_recebimento_data: "2026-12-10",
  previsao_recebimento_forma: "PIX",
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-11-04T17:36:00Z",
};

const ocorrencia = (aceita) => ({
  id: OCC,
  sale_id: SALE,
  organization_id: ORG,
  status: "pendente",
  aceita_financeiro: aceita,
  aceita_financeiro_em: aceita ? "2026-11-04T18:00:00Z" : null,
  aceita_financeiro_por: aceita ? FIN : null,
  midia: "Placa",
  valor_anunciado: 180000,
  valor_negociado: 180000,
  percentual_comissao: 3,
  valor_comissao: 5400,
  prev_recebimento_valor: 5400,
  prev_recebimento_data: "2026-12-10",
  prev_recebimento_forma: "PIX",
  financiamento: false,
  created_at: "2026-11-04T16:50:00Z",
  updated_at: "2026-11-04T16:54:00Z",
});

const distribuicao = {
  modalidade: "padrao",
  parte_remax: 5400,
  calculo_valido: true,
  comissao_bruta: 10800,
  inconsistencias: [],
  valor_negociado: 180000,
  liquido_captador: 3240,
  liquido_vendedor: 0,
  parceria_externa: 5400,
  total_distribuido: 10800,
  diferenca_restante: 0,
  indicador_captador: 0,
  indicador_vendedor: 0,
  gestores_team_leaders: 0,
  comissao_bruta_captador: 3240,
  comissao_bruta_vendedor: 0,
  descontos_extra_captador: 0,
  descontos_extra_vendedor: 0,
  saldo_inicial_imobiliaria: 2160,
  saldo_liquido_imobiliaria: 2160,
  descontos_extra_imobiliaria: 0,
  comissoes_manuais_imobiliaria: 0,
};

const fresh = (aceita = false) => ({
  user_roles: [{ organization_id: ORG, user_id: FIN, role: "financeiro" }],
  organization_members: [{ organization_id: ORG, user_id: FIN, ativo: true }],
  organizations: [
    {
      id: ORG,
      slug: "ficticia",
      nome: "Imobiliária Fictícia",
      status: "ativa",
      legacy_default: true,
    },
  ],
  profiles: [
    { id: FIN, nome: "Fernanda Financeiro (fictícia)", organization_id: ORG, ativo: true },
    { id: CORRETOR, nome: "Carlos Captador (fictício)", organization_id: ORG, ativo: true },
  ],
  sales: [{ ...venda }],
  occurrences: [ocorrencia(aceita)],
  occurrence_commissions: [
    {
      id: "c1",
      occurrence_id: OCC,
      organization_id: ORG,
      papel: "corretor_captador",
      nome: "Carlos Captador (fictício)",
      user_id: CORRETOR,
      valor: 3240,
      percentual: 30,
      managed_by_sale: true,
      sale_commission_extra_id: null,
    },
  ],
  occurrence_partners: [
    {
      id: "p1",
      occurrence_id: OCC,
      organization_id: ORG,
      from_sale: true,
      tipo: "imobiliaria_externa",
      nome: "Imobiliária Parceira Exemplo",
      percentual: 3,
      valor: 5400,
    },
  ],
  sale_parties: [
    {
      id: "p1",
      sale_id: SALE,
      papel: "vendedor_1",
      nome: "Vendedor Fictício",
      cpf_cnpj: "00000000191",
      tipo_pessoa: "fisica",
    },
    {
      id: "p2",
      sale_id: SALE,
      papel: "comprador_1",
      nome: "Comprador Fictício",
      cpf_cnpj: "00000000272",
      tipo_pessoa: "fisica",
    },
  ],
  sale_payment: [{ id: "pay1", sale_id: SALE, tipo_pagamento: "vista", entrada_valor: 180000 }],
  sale_documents: [],
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
      const set = new Set(
        v
          .slice(4, -1)
          .split(",")
          .map((s) => s.replace(/^"|"$/g, "")),
      );
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
    let json = {};
    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      json = {};
    }
    const u = userFrom(req);
    log.push(`${req.method} ${url.pathname}${url.search}`);

    if (url.pathname === "/__mock/reset") {
      tables = fresh(url.searchParams.get("aceita") === "1");
      // ?sync=1: estado DEPOIS da correção (gatilho já copiou 6% / R$ 10.800 para a ocorrência).
      if (url.searchParams.get("sync") === "1")
        Object.assign(tables.occurrences[0], { percentual_comissao: 6, valor_comissao: 10800 });
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__mock/log") return send(res, 200, log.splice(0));
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

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      if (fn === "current_org_id") return send(res, 200, ORG);
      if (fn === "is_platform_super_admin") return send(res, 200, false);
      if (fn === "sale_management_capabilities")
        return send(res, 200, { can_manage: true, can_edit: true });
      if (fn === "calcular_distribuicao_venda") return send(res, 200, distribuicao);
      if (fn === "data_assinatura_oficial") return send(res, 200, "2026-10-28");
      if (fn.startsWith("list_active_")) return send(res, 200, []);
      return send(res, 200, null);
    }

    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      let rows = tables[table] ?? [];
      if (req.method === "GET" || req.method === "HEAD") {
        rows = filterRows(rows, url.searchParams);
        if ((req.headers.accept || "").includes("vnd.pgrst.object")) {
          if (rows.length !== 1) {
            if (rows.length === 0 && url.searchParams.has("limit")) return send(res, 200, null);
            return send(res, 406, { code: "PGRST116", message: "no rows" });
          }
          return send(res, 200, rows[0]);
        }
        return send(res, 200, rows, {
          "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
        });
      }
      if (req.method === "PATCH") {
        const alvo = filterRows(rows, url.searchParams);
        for (const r of alvo) Object.assign(r, json);
        if ((req.headers.accept || "").includes("vnd.pgrst.object"))
          return send(res, 200, alvo[0] ?? null);
        return send(res, 200, alvo);
      }
      return send(res, 201, []);
    }
    return send(res, 404, { message: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${PORT}`));
