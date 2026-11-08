// Rotina diária dos avisos de exclusividade (cartão t_c337fc12). Roda no servidor (task do Nitro, ~8h de
// São Paulo) com service_role, UMA imobiliária por vez e só onde o módulo 'avisos_exclusividade' está ligado.
// Imports relativos: também carregado pela task do Nitro (server/tasks).
//
// Três partes:
// 1) carregarDadosOrg: lê o banco (sempre filtrando organization_id; service_role ignora RLS).
// 2) planejarEnvios: conta pura — o que mandar hoje, para quem, por quais canais (sem repetir o que já foi).
// 3) executarEnvios: grava o registro (trava contra duplicidade) e manda por cada canal; um canal com falha
//    não derruba os outros, e a falha fica registrada.
// Padrão = SIMULAÇÃO (dry-run): só conta. Envio real só com AVISOS_EXCLUSIVIDADE=on (aprovação de Denis).
import type { OrgAdminClient } from "./org-scope";
import {
  avisosDaCaptacao,
  diaDaSemana,
  linhasResumo,
  mensagemResumo,
  type CapturaAviso,
  type TipoAviso,
} from "./avisos-exclusividade";
import { normalizePhone, whatsappText } from "./room-reservation-reminders";

/** Status de venda que contam como "vendida" (mesma regra de venda_situacao_captacao no banco). */
export const STATUS_VENDIDA = [
  "contrato_assinado",
  "ocorrencia_pendente",
  "ocorrencia_analise_financeiro",
  "ocorrencia_devolvida_gestor",
  "ocorrencia_concluida",
] as const;

export type Pessoa = {
  id: string;
  nome: string | null;
  telefone: string | null;
  ativo: boolean | null;
};
export type Preferencia = { user_id: string; push: boolean; whatsapp: boolean };
export type Inscricao = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
export type EstruturaLideranca = {
  teams: { id: string; lider_id: string | null; parent_team_id: string | null }[];
  membros: { team_id: string; membro_id: string }[];
  coLideres: { team_id: string; user_id: string }[];
  /** Quem tem papel gestor ou team_leader na imobiliária (só esses recebem o resumo). */
  lideresComPapel: string[];
};

export type DadosOrg = {
  orgId: string;
  capturas: CapturaAviso[];
  vendidas: Set<string>;
  reunioes: Map<string, string[]>;
  codigos: Map<string, string>;
  pessoas: Map<string, Pessoa>;
  preferencias: Map<string, Preferencia>;
  inscricoes: Inscricao[];
  lideranca: EstruturaLideranca;
  /** Avisos já registrados: `${recipient}|${capture ?? ""}|${tipo}|${chave}`. */
  jaEnviados: Set<string>;
};

export type Envio = {
  orgId: string;
  recipientId: string;
  captureId: string | null;
  tipo: TipoAviso;
  chave: string;
  titulo: string;
  mensagem: string;
  /** Link de quem clica no sino/push. */
  url: string;
  canais: { push: boolean; whatsapp: boolean };
  telefone: string | null;
};

export const chaveEnvio = (e: Pick<Envio, "recipientId" | "captureId" | "tipo" | "chave">) =>
  `${e.recipientId}|${e.captureId ?? ""}|${e.tipo}|${e.chave}`;

/** Líderes de um corretor: líder e líderes auxiliares das equipes dele e da equipe-mãe (igual is_lead_of). */
export function lideresDe(corretorId: string, e: EstruturaLideranca): string[] {
  const ids = new Set<string>();
  const porId = new Map(e.teams.map((t) => [t.id, t]));
  const co = (teamId: string) =>
    e.coLideres.filter((c) => c.team_id === teamId).forEach((c) => ids.add(c.user_id));
  for (const m of e.membros) {
    if (m.membro_id !== corretorId) continue;
    const t = porId.get(m.team_id);
    if (!t) continue;
    if (t.lider_id) ids.add(t.lider_id);
    co(t.id);
    const pai = t.parent_team_id ? porId.get(t.parent_team_id) : undefined;
    if (pai) {
      if (pai.lider_id) ids.add(pai.lider_id);
      co(pai.id);
    }
  }
  ids.delete(corretorId);
  const comPapel = new Set(e.lideresComPapel);
  return [...ids].filter((id) => comPapel.has(id));
}

