// Robô da sincronização ADM MAX -> Estudo de Mercado e Visita Prova (etapa 1, cartão t_41bcad66).
// Sem dependências do Deno (testável com vitest). Envia o ESTADO ATUAL da pessoa (idempotente), assinado
// com HMAC por satélite. O ADM nunca guarda a chave mestra dos satélites.
/* eslint-disable @typescript-eslint/no-explicit-any -- respostas JSON dos satélites e cliente supabase-js (Deno) sem tipos gerados */

export type Modo = "off" | "dry_run" | "live";
export type Satelite = "estudo" | "visita";
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

/** Papel de maior acesso entre os que dão acesso ao satélite; "none" se nenhum (juridico, financeiro...). */
export function papelNoSatelite(roles: string[], sat: Satelite): string {
  let melhor = "none";
  let rank = 0;
  for (const r of roles) {
    const p = sat === "estudo" ? ESTUDO[r] : VISITA[r];
    if (!p) continue;
    const k =
      sat === "estudo" ? RANK_E[p as keyof typeof RANK_E] : RANK_V[p as keyof typeof RANK_V];
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
};

export type Mapa = {
  adm_org_id: string;
  estudo_org_id: string | null;
  visita_imobiliaria_id: string | null;
  mode: Modo;
  estudo_enabled: boolean;
  visita_enabled: boolean;
};

/** Pessoa fora da sincronização: super_admin (nunca mexe) ou sem e-mail. */
export function foraDaSync(l: LinhaEstado): string | null {
  if (l.roles.includes("super_admin")) return "super_admin";
  if (!l.email || !l.email.includes("@")) return "sem_email";
  return null;
}

/** Monta a pessoa no formato do satélite (só campos mínimos; sem CPF, CRECI, remax_id etc.). */
export function pessoaParaSatelite(l: LinhaEstado, sat: Satelite) {
  return {
    adm_user_id: l.adm_user_id,
    email: String(l.email).trim().toLowerCase(),
    nome: String(l.nome ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    telefone: l.telefone ?? null,
    papel: papelNoSatelite(l.roles, sat),
    ativo: l.ativo === true,
    lider_email: sat === "estudo" ? l.lider_email : null,
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

  for (const { mapa, itens: gi } of grupos.values()) {
    const modo = modoEfetivo(geral, mapa.mode);
    const alvos: Array<[Satelite, string | null, boolean]> = [
      ["estudo", mapa.estudo_org_id, mapa.estudo_enabled],
      ["visita", mapa.visita_imobiliaria_id, mapa.visita_enabled],
    ];
    for (const [sat, orgSat, ligado] of alvos) {
      if (!ligado || !orgSat) continue;
      try {
        const resp = await enviarLote(amb, sat, {
          modo,
          allow_deactivate: cfg?.allow_deactivate === true,
          org_id: orgSat,
          pessoas: gi.map(({ l }) => pessoaParaSatelite(l, sat)),
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
            set(id, r.resultado === "conflito" ? "aguardando_humano" : "ok");
            await admin.from("sync_conflicts").upsert(
              {
                adm_user_id: l.adm_user_id,
                satelite: sat,
                tipo: r.conflito.tipo,
                candidatos: r.conflito.candidatos ?? null,
                status: "aberto",
              },
              { onConflict: "adm_user_id,satelite,tipo", ignoreDuplicates: true },
            );
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
    const alvos: Array<[Satelite, string | null, boolean]> = [
      ["estudo", mapa.estudo_org_id, mapa.estudo_enabled],
      ["visita", mapa.visita_imobiliaria_id, mapa.visita_enabled],
    ];
    for (const [sat, orgSat, ligado] of alvos) {
      if (!ligado || !orgSat) continue;
      try {
        const resp = await enviarLote(amb, sat, {
          modo: "dry_run",
          allow_deactivate: cfg?.allow_deactivate === true,
          org_id: orgSat,
          pessoas: dentro.map((l) => pessoaParaSatelite(l, sat)),
          incluir_so_no_satelite: true,
        });
        rel[sat] = resumir(resp.resultados, resp.so_no_satelite ?? [], resp.modo);
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
