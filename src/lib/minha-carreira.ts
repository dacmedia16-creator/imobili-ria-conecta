// Minha carreira, PR 1 (card t_07d196a7): regras puras dos blocos "O que fazer hoje",
// "Minhas captações" e "Oportunidades para mim". Os dados vêm das RPCs minhas_pendencias e
// minhas_captacoes (migração 20261016100000), sempre do corretor logado na imobiliária ativa.
import { captureMatches, type CaptureCandidate, type OpportunityPost } from "@/lib/oportunidades";

export type PendenciaKind = "devolvida" | "documentos" | "atrasada" | "vencendo" | "sem_anuncio";

export type Pendencia = {
  kind: PendenciaKind;
  capture_id: string;
  imovel: string | null;
  detalhe: string;
  prazo: string | null;
  dias: number | null;
};

export type MinhaCaptacao = {
  capture_id: string;
  imovel: string | null;
  status: string;
  listing_code: string | null;
  coletado_em: string | null;
  views: number | null;
  contacts: number | null;
  /** null = sem base confiável para decidir (nunca inventamos número). */
  parado: boolean | null;
  vence_em: string | null;
  dias_restantes: number | null;
};

/** Regra de "imóvel parado" (sugestão aprovada na maquete; número ajustável depois). */
export const PARADO_DIAS = 30;
export const PARADO_MIN_VIEWS = 50;

const PESO: Record<PendenciaKind, number> = {
  devolvida: 0,
  vencendo: 1,
  atrasada: 2,
  documentos: 3,
  sem_anuncio: 4,
};

export const ROTULO_PENDENCIA: Record<PendenciaKind, string> = {
  devolvida: "Devolvida",
  documentos: "Documentos",
  atrasada: "Plano atrasado",
  vencendo: "Exclusividade",
  sem_anuncio: "Sem anúncio",
};

/**
 * Da mais urgente para a menos urgente: tipo (devolvida > vencendo > atrasada > documentos >
 * sem anúncio) e, dentro do tipo, quem está mais perto/além do prazo primeiro.
 */
export function ordenarPendencias(lista: Pendencia[]): Pendencia[] {
  const urg = (p: Pendencia) => {
    if (p.dias == null) return 0;
    // "vencendo" traz dias que faltam (negativo = já venceu); os outros, dias de atraso.
    return p.kind === "vencendo" ? p.dias : -p.dias;
  };
  return [...lista].sort((a, b) => PESO[a.kind] - PESO[b.kind] || urg(a) - urg(b));
}

export function textoDias(p: Pendencia): string | null {
  if (p.dias == null) return null;
  if (p.kind === "vencendo") {
    if (p.dias < 0) return `venceu há ${-p.dias} dia${p.dias === -1 ? "" : "s"}`;
    if (p.dias === 0) return "vence hoje";
    return `faltam ${p.dias} dia${p.dias === 1 ? "" : "s"}`;
  }
  if (p.kind === "sem_anuncio") return `aprovada há ${p.dias} dias`;
  return `${p.dias} dia${p.dias === 1 ? "" : "s"} de atraso`;
}

export function textoNumerosPortal(
  c: Pick<MinhaCaptacao, "views" | "contacts" | "listing_code">,
): string {
  if (!c.listing_code) return "Sem anúncio ligado";
  if (c.views == null || c.contacts == null) return "Sem dado dos portais nos últimos 30 dias";
  return `${c.views} visualizaç${c.views === 1 ? "ão" : "ões"} · ${c.contacts} contato${c.contacts === 1 ? "" : "s"}`;
}

export function filtrarCaptacoes(lista: MinhaCaptacao[], soParadas: boolean): MinhaCaptacao[] {
  return soParadas ? lista.filter((c) => c.parado === true) : lista;
}

/** Pedidos do grupo que encaixam nas captações do próprio corretor (reaproveita o encaixe do mural). */
export function oportunidadesParaMim(
  posts: OpportunityPost[],
  captures: CaptureCandidate[],
  hidden: Set<string>,
  userId: string,
  now = new Date(),
): { post: OpportunityPost; capture: CaptureCandidate }[] {
  const minhas = captures.filter((c) => c.captor_id === userId);
  return captureMatches(posts, minhas, hidden, now).sort((a, b) =>
    b.post.posted_at.localeCompare(a.post.posted_at),
  );
}

// ---------------------------------------------------------------------------------------------
// Minha carreira, PR 2 (card t_0219ca7f): bloco "Meu mês". Dados das tabelas minhas_metas e
// carreira_taxas e da RPC meu_realizado (migração 20261016120000), sempre do corretor logado.

export type MinhaMeta = {
  id?: string;
  periodo: "mes" | "ano";
  inicio: string;
  meta_comissao: number | null;
  meta_vgv: number | null;
  meta_vendas: number | null;
  meta_captacoes: number | null;
};

