// Robô da sincronização ADM MAX -> Estudo de Mercado e Visita Prova (etapa 1, cartão t_41bcad66).
// Sem dependências do Deno (testável com vitest). Envia o ESTADO ATUAL da pessoa (idempotente), assinado
// com HMAC por satélite. O ADM nunca guarda a chave mestra dos satélites.
/* eslint-disable @typescript-eslint/no-explicit-any -- respostas JSON dos satélites e cliente supabase-js (Deno) sem tipos gerados */

export type Modo = "off" | "dry_run" | "live";
export type Satelite = "estudo" | "visita" | "sessenta";
const ORDEM: Record<Modo, number> = { off: 0, dry_run: 1, live: 2 };

export function modoEfetivo(...modos: unknown[]): Modo {
  let atual: Modo = "live";
  for (const m of modos) {
    const v: Modo = m === "live" || m === "dry_run" || m === "off" ? m : "off";
    if (ORDEM[v] < ORDEM[atual]) atual = v;
  }
  return atual;
}

// ---------- Tradução de papéis (tabela 4.1 aprovada) ----------
const ESTUDO: Record<string, "owner" | "manager" | "agent"> = {
  admin: "owner",
  gestor: "manager",
  coordenador: "manager",
  team_leader: "manager",
  corretor: "agent",
};
const VISITA: Record<string, "imobiliaria_admin" | "corretor"> = {
  admin: "imobiliaria_admin",
  gestor: "imobiliaria_admin",
  coordenador: "imobiliaria_admin",
  team_leader: "imobiliaria_admin",
  corretor: "corretor",
};
const RANK_E = { agent: 1, manager: 2, owner: 3 } as const;
const RANK_V = { corretor: 1, imobiliaria_admin: 2 } as const;

/** O 60 Dias MAX (t_46bd77c2) usa a mesma tabela de papéis do Estudo (owner/manager/agent). */
const comoEstudo = (sat: Satelite) => sat === "estudo" || sat === "sessenta";

/** Papel de maior acesso entre os que dão acesso ao satélite; "none" se nenhum (juridico, financeiro...). */
export function papelNoSatelite(roles: string[], sat: Satelite): string {
  let melhor = "none";
  let rank = 0;
  for (const r of roles) {
    const p = comoEstudo(sat) ? ESTUDO[r] : VISITA[r];
    if (!p) continue;
    const k = comoEstudo(sat) ? RANK_E[p as keyof typeof RANK_E] : RANK_V[p as keyof typeof RANK_V];
    if (k > rank) {
      rank = k;
      melhor = p;
    }
  }
  return melhor;
}

export type LinhaEstado = {
  adm_user_id: string;
  org_id: string | null;
  email: string | null;
  nome: string | null;
  telefone: string | null;
  ativo: boolean;
  roles: string[];
  lider_email: string | null;
  /** "Participa do 60 Dias MAX" (organization_members.participa_sessenta). Ausente = false. */
  participa_sessenta?: boolean;
};

/**
 * Quem vai ao 60 Dias MAX (regra de Denis, 16/10, t_2ea96382): dono (owner) e gestor (manager) sempre;
 * corretor (agent) só com "Participa do 60 Dias MAX" ligado. Ninguém entra por data. Os demais satélites
 * não mudam. Quem fica de fora NÃO é enviado: nada é criado e nada é desativado no 60 Dias.
 */
export function vaiAoSatelite(l: LinhaEstado, sat: Satelite): boolean {
  if (sat !== "sessenta") return true;
  const papel = papelNoSatelite(l.roles, sat);
  if (papel === "owner" || papel === "manager") return true;
  return papel === "agent" && l.participa_sessenta === true;
}

export type Mapa = {
  adm_org_id: string;
  estudo_org_id: string | null;
  visita_imobiliaria_id: string | null;
  mode: Modo;
  estudo_enabled: boolean;
  visita_enabled: boolean;
  /** 60 Dias MAX: opcional por imobiliária, ligado à mão (ausente = desligado). */
  sessenta_org_id?: string | null;
  sessenta_enabled?: boolean;
  /** t_cbc7cc69 etapa 1: equipes do ADM vão ao Visita (ausente = desligado). */
  visita_equipes?: boolean;
  /** t_cbc7cc69 etapa 2: TL puro vai ao Visita como corretor-líder (só com visita_equipes). */
  visita_tl_lider?: boolean;
  /** Chave da etapa 1 acabou de ser desligada: mandar ligado=false ao Visita uma vez. */
  visita_equipes_desligar_pendente?: boolean;
};

