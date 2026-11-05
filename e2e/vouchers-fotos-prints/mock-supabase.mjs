// Mock local de Supabase para os prints do módulo "Agendar fotos" (t_d86ab990 / t_ee532309).
// Modelo: e2e/comemora-pergunta-login-prints. Dados 100% fictícios (@example.com), nenhuma chamada
// externa. Imita as regras das RPCs photo_* da migration 20261105120000 (a prova real é a suíte SQL).
// Usuários: corretora Ana, fotógrafo Fábio (staff), admin e financeiro. /__mock/reset zera o estado.
// /__mock/modulo?on=0 desliga o módulo (nada aparece).
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54461);
const ORG = "11111111-1111-4111-8111-111111111111";
const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FABIO = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const users = {
  "tok-ana": { id: ANA, email: "ana.corretora@example.com", nome: "Ana Corretora Fictícia", role: "corretor", tel: "(15) 99111-0001" },
  "tok-fabio": { id: FABIO, email: "fabio.foto@example.com", nome: "Fábio Fotógrafo Fictício", role: "staff", tel: "(15) 99111-0002" },
  "tok-admin": { id: ADMIN, email: "admin@example.com", nome: "Admin Fictício", role: "admin", tel: "(15) 99111-0003" },
  "tok-fin": { id: FIN, email: "financeiro@example.com", nome: "Financeiro Fictício", role: "financeiro", tel: "(15) 99111-0004" },
};
const byId = Object.fromEntries(Object.values(users).map((u) => [u.id, u]));

const SP = -3 * 3600_000;
const hojeSP = () => new Date(Date.now() + SP).toISOString().slice(0, 10);
const somar = (d, n) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const em = (dia, hh) => new Date(`${dia}T${hh}:00-03:00`).toISOString();
const H = 3600_000;

const CAPS = [
  { id: "c1000000-0000-4000-8000-000000000001", tipo: "Apartamento", endereco: "Rua das Flores, 120", complemento: "ap 42", bairro: "Jardim Exemplo" },
  { id: "c1000000-0000-4000-8000-000000000002", tipo: "Casa", endereco: "Av. Fictícia, 900", complemento: "", bairro: "Vila Modelo" },
  { id: "c1000000-0000-4000-8000-000000000003", tipo: "Sobrado", endereco: "Rua Teste, 55", complemento: "", bairro: "Centro" },
];
const label = (c) => [c.tipo, [c.endereco, c.complemento].filter(Boolean).join(", "), c.bairro].join(" · ");

