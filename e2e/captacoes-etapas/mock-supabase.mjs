// Mock local de Supabase (GoTrue + PostgREST) para o teste de tela da lista de captações com
// etapas visíveis (t_abf93125). Dados 100% fictícios (@example.com); nenhuma chamada externa.
// Equipes: Gina (gestora) lidera Ana; Hugo (gestor) lidera Caio. O mock devolve TODAS as captações
// para os dois gestores (imita o caso "gestor enxerga outras equipes") para provar que o selo
// "Sua vez" só aparece nas captações da equipe de quem está olhando.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54397);
const ORG = "11111111-1111-4111-8111-111111111111";
const UNIT = "ffffffff-ffff-4fff-8fff-ffffffffffff";
export const U = {
  ana: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  gina: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  hugo: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  caio: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const users = {
  "tok-ana": {
    id: U.ana,
    email: "ana@example.com",
    nome: "Ana Corretora Fictícia",
    role: "corretor",
  },
  "tok-gina": {
    id: U.gina,
    email: "gina@example.com",
    nome: "Gina Gestora Fictícia",
    role: "gestor",
  },
  "tok-hugo": {
    id: U.hugo,
    email: "hugo@example.com",
    nome: "Hugo Gestor Fictício",
    role: "gestor",
  },
  "tok-caio": {
    id: U.caio,
    email: "caio@example.com",
    nome: "Caio Corretor Fictício",
    role: "corretor",
  },
};
const TEAM_G = "12121212-1212-4212-8212-121212121212";
const TEAM_H = "13131313-1313-4313-8313-131313131313";

let seq = 0;
const cap = (captor, broker, status, endereco, bairro, proprietario, extra = {}) => ({
  id: `eeeeeeee-eeee-4eee-8eee-${String(++seq).padStart(12, "0")}`,
  organization_id: ORG,
  unit_id: UNIT,
  captor_id: captor,
  created_by: captor,
  broker_name: broker,
  broker_cpf: "",
  broker_creci: "",
  template: "remax-padrao",
  status,
  manual: false,
  archived_at: null,
  signed_on: status === "aprovada" ? "2026-11-03" : null,
  created_on_sp: `2026-11-${String(10 - seq).padStart(2, "0")}`,
  created_at: `2026-11-${String(10 - seq).padStart(2, "0")}T12:00:00Z`,
  updated_at: `2026-11-${String(10 - seq).padStart(2, "0")}T12:00:00Z`,
  form_data: {
    proprietario_1: { nome_completo: proprietario },
    imovel: { endereco, bairro, municipio: "Sorocaba", estado: "São Paulo", tipo: "Casa" },
  },
  ...extra,
});

const captures = [
  cap(
    U.ana,
    "Ana Corretora Fictícia",
    "enviada",
    "Rua das Acácias, 120",
    "Jd. Exemplo",
    "Proprietário Fictício A",
  ),
  cap(
    U.caio,
    "Caio Corretor Fictício",
    "enviada",
    "Av. Modelo, 900",
    "Centro",
    "Proprietária Fictícia B",
  ),
  cap(
    U.ana,
    "Ana Corretora Fictícia",
    "devolvida",
    "Rua Exemplo, 77",
    "Vila Fictícia",
    "Proprietário Fictício D",
  ),
  cap(
    U.gina,
    "Gina Gestora Fictícia",
    "em_assinatura",
    "Rua Teste, 45",
    "Campolim",
    "Proprietária Fictícia C",
  ),
  cap(
    U.ana,
    "Ana Corretora Fictícia",
    "rascunho",
    "Rua Rascunho, 10",
    "Jd. Fictício",
    "Proprietário Fictício E",
  ),
  cap(
    U.caio,
    "Caio Corretor Fictício",
    "aprovada",
    "Rua Aprovada, 300",
    "Barão",
    "Proprietária Fictícia F",
  ),
];

function visiveis(u) {
  // Corretor só vê as dele (como a RLS); gestores veem todas (caso da queixa).
  if (!u) return [];
  if (u.role === "corretor") return captures.filter((c) => c.captor_id === u.id);
  return captures;
}

const tables = (u) => ({
  user_roles: Object.values(users).map((x) => ({
    organization_id: ORG,
    user_id: x.id,
    role: x.role,
  })),
  organization_members: Object.values(users).map((x) => ({
    organization_id: ORG,
    user_id: x.id,
    ativo: true,
  })),
  organizations: [
    {
      id: ORG,
      slug: "ficticia",
      nome: "Imobiliária Fictícia",
      status: "ativa",
      legacy_default: true,
    },
  ],
  profiles: Object.values(users).map((x) => ({
    id: x.id,
    nome: x.nome,
    organization_id: ORG,
    ativo: true,
  })),
  teams: [
    {
      id: TEAM_G,
      nome: "Equipe Gina",
      lider_id: U.gina,
      parent_team_id: null,
      organization_id: ORG,
    },
    {
      id: TEAM_H,
      nome: "Equipe Hugo",
      lider_id: U.hugo,
      parent_team_id: null,
      organization_id: ORG,
    },
  ],
  team_members: [
    { team_id: TEAM_G, membro_id: U.ana },
    { team_id: TEAM_H, membro_id: U.caio },
  ],
  team_co_leaders: [],
  exclusive_captures: visiveis(u),
  exclusive_units: [
    {
      id: UNIT,
      organization_id: ORG,
      nome: "Unidade Fictícia",
      creci: "99999-J",
      razao_social: "FICTICIA LTDA",
      endereco: "Rua Exemplo, 100",
      cidade: "Sorocaba",
      estado: "São Paulo",
      cnpj: "11.222.333/0001-81",
      nome_comercial: "RE/MAX FICTÍCIA",
      legacy_template: null,
      contrato_antigo: false,
      ativo: true,
    },
  ],
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
function filterRows(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    if (v.startsWith("eq.")) out = out.filter((r) => String(r[k]) === v.slice(3));
    if (v.startsWith("in.(")) {
      const set = new Set(
        v
          .slice(4, -1)
          .split(",")
          .map((s) => s.replace(/"/g, "")),
      );
      out = out.filter((r) => set.has(String(r[k])));
    }
    if (v === "is.null") out = out.filter((r) => r[k] == null);
  }
  return out;
}

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") return send(res, 204);
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    for await (const _ of req);
    const u = userFrom(req);
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
    if (url.pathname.startsWith("/storage/v1/")) return send(res, 200, {});
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      if (fn === "current_org_id") return send(res, 200, ORG);
      if (fn === "is_platform_super_admin") return send(res, 200, false);
      if (fn === "exclusive_capture_enabled") return send(res, 200, true);
      if (fn === "exclusive_situacao_venda_lista") return send(res, 200, []);
      return send(res, 200, null);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      let rows = filterRows(tables(u)[table] ?? [], url.searchParams);
      if ((req.headers.accept || "").includes("vnd.pgrst.object")) {
        if (rows.length !== 1)
          return send(res, 406, { code: "PGRST116", message: "rows", details: "0 rows" });
        return send(res, 200, rows[0]);
      }
      return send(res, 200, rows, {
        "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
      });
    }
    return send(res, 404, { message: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${PORT}`));