/** Satélites que recebem PESSOAS desta imobiliária. O 60 Dias só entra com sessenta_enabled === true. */
export function alvosDoMapa(mapa: Mapa): Array<[Satelite, string | null, boolean]> {
  return [
    ["estudo", mapa.estudo_org_id, mapa.estudo_enabled],
    ["visita", mapa.visita_imobiliaria_id, mapa.visita_enabled],
    ["sessenta", mapa.sessenta_org_id ?? null, mapa.sessenta_enabled === true],
  ];
}

/** Pessoa fora da sincronização: super_admin (nunca mexe) ou sem e-mail. */
export function foraDaSync(l: LinhaEstado): string | null {
  if (l.roles.includes("super_admin")) return "super_admin";
  if (!l.email || !l.email.includes("@")) return "sem_email";
  return null;
}

/**
 * t_cbc7cc69 (etapa 2, chave visita_tl_lider): no Visita, quem é SÓ team_leader (sem admin/gestor/coordenador)
 * entra como "corretor" e enxerga a própria equipe pelo papel de líder (equipes.lider_id/colideres, que vêm do ADM
 * na etapa 1). Gestor+TL continua imobiliaria_admin (decisão 1 de Denis). Chave desligada = tabela 4.1 de sempre.
 */
export function papelVisita(roles: string[], tlLider: boolean): string {
  const base = papelNoSatelite(roles, "visita");
  if (!tlLider || base !== "imobiliaria_admin") return base;
  const acimaDeTl = roles.some((r) => r === "admin" || r === "gestor" || r === "coordenador");
  return acimaDeTl ? base : "corretor";
}

/** Etapa 2 só vale com a etapa 1 ligada: sem equipes no Visita, o TL rebaixado ficaria sem enxergar ninguém. */
export const tlComoLider = (mapa: Partial<Mapa>) =>
  mapa.visita_tl_lider === true && mapa.visita_equipes === true;