/** O que mandar hoje nesta imobiliária. Pura: não lê nem grava nada. */
export function planejarEnvios(d: DadosOrg, hoje: string): Envio[] {
  const out: Envio[] = [];
  const canaisDe = (uid: string) => {
    const p = d.preferencias.get(uid);
    return { push: p?.push !== false, whatsapp: p?.whatsapp !== false };
  };
  const ativo = (uid: string) => {
    const p = d.pessoas.get(uid);
    return !!p && p.ativo !== false; // só gente desta imobiliária (pessoas vem filtrado pela org)
  };
  for (const c of d.capturas) {
    if (c.organization_id !== d.orgId || !ativo(c.captor_id)) continue;
    const avisos = avisosDaCaptacao(c, {
      hoje,
      vendida: d.vendidas.has(c.id),
      reunioes: d.reunioes.get(c.id) ?? [],
      codigoAnuncio: d.codigos.get(c.id),
    });
    for (const a of avisos) {
      const e: Envio = {
        orgId: d.orgId,
        recipientId: c.captor_id,
        captureId: c.id,
        tipo: a.tipo,
        chave: a.chave,
        titulo: a.titulo,
        mensagem: a.mensagem,
        url: `/exclusividades/${c.id}`,
        canais: canaisDe(c.captor_id),
        telefone: normalizePhone(d.pessoas.get(c.captor_id)?.telefone ?? null),
      };
      if (!d.jaEnviados.has(chaveEnvio(e))) out.push(e);
    }
  }

  // Resumo semanal do gestor/TL: segunda-feira, separado por corretor.
  if (diaDaSemana(hoje) === 1) {
    const porLider = new Map<string, CapturaAviso[]>();
    for (const c of d.capturas) {
      if (c.organization_id !== d.orgId) continue;
      for (const l of lideresDe(c.captor_id, d.lideranca)) {
        const xs = porLider.get(l) ?? [];
        xs.push(c);
        porLider.set(l, xs);
      }
    }
    const nomes = new Map([...d.pessoas.values()].map((p) => [p.id, p.nome ?? ""]));
    for (const [lider, caps] of porLider) {
      if (!ativo(lider)) continue;
      const linhas = linhasResumo(caps, {
        hoje,
        vendidas: d.vendidas,
        reunioes: d.reunioes,
        codigos: d.codigos,
        nomes,
      });
      if (!linhas.length) continue;
      const e: Envio = {
        orgId: d.orgId,
        recipientId: lider,
        captureId: null,
        tipo: "resumo_gestor",
        chave: hoje,
        titulo: "Resumo semanal das exclusividades",
        mensagem: mensagemResumo(linhas),
        url: "/exclusividades/painel?aba=por-corretor",
        canais: canaisDe(lider),
        telefone: normalizePhone(d.pessoas.get(lider)?.telefone ?? null),
      };
      if (!d.jaEnviados.has(chaveEnvio(e))) out.push(e);
    }
  }
  return out;
}

export type ResultadoCanal = "ok" | "falhou" | "desligado" | "sem_destino" | "simulado";
export type Canais = {
  /** Grava no sino (notifications). Sempre ligado. */
  sino: (e: Envio) => Promise<void>;
  /** Manda para cada aparelho; devolve quantos receberam. null = canal não configurado. */
  push: ((e: Envio, subs: Inscricao[]) => Promise<{ ok: number; falhas: number }>) | null;
  /** WhatsApp pelo ZionTalk do ADM. null = canal não configurado. */
  whatsapp: ((telefone: string, texto: string) => Promise<boolean>) | null;
};
export type Registro = {
  /** Reserva o aviso (UNIQUE pessoa+captação+tipo+chave). false = já existia: não manda de novo. */
  reservar: (e: Envio) => Promise<boolean>;
  concluir: (
    e: Envio,
    r: { sino: ResultadoCanal; push: ResultadoCanal; whatsapp: ResultadoCanal; erro: string | null },
  ) => Promise<void>;
};

export type Totais = {
  porTipo: Record<TipoAviso, number>;
  enviados: number;
  pulados: number;
  falhasCanal: number;
};
export const totaisVazios = (): Totais => ({
  porTipo: {
    vence_30: 0,
    vence_15: 0,
    vence_hoje: 0,
    vencida_semanal: 0,
    reuniao_45: 0,
    reuniao_semanal: 0,
    resumo_gestor: 0,
  },
  enviados: 0,
  pulados: 0,
  falhasCanal: 0,
});

const curto = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/\d{8,}/g, "[n]").slice(0, 120);