let st;
const reset = () => {
  const hoje = hojeSP();
  const mes = hoje.slice(0, 8) + "01";
  const prox = new Date(`${mes}T12:00:00Z`);
  prox.setUTCMonth(prox.getUTCMonth() + 1);
  const vence = somar(prox.toISOString().slice(0, 10), 89);
  st = {
    modulo: true,
    settings: { fotografo_id: FABIO, valor_sessao: 350 },
    vouchers: [1, 2, 3].map((seq) => ({
      id: `v0000000-0000-4000-8000-00000000000${seq}`,
      corretor_id: ANA, mes_ref: mes, seq, gerado_em: new Date().toISOString(), vence_em: vence, status: "disponivel",
    })),
    assinadas: 3,
    faixas: [1, 2, 3, 5].map((d, i) => ({
      id: `f0000000-0000-4000-8000-00000000000${i}`, tipo: "livre", inicio: em(somar(hoje, d), "09:00"), fim: em(somar(hoje, d), "18:00"),
    })),
    sessoes: [],
    history: [],
    notifications: [],
    calls: [],
  };
  // Sessão já feita sem voucher (financeiro "a cobrar") e outra com voucher (RE/MAX paga), neste mês.
  const ontem = somar(hoje, -1);
  st.sessoes.push(
    sessao({ id: "s0000000-0000-4000-8000-000000000001", capture: CAPS[2].id, inicio: em(ontem, "10:00"), voucher: null, status: "feita", valor: 350, cobranca: "a_cobrar" }),
  );
  st.vouchers.push({ id: "v0000000-0000-4000-8000-000000000009", corretor_id: ANA, mes_ref: mes, seq: 4, gerado_em: new Date().toISOString(), vence_em: vence, status: "usado" });
  st.sessoes.push(
    sessao({ id: "s0000000-0000-4000-8000-000000000002", capture: CAPS[1].id, inicio: em(somar(hoje, -2), "14:00"), voucher: "v0000000-0000-4000-8000-000000000009", status: "feita", valor: 350 }),
  );
  st.assinadas = 4;
};
function sessao({ id, capture, inicio, voucher, status = "aguardando", valor = null, cobranca = null }) {
  const ini = new Date(inicio).getTime();
  return {
    id, organization_id: ORG, fotografo_id: FABIO, corretor_id: ANA, capture_id: capture, voucher_id: voucher,
    inicio: new Date(ini).toISOString(), fim: new Date(ini + 2 * H).toISOString(), ocupa_ate: new Date(ini + 3 * H).toISOString(),
    status, paga_por: voucher ? "imobiliaria" : "corretor", valor_congelado: valor, cobranca_status: cobranca,
    cobrado_em: null, feita_em: status === "feita" ? new Date().toISOString() : null, cancelada_em: null, cancelada_papel: null, motivo_cancelamento: null,
  };
}
const json = (s) => {
  const c = CAPS.find((x) => x.id === s.capture_id);
  return {
    ...s, corretor_nome: byId[s.corretor_id]?.nome, corretor_telefone: byId[s.corretor_id]?.tel,
    imovel: c ? label(c) : null, endereco: c ? `${c.endereco}${c.complemento ? ", " + c.complemento : ""}, ${c.bairro}, Sorocaba` : null,
  };
};
const ativa = (s) => s.status !== "cancelada" && s.status !== "recusada";
const statusV = (v) => (v.status === "disponivel" && v.vence_em < hojeSP() ? "vencido" : v.status);
const ehFot = (u) => u?.id === st.settings.fotografo_id && u.role === "staff";
const ehAdm = (u) => u?.role === "admin";
const ehFin = (u) => u?.role === "financeiro" || ehAdm(u);
const erro = (res, code, message) => send(res, code === "42501" ? 403 : 400, { code, message });
const hist = (u, s, acao, payload = {}) => st.history.push({ session_id: s.id, ator_id: u.id, acao, payload, at: Date.now() });
const sino = (s, evento) => {
  const para = { marcada: [s.fotografo_id], confirmada: [s.corretor_id], recusada: [s.corretor_id], desmarcada: [s.fotografo_id, s.corretor_id] }[evento];
  for (const p of para) st.notifications.push({ user_id: p, tipo: `foto_${evento}` });
};