/** Monta a pessoa no formato do satélite (só campos mínimos; sem CPF, CRECI, remax_id etc.). */
export function pessoaParaSatelite(
  l: LinhaEstado,
  sat: Satelite,
  opts: { tlLider?: boolean } = {},
) {
  return {
    adm_user_id: l.adm_user_id,
    email: String(l.email).trim().toLowerCase(),
    nome: String(l.nome ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    telefone: l.telefone ?? null,
    papel:
      sat === "visita"
        ? papelVisita(l.roles, opts.tlLider === true)
        : papelNoSatelite(l.roles, sat),
    ativo: l.ativo === true,
    lider_email: comoEstudo(sat) ? l.lider_email : null,
    // t_4d901b13: só o Visita recebe a marca de "admin de verdade" (Configurações/Assinatura). Gestor/TL = false.
    ...(sat === "visita" ? { admin_adm: (l.roles ?? []).includes("admin") } : {}),
  };
}

// ---------- HMAC (mesmo formato do receptor: x-adm-sync-signature: v1=<hex>) ----------
const enc = new TextEncoder();
export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function assinarPedido(
  secret: string,
  dados: Record<string, unknown>,
  agoraSeg = Math.floor(Date.now() / 1000),
) {
  const corpo = JSON.stringify({ ...dados, iat: agoraSeg, jti: crypto.randomUUID() });
  return { corpo, assinatura: `v1=${await hmacHex(secret, corpo)}` };
}

export function segredoInternoOk(recebido: string | null, esperado: string | undefined): boolean {
  if (!esperado || esperado.length < 32 || !recebido || recebido.length !== esperado.length)
    return false;
  let r = 0;
  for (let i = 0; i < esperado.length; i++) r |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return r === 0;
}

// ---------- Execução ----------
// deno-lint-ignore no-explicit-any
type Admin = any;
export type Envio = (
  sat: Satelite,
  corpo: string,
  assinatura: string,
) => Promise<{ status: number; json: any }>;
export type Ambiente = { segredos: Partial<Record<Satelite, string>>; enviar: Envio };

type Resultado = {
  adm_user_id: string;
  acoes: string[];
  resultado: string;
  conflito: { tipo: string; candidatos?: unknown } | null;
  avisos: string[];
  erro: string | null;
  detalhes?: string[];
  email?: string;
};

async function ok<T>(p: PromiseLike<{ data?: T; error: unknown }>, etapa: string): Promise<T> {
  const r = await p;
  if (r.error) throw new Error(`${etapa}: ${(r.error as { message?: string }).message ?? "erro"}`);
  return r.data as T;
}

/** Lista de exclusão persistente (sync_exclusoes): adm_user_id -> satélites onde a pessoa nunca é enviada. */
export async function carregarExclusoes(admin: Admin): Promise<Map<string, Set<Satelite>>> {
  const rows = await ok<Array<{ adm_user_id: string; satelite: Satelite }>>(
    admin.from("sync_exclusoes").select("adm_user_id,satelite"),
    "exclusoes",
  );
  const m = new Map<string, Set<Satelite>>();
  for (const r of rows ?? []) {
    const s = m.get(r.adm_user_id) ?? new Set<Satelite>();
    s.add(r.satelite);
    m.set(r.adm_user_id, s);
  }
  return m;
}

export function excluido(ex: Map<string, Set<Satelite>>, admUserId: string, sat: Satelite) {
  return ex.get(admUserId)?.has(sat) === true;
}

/**
 * Abre o conflito na fila humana (sync_conflicts). O índice único é PARCIAL (where status='aberto'), e o
 * PostgREST não manda esse predicado no ON CONFLICT (o Postgres responde 42P10). Por isso: insert simples;
 * duplicidade (23505) = já existe um conflito aberto igual, o que é ok. Qualquer outro erro é devolvido.
 */
export async function registrarConflito(
  admin: Admin,
  admUserId: string,
  sat: Satelite,
  conflito: { tipo: string; candidatos?: unknown },
): Promise<string | null> {
  const { error } = await admin.from("sync_conflicts").insert({
    adm_user_id: admUserId,
    satelite: sat,
    tipo: conflito.tipo,
    candidatos: conflito.candidatos ?? null,
    status: "aberto",
  });
  if (!error) return null;
  const e = error as { code?: string; message?: string };
  if (e.code === "23505") return null;
  return `conflito_nao_gravado: ${e.code ?? ""} ${String(e.message ?? "erro").slice(0, 120)}`.trim();
}

async function enviarLote(
  amb: Ambiente,
  sat: Satelite,
  dados: {
    modo: Modo;
    allow_deactivate: boolean;
    org_id: string;
    pessoas: unknown[];
    incluir_so_no_satelite?: boolean;
  },
) {
  const segredo = amb.segredos[sat];
  if (!segredo || segredo.length < 32) throw new Error(`${sat}: segredo_nao_configurado`);
  const { corpo, assinatura } = await assinarPedido(segredo, { acao: "apply", ...dados });
  const r = await amb.enviar(sat, corpo, assinatura);
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.resultados)) {
    throw new Error(
      `${sat}: http_${r.status}_${String(r.json?.error ?? "resposta_invalida").slice(0, 60)}`,
    );
  }
  return r.json as { modo: Modo; resultados: Resultado[]; so_no_satelite?: unknown[] };
}