/** Manda os avisos planejados. Um canal que falha não impede os outros; tudo fica no registro. */
export async function executarEnvios(
  envios: Envio[],
  inscricoes: Inscricao[],
  canais: Canais,
  registro: Registro,
  totais: Totais = totaisVazios(),
): Promise<Totais> {
  for (const e of envios) {
    if (!(await registro.reservar(e))) {
      totais.pulados++;
      continue;
    }
    const erros: string[] = [];
    let sino: ResultadoCanal = "ok";
    try {
      await canais.sino(e);
    } catch (err) {
      sino = "falhou";
      erros.push(`sino: ${curto(err)}`);
    }
    let push: ResultadoCanal;
    const subs = inscricoes.filter((s) => s.user_id === e.recipientId);
    if (!e.canais.push) push = "desligado";
    else if (!canais.push || !subs.length) push = "sem_destino";
    else {
      try {
        const r = await canais.push(e, subs);
        push = r.ok > 0 ? "ok" : "falhou";
        if (r.falhas) erros.push(`push: ${r.falhas} aparelho(s) falharam`);
      } catch (err) {
        push = "falhou";
        erros.push(`push: ${curto(err)}`);
      }
    }
    let whatsapp: ResultadoCanal;
    if (!e.canais.whatsapp) whatsapp = "desligado";
    else if (!canais.whatsapp || !e.telefone) whatsapp = "sem_destino";
    else {
      try {
        whatsapp = (await canais.whatsapp(e.telefone, whatsappText(e.mensagem))) ? "ok" : "falhou";
        if (whatsapp === "falhou") erros.push("whatsapp: ziontalk recusou");
      } catch (err) {
        whatsapp = "falhou";
        erros.push(`whatsapp: ${curto(err)}`);
      }
    }
    if ([sino, push, whatsapp].includes("falhou")) totais.falhasCanal++;
    totais.enviados++;
    totais.porTipo[e.tipo]++;
    try {
      await registro.concluir(e, { sino, push, whatsapp, erro: erros.join("; ") || null });
    } catch {
      // O aviso já está reservado (não repete); só o detalhe do resultado ficou sem gravar.
    }
  }
  return totais;
}

type Q = { data: unknown; error: { message: string } | null };
const linhas = <T>(r: Q, nome: string): T[] => {
  if (r.error) throw new Error(`${nome}: ${r.error.message}`);
  return (r.data ?? []) as T[];
};
const emLotes = <T>(xs: T[], n = 200): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Lê tudo de UMA imobiliária. Qualquer erro de leitura interrompe esta imobiliária (não manda pela metade). */
export async function carregarDadosOrg(admin: OrgAdminClient, orgId: string): Promise<DadosOrg> {
  const caps = linhas<CapturaAviso>(
    await admin
      .from("exclusive_captures")
      .select(
        "id, organization_id, captor_id, status, signed_on, form_data, archived_at, discarded_at, broker_name",
      )
      .eq("organization_id", orgId)
      .eq("status", "aprovada")
      .is("archived_at", null)
      .is("discarded_at", null)
      .not("signed_on", "is", null),
    "captações",
  );
  const ids = caps.map((c) => c.id);
  const vendidas = new Set<string>();
  const reunioes = new Map<string, string[]>();
  const codigos = new Map<string, string>();
  for (const lote of emLotes(ids)) {
    const [vs, rs, ls] = await Promise.all([
      admin
        .from("sales")
        .select("exclusive_capture_id")
        .eq("organization_id", orgId)
        .in("exclusive_capture_id", lote)
        .in("status", [...STATUS_VENDIDA]),
      admin
        .from("exclusive_owner_meetings")
        .select("capture_id, met_on")
        .eq("organization_id", orgId)
        .in("capture_id", lote),
      admin
        .from("exclusive_listing_links")
        .select("capture_id, listing_code")
        .eq("organization_id", orgId)
        .eq("status", "ativo")
        .in("capture_id", lote),
    ]);
    for (const v of linhas<{ exclusive_capture_id: string }>(vs, "vendas"))
      vendidas.add(v.exclusive_capture_id);
    for (const r of linhas<{ capture_id: string; met_on: string }>(rs, "reuniões"))
      reunioes.set(r.capture_id, [...(reunioes.get(r.capture_id) ?? []), r.met_on]);
    for (const l of linhas<{ capture_id: string; listing_code: string }>(ls, "anúncios"))
      if (!codigos.has(l.capture_id)) codigos.set(l.capture_id, l.listing_code);
  }
  const [teams, membros, coLideres, papeis, pessoas, prefs, subs, log] = await Promise.all([
    admin.from("teams").select("id, lider_id, parent_team_id").eq("organization_id", orgId),
    admin.from("team_members").select("team_id, membro_id").eq("organization_id", orgId),
    admin.from("team_co_leaders").select("team_id, user_id").eq("organization_id", orgId),
    admin
      .from("user_roles")
      .select("user_id")
      .eq("organization_id", orgId)
      .in("role", ["gestor", "team_leader"]),
    admin.from("profiles").select("id, nome, telefone, ativo").eq("organization_id", orgId),
    admin.from("aviso_preferencias").select("user_id, push, whatsapp").eq("organization_id", orgId),
    admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .eq("organization_id", orgId),
    admin
      .from("exclusive_notice_log")
      .select("recipient_id, capture_id, tipo, chave")
      .eq("organization_id", orgId)
      .gte("created_at", new Date(Date.now() - 400 * 86_400_000).toISOString()),
  ]);
  return {
    orgId,
    capturas: caps,
    vendidas,
    reunioes,
    codigos,
    pessoas: new Map(linhas<Pessoa>(pessoas, "perfis").map((p) => [p.id, p])),
    preferencias: new Map(linhas<Preferencia>(prefs, "preferências").map((p) => [p.user_id, p])),
    inscricoes: linhas<Inscricao>(subs, "push"),
    lideranca: {
      teams: linhas(teams, "equipes"),
      membros: linhas(membros, "membros"),
      coLideres: linhas(coLideres, "líderes auxiliares"),
      lideresComPapel: linhas<{ user_id: string }>(papeis, "papéis").map((p) => p.user_id),
    },
    jaEnviados: new Set(
      linhas<{ recipient_id: string; capture_id: string | null; tipo: TipoAviso; chave: string }>(
        log,
        "registro",
      ).map((l) =>
        chaveEnvio({
          recipientId: l.recipient_id,
          captureId: l.capture_id,
          tipo: l.tipo,
          chave: l.chave,
        }),
      ),
    ),
  };
}