export type Taxas = {
  comissao_media: number | null;
  ligacoes_por_visita: number;
  visitas_por_acm: number;
  acms_por_venda: number;
  acms_por_captacao: number;
};

export type TaxasRow = Taxas & { user_id: string | null };

/** Mesmos valores padrão da tabela carreira_taxas (quando a imobiliária ainda não definiu). */
export const TAXAS_PADRAO: Taxas = {
  comissao_media: null,
  ligacoes_por_visita: 10,
  visitas_por_acm: 3,
  acms_por_venda: 4,
  acms_por_captacao: 2,
};

export type Realizado = {
  comissao: number;
  vendas: number;
  vgv: number;
  /** null = módulo de captação desligado (sem dado). */
  captacoes: number | null;
  como_captador: number;
  vgv_captador: number;
  como_vendedor: number;
  vgv_vendedor: number;
};

const n = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

export function normalizarRealizado(r: Record<string, unknown> | null | undefined): Realizado {
  const z = (k: string) => n(r?.[k]) ?? 0;
  return {
    comissao: z("comissao"),
    vendas: z("vendas"),
    vgv: z("vgv"),
    captacoes: n(r?.captacoes),
    como_captador: z("como_captador"),
    vgv_captador: z("vgv_captador"),
    como_vendedor: z("como_vendedor"),
    vgv_vendedor: z("vgv_vendedor"),
  };
}

/** Taxas efetivas: as do corretor > padrão da imobiliária > padrão do sistema. */
export function taxasEfetivas(
  rows: TaxasRow[],
  userId: string,
): { taxas: Taxas; proprias: boolean } {
  const minha = rows.find((r) => r.user_id === userId);
  const org = rows.find((r) => r.user_id == null);
  const base = minha ?? org;
  if (!base) return { taxas: { ...TAXAS_PADRAO }, proprias: false };
  return {
    taxas: {
      comissao_media: n(base.comissao_media) ?? n(org?.comissao_media) ?? null,
      ligacoes_por_visita: Number(base.ligacoes_por_visita),
      visitas_por_acm: Number(base.visitas_por_acm),
      acms_por_venda: Number(base.acms_por_venda),
      acms_por_captacao: Number(base.acms_por_captacao),
    },
    proprias: !!minha,
  };
}

/** Primeiro dia do mês / do ano e último dia do mês, no horário de São Paulo (AAAA-MM-DD). */
export function periodoAtual(now = new Date()) {
  const [y, m, d] = now
    .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
    .split("-")
    .map(Number);
  const pad = (x: number) => String(x).padStart(2, "0");
  const diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    mes: `${y}-${pad(m)}-01`,
    fimMes: `${y}-${pad(m)}-${pad(diasMes)}`,
    ano: `${y}-01-01`,
    fimAno: `${y}-12-31`,
    hoje: `${y}-${pad(m)}-${pad(d)}`,
    dia: d,
    diasMes,
  };
}

/** Projeção linear no ritmo atual: realizado / dias passados × dias do período. */
export function projecao(realizado: number, diaHoje: number, diasPeriodo: number): number {
  if (diaHoje <= 0 || diasPeriodo <= 0) return realizado;
  return Math.round((realizado / Math.min(diaHoje, diasPeriodo)) * diasPeriodo);
}

export const falta = (meta: number | null, feito: number) =>
  meta == null ? null : Math.max(0, meta - feito);

export type Funil = {
  vendas: number;
  captacoes: number;
  acms: number;
  visitas: number;
  ligacoes: number;
};

/**
 * Calculadora de trás para frente. Vendas que faltam = maior entre a falta em quantidade e a falta
 * em comissão / comissão média (se houver). ACMs = vendas × ACMs por venda + captações × ACMs por
 * captação; visitas = ACMs × visitas por ACM; ligações = visitas × ligações por visita.
 */
export function calcularFunil(
  t: Taxas,
  faltam: { vendas: number | null; comissao: number | null; captacoes: number | null },
): Funil {
  const porComissao =
    faltam.comissao != null && t.comissao_media && t.comissao_media > 0
      ? Math.ceil(faltam.comissao / t.comissao_media)
      : 0;
  const vendas = Math.max(faltam.vendas ?? 0, porComissao);
  const captacoes = Math.max(0, faltam.captacoes ?? 0);
  const acms = Math.ceil(vendas * t.acms_por_venda + captacoes * t.acms_por_captacao);
  const visitas = Math.ceil(acms * t.visitas_por_acm);
  const ligacoes = Math.ceil(visitas * t.ligacoes_por_visita);
  return { vendas, captacoes, acms, visitas, ligacoes };
}

/** Dias úteis (seg–sex) de hoje até o fim do período, inclusive hoje. Mínimo 1. */
export function diasUteisRestantes(hoje: string, fim: string): number {
  const a = new Date(`${hoje}T12:00:00Z`);
  const b = new Date(`${fim}T12:00:00Z`);
  let c = 0;
  for (const d = a; d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) c++;
  }
  return Math.max(1, c);
}