function resumo(u) {
  const hoje = hojeSP();
  const mes = hoje.slice(0, 8) + "01";
  const minhas = st.sessoes.filter((s) => s.corretor_id === u.id);
  const pen = st.sessoes.filter((s) => s.corretor_id === u.id && s.status === "cancelada" && s.cancelada_papel === "corretor").length;
  return {
    hoje, eh_fotografo: ehFot(u), eh_admin: ehAdm(u), eh_financeiro: ehFin(u),
    fotografo_nome: byId[st.settings.fotografo_id]?.nome ?? null, fotografo_id: st.settings.fotografo_id, valor_sessao: st.settings.valor_sessao,
    mes: { mes_ref: mes, assinadas: u.id === ANA ? st.assinadas : 0, meta: 3, faltam: Math.max(0, 3 - (u.id === ANA ? st.assinadas : 0)), vence_em: st.vouchers[0]?.vence_em },
    bloqueado_ate: st.bloqueado?.[u.id] ?? null, desmarcacoes_30d: pen,
    vouchers: st.vouchers.filter((v) => v.corretor_id === u.id).map((v) => {
      const s = st.sessoes.find((x) => x.voucher_id === v.id && ativa(x));
      const c = s && CAPS.find((x) => x.id === s.capture_id);
      return { ...v, status: statusV(v), sessao_id: s?.id ?? null, imovel: c ? label(c) : null };
    }),
    imoveis: u.id === ANA ? CAPS.map((c) => ({
      id: c.id, imovel: label(c),
      tem_sessao_aberta: st.sessoes.some((s) => s.capture_id === c.id && ["aguardando", "confirmada"].includes(s.status)),
      voucher_ja_usado: st.sessoes.some((s) => s.capture_id === c.id && s.voucher_id && ativa(s)),
    })) : [],
    minhas_sessoes: minhas.map(json).sort((a, b) => b.inicio.localeCompare(a.inicio)),
  };
}
function livres(de, ate) {
  const out = [];
  for (const f of st.faixas.filter((x) => x.tipo === "livre")) {
    for (let t = new Date(f.inicio).getTime(); t + 2 * H <= new Date(f.fim).getTime(); t += H / 2) {
      const dia = new Date(t + SP).toISOString().slice(0, 10);
      if (dia < de || dia > ate || t <= Date.now()) continue;
      if (st.faixas.some((b) => b.tipo === "bloqueio" && new Date(b.inicio).getTime() < t + 2 * H && new Date(b.fim).getTime() > t)) continue;
      if (st.sessoes.some((s) => ativa(s) && new Date(s.inicio).getTime() < t + 3 * H && new Date(s.ocupa_ate).getTime() > t)) continue;
      out.push(new Date(t).toISOString());
    }
  }
  return [...new Set(out)].sort();
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, {
    "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-expose-headers": "content-range", ...extra,
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const userFrom = (req) => {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  for (const [k, u] of Object.entries(users)) if (tok.includes(k)) return u;
  if (tok.includes("mock-service-key")) return { id: null, role: "service" };
  return null;
};
reset();

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let body = "";
  for await (const ch of req) body += ch;
  let a = {};
  try { a = body ? JSON.parse(body) : {}; } catch { a = {}; }
  const u = userFrom(req);
  if (url.pathname === "/avatar-ficticio.png") {
    // PNG 1x1 cinza (foto fictícia para o perfil não pedir "Complete seu cadastro").
    res.writeHead(200, { "content-type": "image/png", "access-control-allow-origin": "*" });
    return res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64"));
  }
  if (url.pathname === "/__mock/reset") { reset(); return send(res, 200, { ok: true }); }
  if (url.pathname === "/__mock/state") return send(res, 200, st);
  if (url.pathname === "/__mock/modulo") { st.modulo = url.searchParams.get("on") === "1"; return send(res, 200, { modulo: st.modulo }); }
  if (url.pathname.startsWith("/auth/v1/user")) {
    if (!u || !u.id) return send(res, 401, { msg: "invalid jwt" });
    return send(res, 200, { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, created_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: { nome: u.nome } });
  }
  if (url.pathname.startsWith("/auth/v1/")) return send(res, 200, {});
  if (url.pathname.startsWith("/functions/v1/")) return send(res, 200, { ok: true });
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.slice("/rest/v1/rpc/".length);
    st.calls.push({ fn, by: u?.id ?? null, args: a });
    if (fn === "current_org_id") return send(res, 200, ORG);
    if (fn === "is_platform_super_admin") return send(res, 200, false);
    if (fn === "platform_current_org") return send(res, 200, null);
    if (fn === "exclusive_capture_enabled") return send(res, 200, true);
    if (fn === "vouchers_fotos_enabled") return send(res, 200, st.modulo);
    if (fn === "ficha_minha_situacao") return send(res, 200, { aplica: false, completa: true, bloqueia: false, cadastro_completo: true, cadastro_pendente: [] });
    if (fn === "comemora_pergunta_pendente") return send(res, 200, false);
    if (fn === "exclusive_profile_registration") return send(res, 200, u ? [{ user_id: u.id, cpf: "529.982.247-25", creci: "123456-F" }] : []);
    if (["minhas_pendencias", "minhas_captacoes", "meu_realizado", "carreira_clube_selos", "achievement_feed", "situacao_venda_lista", "captacao_situacao_venda_lista"].includes(fn)) return send(res, 200, []);
    if (fn.startsWith("photo_") && !st.modulo) return erro(res, "42501", "Modulo Agendar fotos desligado");
    if (fn === "photo_meu_resumo") return send(res, 200, resumo(u));
    if (fn === "photo_horarios_livres") return send(res, 200, livres(a._de, a._ate));
    if (fn === "photo_agenda_listar") {
      if (!ehFot(u) && !ehAdm(u)) return erro(res, "42501", "Apenas o fotografo ou o admin veem a agenda");
      const ini = new Date(`${a._de}T00:00:00-03:00`).getTime();
      const fim = new Date(`${somar(a._ate, 1)}T00:00:00-03:00`).getTime();
      const dentro = (x) => new Date(x.inicio).getTime() >= ini && new Date(x.inicio).getTime() < fim;
      return send(res, 200, { faixas: st.faixas.filter(dentro), sessoes: st.sessoes.filter(dentro).map(json).sort((x, y) => x.inicio.localeCompare(y.inicio)) });
    }
    if (fn === "photo_agendar") {
      if (st.bloqueado?.[u.id]) return erro(res, "42501", "Agendamento bloqueado ate ...");
      if (!livres(hojeSP(), somar(hojeSP(), 62)).includes(new Date(a._inicio).toISOString())) return send(res, 409, { code: "23P01", message: "Horario indisponivel (sessao de 2 h + 1 h de intervalo)" });
      const v = a._voucher && st.vouchers.find((x) => x.id === a._voucher && x.corretor_id === u.id);
      if (a._voucher && (!v || v.status !== "disponivel")) return erro(res, "22023", "Este voucher nao esta disponivel");
      if (v && st.sessoes.some((s) => s.capture_id === a._capture && s.voucher_id && ativa(s))) return erro(res, "22023", "Este imovel ja usou um voucher (1 por imovel)");
      const s = sessao({ id: crypto.randomUUID(), capture: a._capture, inicio: a._inicio, voucher: a._voucher ?? null });
      st.sessoes.push(s);
      if (v) v.status = "agendado";
      hist(u, s, "marcada"); sino(s, "marcada");
      return send(res, 200, s.id);
    }
    if (fn === "photo_responder") {
      const s = st.sessoes.find((x) => x.id === a._session);
      if (!ehFot(u) && !ehAdm(u)) return erro(res, "42501", "Apenas o fotografo ou o admin confirmam");
      if (!s || s.status !== "aguardando") return erro(res, "22023", "So sessoes aguardando confirmacao");
      const papel = ehAdm(u) ? "admin" : "fotografo";
      if (a._confirmar) s.status = "confirmada";
      else {
        Object.assign(s, { status: "recusada", cancelada_em: new Date().toISOString(), cancelada_papel: papel, motivo_cancelamento: a._motivo });
        const v = st.vouchers.find((x) => x.id === s.voucher_id); if (v && v.status === "agendado") v.status = "disponivel";
      }
      const ev = a._confirmar ? "confirmada" : "recusada";
      hist(u, s, ev, { papel }); sino(s, ev);
      return send(res, 200, s.status);
    }
    if (fn === "photo_desmarcar") {
      const s = st.sessoes.find((x) => x.id === a._session);
      if (!s || !["aguardando", "confirmada"].includes(s.status)) return erro(res, "22023", "So sessoes marcadas podem ser desmarcadas");
      const papel = s.corretor_id === u.id ? "corretor" : ehAdm(u) ? "admin" : ehFot(u) ? "fotografo" : null;
      if (!papel) return erro(res, "42501", "Sem permissao para desmarcar");
      Object.assign(s, { status: "cancelada", cancelada_em: new Date().toISOString(), cancelada_papel: papel, motivo_cancelamento: a._motivo });
      const v = st.vouchers.find((x) => x.id === s.voucher_id); if (v && v.status === "agendado") v.status = "disponivel";
      const qtd = papel === "corretor" ? st.sessoes.filter((x) => x.corretor_id === s.corretor_id && x.status === "cancelada" && x.cancelada_papel === "corretor").length : 0;
      let bloq = null;
      if (qtd >= 3) { bloq = new Date(Date.now() + 7 * 24 * H).toISOString(); st.bloqueado = { ...(st.bloqueado || {}), [s.corretor_id]: bloq }; }
      hist(u, s, "desmarcada", { papel }); sino(s, "desmarcada");
      return send(res, 200, { papel, desmarcacoes_30d: qtd, bloqueado_ate: bloq });
    }
    if (fn === "photo_marcar_feita") {
      const s = st.sessoes.find((x) => x.id === a._session);
      if (!s || new Date(s.inicio).getTime() > Date.now()) return erro(res, "22023", "A sessao ainda nao comecou");
      Object.assign(s, { status: "feita", valor_congelado: st.settings.valor_sessao, cobranca_status: s.paga_por === "corretor" ? "a_cobrar" : null });
      return send(res, 200, { valor_congelado: st.settings.valor_sessao });
    }
    if (fn === "photo_financeiro") {
      if (!ehFin(u)) return erro(res, "42501", "Apenas o Financeiro ou o admin");
      const mes = a._mes.slice(0, 7);
      const doMes = st.sessoes.filter((s) => s.status === "feita" && new Date(new Date(s.inicio).getTime() + SP).toISOString().slice(0, 7) === mes);
      const remax = doMes.filter((s) => s.paga_por === "imobiliaria");
      const cobrar = doMes.filter((s) => s.paga_por === "corretor");
      return send(res, 200, {
        mes_ref: `${mes}-01`, remax: remax.map(json), remax_total: remax.reduce((t, s) => t + s.valor_congelado, 0),
        a_cobrar: cobrar.map(json), a_cobrar_total: cobrar.filter((s) => s.cobranca_status === "a_cobrar").reduce((t, s) => t + s.valor_congelado, 0),
      });
    }
    if (fn === "photo_marcar_cobrado") {
      if (!ehFin(u)) return erro(res, "42501", "Apenas o Financeiro ou o admin");
      const s = st.sessoes.find((x) => x.id === a._session);
      s.cobranca_status = a._cobrado === false ? "a_cobrar" : "cobrado";
      return send(res, 200, a._cobrado !== false);
    }
    if (fn === "photo_staff_listar") return ehAdm(u) ? send(res, 200, [{ id: FABIO, nome: byId[FABIO].nome }]) : erro(res, "42501", "Apenas o admin configura");
    if (fn === "photo_configurar") {
      if (!ehAdm(u)) return erro(res, "42501", "Apenas o admin configura");
      st.settings = { fotografo_id: a._fotografo, valor_sessao: a._valor };
      return send(res, 200, st.settings);
    }
    if (fn === "photo_faixa_salvar") {
      const f = { id: crypto.randomUUID(), tipo: a._tipo, inicio: new Date(a._inicio).toISOString(), fim: new Date(a._fim).toISOString() };
      st.faixas.push(f);
      return send(res, 200, f.id);
    }
    if (fn === "photo_faixa_remover") { st.faixas = st.faixas.filter((f) => f.id !== a._id); return send(res, 200, true); }
    if (fn === "photo_aviso_para_envio") {
      const s = st.sessoes.find((x) => x.id === a._session);
      const h = [...st.history].reverse().find((x) => x.session_id === a._session);
      if (!s || !h || h.acao !== a._evento || h.ator_id !== u?.id) return send(res, 200, null);
      const dest = { marcada: [s.fotografo_id], confirmada: [s.corretor_id], recusada: [s.corretor_id], desmarcada: [s.fotografo_id, s.corretor_id] }[a._evento].filter((x) => x !== u.id);
      return send(res, 200, { organization_id: ORG, capture_id: s.capture_id, tipo: `foto_${a._evento}`, titulo: `Aviso ${a._evento}`, mensagem: "texto fictício", destinos: dest });
    }
    return send(res, 200, null);
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length);
    const one = (req.headers.accept || "").includes("vnd.pgrst.object");
    if (req.method !== "GET") { st.calls.push({ table, method: req.method, by: u?.id ?? null, body: a }); return send(res, 201, one ? {} : []); }
    const todos = u?.role === "admin" || u?.role === "service";
    const eqId = (url.searchParams.get("id") || url.searchParams.get("user_id") || "").replace(/^eq\./, "");
    let rows = [];
    if (table === "user_roles") rows = (todos ? Object.values(users) : u ? [u] : []).map((x) => ({ role: x.role, organization_id: ORG, user_id: x.id, notificar_whatsapp: true, notificar_toda_atualizacao: true }));
    if (table === "profiles") {
      rows = (todos ? Object.values(users) : u ? [u] : []).map((x) => ({ id: x.id, nome: x.nome, email: x.email, telefone: x.tel, ativo: true, avatar_url: `http://127.0.0.1:${PORT}/avatar-ficticio.png`, cpf: "529.982.247-25", creci: "123456-F", organization_id: ORG }));
      if (eqId) rows = rows.filter((r) => r.id === eqId);
    }
    if (table === "organization_members") rows = (todos ? Object.values(users) : u ? [u] : []).map((x) => ({ organization_id: ORG, user_id: x.id, ativo: true, participa_sessenta: false }));
    if (table === "organizations") rows = [{ id: ORG, slug: "ficticia", nome: "Imobiliária Fictícia", status: "ativa" }];
    if (table === "exclusive_captures" && u?.id === ANA)
      rows = CAPS.map((c, i) => ({
        id: c.id, organization_id: ORG, captor_id: ANA, captador_original_id: null, status: "aprovada", manual: false, broker_name: users["tok-ana"].nome,
        created_at: `2026-11-0${i + 1}T12:00:00Z`, created_on_sp: `0${i + 1}/11/2026`, signed_on: `2026-11-0${i + 1}`, valid_until: "2027-05-01", archived_at: null, discarded_at: null, unit_id: null,
        form_data: { imovel: { tipo_imovel: c.tipo, endereco: c.endereco, complemento: c.complemento, bairro: c.bairro, municipio: "Sorocaba" }, proprietario_1: { nome_completo: "Proprietário Fictício" } },
      }));
    if (one) return rows.length === 1 ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", message: "no rows" });
    return send(res, 200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
  }
  return send(res, 404, { message: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${PORT}`));