/** Registro no banco: a inserção com UNIQUE é a trava (duas rodadas ao mesmo tempo não repetem o aviso). */
export function registroNoBanco(admin: OrgAdminClient): Registro {
  return {
    async reservar(e) {
      const { data, error } = await admin
        .from("exclusive_notice_log")
        .upsert(
          {
            organization_id: e.orgId,
            recipient_id: e.recipientId,
            capture_id: e.captureId,
            tipo: e.tipo,
            chave: e.chave,
          },
          { onConflict: "recipient_id,capture_id,tipo,chave", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw new Error(`registro: ${error.message}`);
      // Linha devolvida = reservei agora; vazio = já existia (outra rodada mandou): não repete.
      return Array.isArray(data) && data.length > 0;
    },
    async concluir(e, r) {
      let q = admin
        .from("exclusive_notice_log")
        .update({ ...r, updated_at: new Date().toISOString() })
        .eq("organization_id", e.orgId)
        .eq("recipient_id", e.recipientId)
        .eq("tipo", e.tipo)
        .eq("chave", e.chave);
      q = e.captureId ? q.eq("capture_id", e.captureId) : q.is("capture_id", null);
      await q;
    },
  };
}

export type ResultadoRotina = {
  modo: "simulacao" | "envio";
  hoje: string;
  orgs: { orgId: string; totais: Totais; erro?: string }[];
};

/**
 * Rotina diária. `canais` null = SIMULAÇÃO (só conta o que seria enviado; não grava nada).
 * Percorre só imobiliárias ativas com o módulo ligado.
 */
export async function runAvisosExclusividade(
  admin: OrgAdminClient,
  canais: Canais | null,
  now: Date = new Date(),
): Promise<ResultadoRotina> {
  const hoje = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const out: ResultadoRotina = { modo: canais ? "envio" : "simulacao", hoje, orgs: [] };
  const { data: mods, error } = await admin
    .from("organization_modules")
    .select("organization_id")
    .eq("module", "avisos_exclusividade")
    .eq("enabled", true);
  if (error) return out;
  const { data: orgs } = await admin.from("organizations").select("id").eq("status", "ativa");
  const ativas = new Set(((orgs ?? []) as { id: string }[]).map((o) => o.id));
  for (const { organization_id: orgId } of (mods ?? []) as { organization_id: string }[]) {
    if (!ativas.has(orgId)) continue;
    const totais = totaisVazios();
    try {
      const dados = await carregarDadosOrg(admin, orgId);
      const envios = planejarEnvios(dados, hoje);
      if (!canais) {
        for (const e of envios) totais.porTipo[e.tipo]++;
      } else {
        await executarEnvios(envios, dados.inscricoes, canais, registroNoBanco(admin), totais);
      }
      out.orgs.push({ orgId, totais });
    } catch (err) {
      out.orgs.push({ orgId, totais, erro: curto(err) });
    }
  }
  return out;
}