/** Processa a caixa de saída: pega pendentes, agrupa por imobiliária e satélite, envia, registra e conclui. */
export async function processarFila(admin: Admin, amb: Ambiente, limite = 50) {
  const cfg = await ok<{ mode: Modo; allow_deactivate: boolean } | null>(
    admin.from("sync_config").select("mode,allow_deactivate").eq("id", true).maybeSingle(),
    "config",
  );
  const itens = await ok<Array<{ id: number; adm_user_id: string }>>(
    admin.rpc("sync_outbox_pegar", { p_limite: limite }),
    "pegar",
  );
  if (!itens?.length) return { processados: 0 };
  const geral = modoEfetivo(cfg?.mode);
  const mapas = await ok<Mapa[]>(admin.from("sync_org_map").select("*"), "mapa");
  const estado = await ok<LinhaEstado[]>(
    admin.rpc("sync_estado_desejado", { p_user_ids: itens.map((i) => i.adm_user_id), p_org: null }),
    "estado",
  );
  const porUser = new Map(estado.map((l) => [l.adm_user_id, l]));
  const mapaPorOrg = new Map(mapas.map((m) => [m.adm_org_id, m]));
  const exclusoes = await carregarExclusoes(admin);

  // desfecho por item da fila: ok | erro | aguardando_humano
  const desfecho = new Map<number, { r: "ok" | "erro" | "aguardando_humano"; erro?: string }>();
  const set = (id: number, r: "ok" | "erro" | "aguardando_humano", erro?: string) => {
    const atual = desfecho.get(id);
    const peso = { ok: 0, aguardando_humano: 1, erro: 2 };
    if (!atual || peso[r] > peso[atual.r]) desfecho.set(id, { r, erro });
  };
  const logs: Array<Record<string, unknown>> = [];
  const grupos = new Map<string, { mapa: Mapa; itens: Array<{ id: number; l: LinhaEstado }> }>();

  for (const it of itens) {
    const l = porUser.get(it.adm_user_id);
    const mapa = l?.org_id ? mapaPorOrg.get(l.org_id) : undefined;
    const fora = l ? foraDaSync(l) : "sem_perfil";
    if (!l || !mapa || fora || modoEfetivo(geral, mapa.mode) === "off") {
      set(it.id, "ok");
      continue; // fora de imobiliária mapeada/ligada: descarta (nada_a_fazer)
    }
    const g = grupos.get(mapa.adm_org_id) ?? { mapa, itens: [] };
    g.itens.push({ id: it.id, l });
    grupos.set(mapa.adm_org_id, g);
  }

  for (const { mapa, itens: giTodos } of grupos.values()) {
    const modo = modoEfetivo(geral, mapa.mode);
    const alvos = alvosDoMapa(mapa);
    for (const [sat, orgSat, ligado] of alvos) {
      if (!ligado || !orgSat) continue;
      // Excluídos deste satélite nunca são enviados (decisão humana registrada em sync_exclusoes).
      // 60 Dias: corretor sem "Participa do 60 Dias MAX" também não vai (vaiAoSatelite).
      const gi = giTodos.filter(
        ({ l }) => !excluido(exclusoes, l.adm_user_id, sat) && vaiAoSatelite(l, sat),
      );
      if (!gi.length) continue;
      try {
        const resp = await enviarLote(amb, sat, {
          modo,
          allow_deactivate: cfg?.allow_deactivate === true,
          org_id: orgSat,
          pessoas: gi.map(({ l }) => pessoaParaSatelite(l, sat, { tlLider: tlComoLider(mapa) })),
        });
        const porAdm = new Map(resp.resultados.map((r) => [r.adm_user_id, r]));
        for (const { id, l } of gi) {
          const r = porAdm.get(l.adm_user_id);
          if (!r) {
            set(id, "erro", `${sat}: sem_resposta`);
            continue;
          }
          logs.push({
            outbox_id: id,
            adm_user_id: l.adm_user_id,
            satelite: sat,
            acao: r.acoes.join(","),
            modo: resp.modo,
            resultado: r.resultado === "erro" ? "erro" : r.resultado,
            detalhe: { avisos: r.avisos, conflito: r.conflito, detalhes: r.detalhes ?? [] },
            erro: r.erro,
          });
          if (r.resultado === "erro") set(id, "erro", `${sat}: ${r.erro}`);
          else if (r.conflito) {
            const falha = await registrarConflito(admin, l.adm_user_id, sat, r.conflito);
            if (falha) {
              // Conflito que não chegou à fila humana nunca pode ficar como ok/aguardando: vira erro e nova tentativa.
              set(id, "erro", `${sat}: ${falha}`);
              logs.push({
                outbox_id: id,
                adm_user_id: l.adm_user_id,
                satelite: sat,
                acao: "registrar_conflito",
                modo: resp.modo,
                resultado: "erro",
                erro: falha,
              });
            } else set(id, r.resultado === "conflito" ? "aguardando_humano" : "ok");
          } else set(id, "ok");
        }
      } catch (err) {
        const msg = String((err as Error).message ?? err).slice(0, 300);
        for (const { id, l } of gi) {
          set(id, "erro", msg);
          logs.push({
            outbox_id: id,
            adm_user_id: l.adm_user_id,
            satelite: sat,
            acao: "envio",
            modo,
            resultado: "erro",
            erro: msg,
          });
        }
      }
    }

    // t_cbc7cc69: depois das pessoas (o líder precisa existir no Visita), as equipes da org.
    const eq = await sincronizarEquipesVisita(admin, amb, mapa, modo);
    if (eq) {
      logs.push(eq.log);
      if (eq.erro) for (const { id } of giTodos) set(id, "erro", `visita_equipes: ${eq.erro}`);
    }
  }

  if (logs.length) await ok(admin.from("sync_log").insert(logs), "log");
  for (const it of itens) {
    const d = desfecho.get(it.id) ?? { r: "ok" as const };
    await ok(
      admin.rpc("sync_outbox_concluir", { p_id: it.id, p_resultado: d.r, p_erro: d.erro ?? null }),
      "concluir",
    );
  }
  return { processados: itens.length, logs: logs.length };
}

