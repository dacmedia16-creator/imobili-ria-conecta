// Mock local de Supabase para os prints da pergunta "Comemora aniversário?" no login (t_05a37081),
// copiado do mock do PR #265 (t_2d5f0ab6) + comemora_pergunta_pendente/comemora_responder.
// /__mock/falhar?on=1 faz a gravação da resposta falhar (teste do "não trava").
// Origem: mock do "Você comemora aniversário?" (t_2d5f0ab6), copiado do mock
// da "Data de nascimento" (t_dff88e75). Dados 100% fictícios (@example.com), nenhuma chamada externa.
// Usuários: admin, corretor antigo e corretor novo. Estado em memória, reiniciável em /__mock/reset.
// O mural (achievement_birthdays) imita o filtro do banco: só quem comemora aparece.
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
  // Aniversários no mês atual para o mural (dia 07 e 09); o admin não comemora.
  const mes = String(new Date().getUTCMonth() + 1).padStart(2, "0");
  st = {
    birth: { [ADMIN]: `1980-${mes}-10`, [ANTIGO]: `1990-${mes}-07` },
    comemora: { [ADMIN]: false, [ANTIGO]: true },
    // Ninguém respondeu ainda (igual à produção antes da janela).
    respondido: {},
    falhar: false,
    calls: [],
  };
};
const gravar = (id, data, comemora, marcar = true) => {
  if (data == null) {
    delete st.birth[id];
    delete st.comemora[id];
    delete st.respondido[id];
    return;
  }
  const existia = id in st.birth;
  st.birth[id] = data;
  // Igual ao banco: NULL mantém o que estava; registro novo nasce Sim.
  if (comemora != null) st.comemora[id] = comemora;
  if (comemora != null && marcar) st.respondido[id] = true;
  else if (!existia) st.comemora[id] = true;
};
const fichaSituacao = (id) => ({
  aplica: true,
  completa: true,
  cadastro_completo: true,
  cadastro_pendente: [],
  cadastro_exige_registro: false,
  obrigatoria_a_partir_de: "2026-10-30T04:30:00Z",
  bloqueia: false,
  data_nascimento: st.birth[id] ?? null,
  comemora_aniversario: st.comemora[id] ?? true,
  ficha: {
    qtd_filhos: 0,
    filhos_faixas: [],
    tem_plano_saude: false,
    plano_saude: null,
    emergencia_nome: "Maria Exemplo",
    emergencia_parentesco: "Mãe",
    emergencia_telefone: "(15) 99123-4567",
    hospital_preferencia: "Hospital Exemplo",
    religiao: null,
    aceite_em: "2026-10-29T10:00:00Z",
    updated_at: "2026-10-29T10:00:00Z",
  },
});
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
    if (url.pathname === "/__mock/falhar") {
      st.falhar = url.searchParams.get("on") === "1";
      return send(res, 200, { falhar: st.falhar });
    }
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
        if (json._data != null && !valida(json._data))
          return send(res, 400, { code: "22023", message: "Data de nascimento invalida" });
        gravar(u.id, json._data, json._comemora);
        return send(res, 200, json._data ?? null);
      }
      if (
        fn === "profile_birthdate_get_for_user" ||
        fn === "profile_birthdate_info_for_user" ||
        fn === "profile_birthdate_set_for_user"
      ) {
        const alvo = json._user;
        if (u?.role !== "admin" || !byId[alvo] || alvo === u.id)
          return send(res, 403, { code: "42501", message: "Sem permissao" });
        if (fn === "profile_birthdate_get_for_user") return send(res, 200, st.birth[alvo] ?? null);
        if (fn === "profile_birthdate_info_for_user")
          return send(res, 200, {
            data_nascimento: st.birth[alvo] ?? null,
            comemora_aniversario: st.comemora[alvo] ?? true,
          });
        if (json._data != null && !valida(json._data))
          return send(res, 400, { code: "22023", message: "Data de nascimento invalida" });
        gravar(alvo, json._data, json._comemora, false);
        return send(res, 200, json._data ?? null);
      }
      if (fn === "comemora_pergunta_pendente") {
        if (!u?.id) return send(res, 200, false);
        return send(res, 200, Boolean(st.birth[u.id]) && !st.respondido[u.id]);
      }
      if (fn === "comemora_responder") {
        if (!u?.id) return send(res, 401, { code: "42501", message: "Sem sessao" });
        if (st.falhar) return send(res, 503, { code: "57014", message: "canceling statement due to statement timeout" });
        if (!st.birth[u.id]) return send(res, 404, { code: "P0002", message: "Sem data de nascimento cadastrada" });
        st.comemora[u.id] = json._comemora;
        st.respondido[u.id] = true;
        return send(res, 200, json._comemora);
      }
      if (fn === "achievements_enabled") return send(res, 200, true);
      if (fn === "achievement_birthdays") {
        const lista = Object.entries(st.birth)
          .filter(([id, d]) => st.comemora[id] !== false && Number(d.slice(5, 7)) === json._mes)
          .map(([id, d]) => ({
            user_id: id,
            nome: byId[id]?.nome ?? "?",
            avatar_url: null,
            dia: Number(d.slice(8, 10)),
            mes: Number(d.slice(5, 7)),
          }))
          .sort((a, b) => a.dia - b.dia);
        return send(res, 200, lista);
      }
      if (
        fn === "achievement_feed" ||
        fn === "achievement_ranking" ||
        fn === "achievement_cheerers" ||
        fn === "carreira_clube_selos"
      )
        return send(res, 200, []);
      if (fn === "ficha_minha_situacao") {
        if (!u?.id) return send(res, 401, { code: "42501", message: "Sem sessao" });
        return send(res, 200, fichaSituacao(u.id));
      }
      if (fn === "ficha_salvar_minha") {
        if (!u?.id) return send(res, 401, { code: "42501", message: "Sem sessao" });
        gravar(u.id, json._data_nascimento, json._comemora_aniversario);
        return send(res, 200, fichaSituacao(u.id));
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
        rows =
          u?.id && st.birth[u.id]
            ? [
                {
                  user_id: u.id,
                  data_nascimento: st.birth[u.id],
                  comemora_aniversario: st.comemora[u.id] ?? true,
                },
              ]
            : [];
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