// ---------- Equipes do ADM no Visita (t_cbc7cc69, etapa 1) ----------
export type EquipeOrg = {
  adm_team_id: string;
  nome: string;
  cor: string | null;
  parent_adm_team_id: string | null;
  lider_adm_user_id: string | null;
  colideres_adm_user_ids: string[] | null;
  membros_adm_user_ids: string[] | null;
};

/** Só ids do ADM, nome e cor: nada de e-mail, telefone ou outro dado pessoal. */
export function equipeParaVisita(t: EquipeOrg) {
  return {
    adm_team_id: t.adm_team_id,
    nome: String(t.nome ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    cor: t.cor ?? null,
    parent_adm_team_id: t.parent_adm_team_id ?? null,
    lider_adm_user_id: t.lider_adm_user_id ?? null,
    colideres_adm_user_ids: t.colideres_adm_user_ids ?? [],
    membros_adm_user_ids: t.membros_adm_user_ids ?? [],
  };
}

/**
 * Envia as equipes da org ao Visita quando a chave visita_equipes está ligada (ou manda ligado=false uma vez,
 * logo depois de desligada). Devolve null quando não há nada a enviar. Erro não lança: volta no campo erro e os
 * itens da fila daquela org ganham nova tentativa.
 */
export async function sincronizarEquipesVisita(
  admin: Admin,
  amb: Ambiente,
  mapa: Mapa,
  modo: Modo,
) {
  const ligado = mapa.visita_equipes === true;
  const desligar = !ligado && mapa.visita_equipes_desligar_pendente === true;
  if (
    (!ligado && !desligar) ||
    !mapa.visita_enabled ||
    !mapa.visita_imobiliaria_id ||
    modo === "off"
  )
    return null;
  const base = {
    adm_user_id: null,
    adm_org_id: mapa.adm_org_id,
    satelite: "visita",
    acao: "equipes",
    modo,
  };
  try {
    const equipes = ligado
      ? (
          await ok<EquipeOrg[]>(
            admin.rpc("sync_equipes_da_org", { p_org: mapa.adm_org_id }),
            "equipes_da_org",
          )
        ).map(equipeParaVisita)
      : [];
    const segredo = amb.segredos.visita;
    if (!segredo || segredo.length < 32) throw new Error("visita: segredo_nao_configurado");
    const { corpo, assinatura } = await assinarPedido(segredo, {
      acao: "equipes",
      modo,
      org_id: mapa.visita_imobiliaria_id,
      ligado,
      equipes,
    });
    const r = await amb.enviar("visita", corpo, assinatura);
    const res = r.json?.resultado;
    if (r.status !== 200 || typeof res !== "string" || res === "erro") {
      throw new Error(
        `http_${r.status}_${String(r.json?.erro ?? r.json?.error ?? "resposta_invalida").slice(0, 80)}`,
      );
    }
    if (desligar && modo === "live" && res !== "desligado") {
      await ok(
        admin
          .from("sync_org_map")
          .update({ visita_equipes_desligar_pendente: false })
          .eq("adm_org_id", mapa.adm_org_id),
        "desligar_pendente",
      );
    }
    return {
      erro: null as string | null,
      log: {
        ...base,
        resultado: res === "ok" ? "ok" : res === "simulado" ? "simulado" : "nada_a_fazer",
        detalhe: {
          ligado,
          equipes: equipes.length,
          resumo: r.json?.resumo ?? {},
          avisos: r.json?.avisos ?? [],
        },
        erro: null,
      },
    };
  } catch (err) {
    const msg = String((err as Error).message ?? err).slice(0, 300);
    return { erro: msg, log: { ...base, resultado: "erro", detalhe: { ligado }, erro: msg } };
  }
}

// ---------- Provisionamento automático de imobiliária (cartão t_c0844acb) ----------
export type OrgParaProvisao = {
  adm_org_id: string;
  nome: string;
  slug: string;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  email_contato: string | null;
  status_org: string;
  ja_mapeada: boolean;
  tentativas: number;
};

type RespProvisao = {
  resultado: "criado" | "ja_provisionada" | "simulado" | "conflito" | "desligado" | "erro";
  id?: string;
  conflito?: { tipo: string; candidatos?: unknown } | null;
  erro?: string;
};

/** Só os dados mínimos da org vão para os satélites (nada de pessoas, cores, logo etc.). */
export function orgParaSatelite(o: OrgParaProvisao) {
  return {
    adm_org_id: o.adm_org_id,
    nome: String(o.nome ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    slug: o.slug,
    cnpj: o.cnpj ?? null,
    cidade: o.cidade ?? null,
    uf: o.uf ?? null,
    email_contato: o.email_contato ?? null,
  };
}

async function enviarProvisao(
  amb: Ambiente,
  sat: Satelite,
  modo: Modo,
  org: ReturnType<typeof orgParaSatelite>,
): Promise<RespProvisao> {
  const segredo = amb.segredos[sat];
  if (!segredo || segredo.length < 32)
    return { resultado: "erro", erro: "segredo_nao_configurado" };
  try {
    const { corpo, assinatura } = await assinarPedido(segredo, {
      acao: "provisionar_org",
      modo,
      org,
    });
    const r = await amb.enviar(sat, corpo, assinatura);
    if (r.status !== 200 || !r.json || typeof r.json.resultado !== "string") {
      return {
        resultado: "erro",
        erro: `http_${r.status}_${String(r.json?.error ?? "resposta_invalida").slice(0, 60)}`,
      };
    }
    return r.json as RespProvisao;
  } catch (err) {
    return { resultado: "erro", erro: String((err as Error).message ?? err).slice(0, 200) };
  }
}

/** Conflito de ORG na fila humana (sync_conflicts com adm_user_id nulo). 23505 = já existe aberto igual. */
export async function registrarConflitoOrg(
  admin: Admin,
  admOrgId: string,
  sat: Satelite,
  conflito: { tipo: string; candidatos?: unknown },
): Promise<string | null> {
  const { error } = await admin.from("sync_conflicts").insert({
    adm_user_id: null,
    adm_org_id: admOrgId,
    satelite: sat,
    tipo: conflito.tipo,
    candidatos: conflito.candidatos ?? null,
    status: "aberto",
  });
  if (!error) return null;
  const e = error as { code?: string; message?: string };
  if (e.code === "23505") return null;
  return `conflito_nao_gravado: ${e.code ?? ""} ${String(e.message ?? "erro").slice(0, 120)}`.trim();
}

// Provisão automática continua só com Estudo e Visita: o 60 Dias é ligado à mão (ESPEC 60 Dias 2.1 e 2.2 item 6).
export const SATS: Satelite[] = ["estudo", "visita"];

/**
 * Processa as imobiliárias novas do ADM (sync_org_provision). Para cada uma:
 * 1. prévia (dry_run) nos 2 satélites; conflito em qualquer um = fila humana e NADA é criado;
 * 2. se provision_mode=live, cria nos 2 (idempotente pelo id do ADM);
 * 3. só com os 2 ids grava sync_org_map (live) e enfileira as pessoas (sync_provisao_concluir).
 * Falha no meio (1 criado, outro não) = erro + nova tentativa; a reenvio devolve 'ja_provisionada' no que já criou,
 * e o mapa nunca fica pela metade.
 */
export async function processarProvisionamento(admin: Admin, amb: Ambiente, limite = 5) {
  const cfg = await ok<{ mode: Modo; provision_mode: Modo } | null>(
    admin.from("sync_config").select("mode,provision_mode").eq("id", true).maybeSingle(),
    "config_provisao",
  );
  const modo = modoEfetivo(cfg?.mode, cfg?.provision_mode);
  if (modo === "off") return { orgs: 0 };
  const orgs = await ok<OrgParaProvisao[]>(
    admin.rpc("sync_provisao_pegar", { p_limite: limite }),
    "provisao_pegar",
  );
  const logs: Array<Record<string, unknown>> = [];
  const resumo: Array<{ adm_org_id: string; status: string }> = [];
  const concluir = async (
    o: OrgParaProvisao,
    resultado: string,
    extra: { estudo?: string; visita?: string; detalhe?: unknown; erro?: string } = {},
  ) => {
    const st = await ok<string>(
      admin.rpc("sync_provisao_concluir", {
        p_org: o.adm_org_id,
        p_resultado: resultado,
        p_estudo: extra.estudo ?? null,
        p_visita: extra.visita ?? null,
        p_detalhe: extra.detalhe ?? null,
        p_erro: extra.erro ?? null,
      }),
      "provisao_concluir",
    );
    resumo.push({ adm_org_id: o.adm_org_id, status: st });
  };
  const log = (o: OrgParaProvisao, sat: Satelite, m: Modo, r: RespProvisao) =>
    logs.push({
      adm_user_id: null,
      adm_org_id: o.adm_org_id,
      satelite: sat,
      acao: "provisionar_org",
      modo: m,
      resultado:
        r.resultado === "criado"
          ? "ok"
          : r.resultado === "ja_provisionada"
            ? "nada_a_fazer"
            : r.resultado === "simulado"
              ? "simulado"
              : r.resultado === "conflito"
                ? "conflito"
                : "erro",
      detalhe: { resultado: r.resultado, id: r.id ?? null, conflito: r.conflito ?? null },
      erro: r.resultado === "erro" || r.resultado === "desligado" ? (r.erro ?? r.resultado) : null,
    });

  for (const o of orgs ?? []) {
    if (o.ja_mapeada) {
      await concluir(o, "ignorado", { erro: "ja_mapeada_manual" });
      continue;
    }
    if (o.status_org !== "ativa") {
      await concluir(o, "ignorado", { erro: `org_${o.status_org}` });
      continue;
    }
    const org = orgParaSatelite(o);

    // 1) Prévia nos dois.
    const previa: Partial<Record<Satelite, RespProvisao>> = {};
    for (const sat of SATS) {
      previa[sat] = await enviarProvisao(amb, sat, "dry_run", org);
      log(o, sat, "dry_run", previa[sat]!);
    }
    const falhaPrevia = SATS.find(
      (s) => !["simulado", "ja_provisionada", "conflito"].includes(previa[s]!.resultado),
    );
    if (falhaPrevia) {
      await concluir(o, "erro", {
        detalhe: { previa },
        erro: `${falhaPrevia}: ${previa[falhaPrevia]!.erro ?? previa[falhaPrevia]!.resultado}`,
      });
      continue;
    }
    const comConflito = SATS.filter((s) => previa[s]!.resultado === "conflito");
    if (comConflito.length) {
      const falhas: string[] = [];
      for (const sat of comConflito) {
        const f = await registrarConflitoOrg(
          admin,
          o.adm_org_id,
          sat,
          previa[sat]!.conflito ?? { tipo: "conflito" },
        );
        if (f) falhas.push(`${sat}: ${f}`);
      }
      // Conflito que não chegou à fila humana nunca fica parado: vira erro e nova tentativa.
      if (falhas.length)
        await concluir(o, "erro", { detalhe: { previa }, erro: falhas.join("; ") });
      else
        await concluir(o, "aguardando_humano", {
          detalhe: { previa },
          erro: `conflito: ${comConflito.join(",")}`,
        });
      continue;
    }
    if (modo === "dry_run") {
      await concluir(o, "simulado", { detalhe: { previa } });
      continue;
    }

    // 2) Criação nos dois (idempotente).
    const feito: Partial<Record<Satelite, RespProvisao>> = {};
    for (const sat of SATS) {
      feito[sat] = await enviarProvisao(amb, sat, "live", org);
      log(o, sat, "live", feito[sat]!);
      if (!["criado", "ja_provisionada"].includes(feito[sat]!.resultado)) break;
    }
    const ids = {
      estudo:
        feito.estudo?.id && ["criado", "ja_provisionada"].includes(feito.estudo.resultado)
          ? feito.estudo.id
          : undefined,
      visita:
        feito.visita?.id && ["criado", "ja_provisionada"].includes(feito.visita.resultado)
          ? feito.visita.id
          : undefined,
    };
    if (ids.estudo && ids.visita) {
      await concluir(o, "ok", { ...ids, detalhe: { feito } });
      continue;
    }
    const satConflito = SATS.find((s) => feito[s]?.resultado === "conflito");
    if (satConflito) {
      const f = await registrarConflitoOrg(
        admin,
        o.adm_org_id,
        satConflito,
        feito[satConflito]!.conflito ?? { tipo: "conflito" },
      );
      await concluir(o, f ? "erro" : "aguardando_humano", {
        ...ids,
        detalhe: { feito },
        erro: f ?? `conflito: ${satConflito}`,
      });
      continue;
    }
    const satErro = SATS.find(
      (s) => feito[s] && !["criado", "ja_provisionada"].includes(feito[s]!.resultado),
    )!;
    const r = feito[satErro]!;
    await concluir(o, "erro", {
      ...ids,
      detalhe: { feito },
      erro: `${satErro}: ${r.resultado === "simulado" ? "satelite_em_dry_run" : (r.erro ?? r.resultado)}`,
    });
  }
  if (logs.length) await ok(admin.from("sync_log").insert(logs), "log_provisao");
  return { orgs: (orgs ?? []).length, resumo };
}

/**
 * Reconciliação sob demanda: manda TODAS as pessoas de cada imobiliária mapeada em dry_run (nunca grava
 * nos satélites) e devolve o relatório do que faria. Grava o resumo em sync_reconcile_runs.
 */
export async function reconciliar(admin: Admin, amb: Ambiente, somenteOrg?: string) {
  const cfg = await ok<{ allow_deactivate: boolean } | null>(
    admin.from("sync_config").select("allow_deactivate").eq("id", true).maybeSingle(),
    "config",
  );
  const mapas = await ok<Mapa[]>(admin.from("sync_org_map").select("*"), "mapa");
  const exclusoes = await carregarExclusoes(admin);
  const relatorios = [];
  for (const mapa of mapas) {
    if (somenteOrg && mapa.adm_org_id !== somenteOrg) continue;
    const linhas = await ok<LinhaEstado[]>(
      admin.rpc("sync_estado_desejado", { p_user_ids: null, p_org: mapa.adm_org_id }),
      "estado",
    );
    const foraLista = linhas.map((l) => ({ l, f: foraDaSync(l) }));
    const dentro = foraLista.filter((x) => !x.f).map((x) => x.l);
    const rel: Record<string, unknown> = {
      adm_org_id: mapa.adm_org_id,
      pessoas_adm: linhas.length,
      fora_da_sync: foraLista
        .filter((x) => x.f)
        .map((x) => ({ adm_user_id: x.l.adm_user_id, motivo: x.f })),
    };
    const alvos = alvosDoMapa(mapa);
    for (const [sat, orgSat, ligado] of alvos) {
      if (!ligado || !orgSat) continue;
      const excl = dentro.filter((l) => excluido(exclusoes, l.adm_user_id, sat));
      const naoParticipa = dentro.filter(
        (l) => !excluido(exclusoes, l.adm_user_id, sat) && !vaiAoSatelite(l, sat),
      );
      const enviar = dentro.filter(
        (l) => !excluido(exclusoes, l.adm_user_id, sat) && vaiAoSatelite(l, sat),
      );
      try {
        const resp = await enviarLote(amb, sat, {
          modo: "dry_run",
          allow_deactivate: cfg?.allow_deactivate === true,
          org_id: orgSat,
          pessoas: enviar.map((l) => pessoaParaSatelite(l, sat, { tlLider: tlComoLider(mapa) })),
          incluir_so_no_satelite: true,
        });
        const r = resumir(resp.resultados, resp.so_no_satelite ?? [], resp.modo);
        // Excluídos: e-mail deles não foi enviado, então a conta deles no satélite aparece em so_no_satelite.
        // Fica registrado só o id do ADM; nenhuma ação é planejada para eles.
        r.contagem.excluidos = excl.length;
        (r as Record<string, unknown>).excluidos = excl.map((l) => l.adm_user_id);
        // 60 Dias: corretores sem a opção ligada (não enviados; só a contagem e o id do ADM).
        if (sat === "sessenta") {
          r.contagem.nao_participam = naoParticipa.length;
          (r as Record<string, unknown>).nao_participam = naoParticipa.map((l) => l.adm_user_id);
        }
        rel[sat] = r;
      } catch (err) {
        rel[sat] = { erro: String((err as Error).message ?? err).slice(0, 300) };
      }
    }
    const resumo = Object.fromEntries(
      Object.entries(rel).map(([k, v]) => [
        k,
        v && typeof v === "object" && "contagem" in (v as object)
          ? (v as { contagem: unknown }).contagem
          : v,
      ]),
    );
    await ok(
      admin
        .from("sync_reconcile_runs")
        .insert({ adm_org_id: mapa.adm_org_id, resumo, detalhe: rel }),
      "reconcile_run",
    );
    relatorios.push(rel);
  }
  return { relatorios };
}

export function resumir(resultados: Resultado[], soNoSatelite: unknown[], modo: string) {
  const porAcao: Record<string, number> = {};
  const porAviso: Record<string, number> = {};
  const porConflito: Record<string, number> = {};
  for (const r of resultados) {
    for (const a of r.acoes) porAcao[a] = (porAcao[a] ?? 0) + 1;
    for (const a of r.avisos) porAviso[a] = (porAviso[a] ?? 0) + 1;
    if (r.conflito) porConflito[r.conflito.tipo] = (porConflito[r.conflito.tipo] ?? 0) + 1;
  }
  return {
    modo,
    contagem: {
      excluidos: 0,
      nao_participam: 0,
      pessoas: resultados.length,
      por_acao: porAcao,
      por_aviso: porAviso,
      por_conflito: porConflito,
      so_no_satelite: soNoSatelite.length,
    },
    mudancas: resultados.filter((r) => !r.acoes.includes("nada_a_fazer") || r.avisos.length),
    so_no_satelite: soNoSatelite,
  };
}
