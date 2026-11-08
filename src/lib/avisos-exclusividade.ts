// Avisos de exclusividade vencendo + reunião de 45 dias com o proprietário (cartão t_c337fc12, Denis 08/11/2026).
// Só contas puras: usadas pela rotina diária do servidor e pelas telas. Imports relativos: também carregado
// pela task do Nitro (server/tasks).
//
// Vencimento: SEMPRE captureValidity (signed_on + form_data.condicoes.prazo_dias_numero, prazo individual).
// Mensagens: só código e bairro do imóvel; nunca nome/telefone do proprietário.
import { captureValidity, type Capture, type Validity } from "./exclusive-captures";

export const REUNIAO_DIAS = 45;
const DIA_MS = 86_400_000;

export type TipoAviso =
  | "vence_30"
  | "vence_15"
  | "vence_hoje"
  | "vencida_semanal"
  | "reuniao_45"
  | "reuniao_semanal"
  | "resumo_gestor";

export const TIPO_AVISO_LABEL: Record<TipoAviso, string> = {
  vence_30: "Vence em até 30 dias",
  vence_15: "Vence em até 15 dias",
  vence_hoje: "Venceu hoje",
  vencida_semanal: "Vencida (lembrete semanal)",
  reuniao_45: "Reunião de 45 dias",
  reuniao_semanal: "Reunião pendente (lembrete semanal)",
  resumo_gestor: "Resumo semanal do gestor/TL",
};

export function addDias(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
}
export function diasEntreDatas(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);
}
/** Segunda-feira = 1 ... domingo = 7 (data civil). */
export function diaDaSemana(iso: string): number {
  return ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export type CapturaAviso = Pick<
  Capture,
  "id" | "captor_id" | "status" | "signed_on" | "form_data" | "archived_at" | "broker_name"
> & {
  organization_id: string;
  discarded_at?: string | null;
};

/** "Código / Bairro". Código = código do anúncio vinculado (se houver) ou os 6 primeiros do id. */
export function rotuloImovel(
  c: Pick<CapturaAviso, "id" | "form_data">,
  codigoAnuncio?: string | null,
): string {
  const codigo = codigoAnuncio?.trim() || `#${c.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  const bairro = c.form_data?.imovel?.bairro?.trim();
  return bairro ? `${codigo} / ${bairro}` : codigo;
}

/** Captação que pode receber aviso: aprovada (assinada), com data e prazo, não encerrada/cancelada/vendida. */
export function elegivel(c: CapturaAviso, vendida: boolean): boolean {
  return c.status === "aprovada" && !c.archived_at && !c.discarded_at && !vendida && !!c.signed_on;
}

export type StatusReuniao = {
  /** Data de onde a contagem parte: última reunião registrada ou a assinatura. */
  base: string;
  dias: number;
  pendente: boolean;
  ultimaReuniao: string | null;
};

/**
 * Reunião de prestação de contas: a cada 45 dias de exclusividade em vigor. A contagem começa no signed_on e
 * recomeça a cada reunião registrada. Fora de vigor (vencida, sem assinatura) devolve null.
 */
export function statusReuniao(
  c: Pick<CapturaAviso, "status" | "signed_on" | "form_data">,
  reunioes: readonly string[],
  hoje: string,
): StatusReuniao | null {
  const v = captureValidity(c, hoje);
  if (!v || v.daysLeft < 0 || !c.signed_on) return null;
  const validas = reunioes.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= hoje).sort();
  const ultima = validas.length ? validas[validas.length - 1] : null;
  const base = ultima && ultima > c.signed_on ? ultima : c.signed_on;
  const dias = Math.max(0, diasEntreDatas(base, hoje));
  return { base, dias, pendente: dias >= REUNIAO_DIAS, ultimaReuniao: ultima };
}

export function textoStatusReuniao(s: StatusReuniao): string {
  return s.pendente
    ? `Reunião pendente (${s.dias} dias)`
    : `Reunião em dia (${s.dias} ${s.dias === 1 ? "dia" : "dias"} desde a ${s.ultimaReuniao ? "última" : "assinatura"})`;
}

export type AvisoPlanejado = {
  tipo: Exclude<TipoAviso, "resumo_gestor">;
  /** Data-chave da deduplicação (pessoa + captação + tipo + chave nunca repete). */
  chave: string;
  titulo: string;
  mensagem: string;
};

/**
 * Avisos do corretor para UMA captação hoje. A deduplicação (já enviado?) é feita fora, pela chave.
 * - 30 dias: entra quando faltam de 16 a 30 dias (chave = fim) → 1 vez por vencimento;
 * - 15 dias: faltam de 1 a 15 (chave = fim) → 1 vez;
 * - no dia: faltam 0 (chave = fim);
 * - vencida: 1 por semana (7, 14, 21... dias depois; chave = início da semana do lembrete), até renovar
 *   (o fim muda) ou encerrar (deixa de ser elegível);
 * - reunião: aos 45 dias sem reunião (chave = base + 45), depois 1 por semana enquanto pendente.
 */
export function avisosDaCaptacao(
  c: CapturaAviso,
  opts: { hoje: string; vendida: boolean; reunioes: readonly string[]; codigoAnuncio?: string | null },
): AvisoPlanejado[] {
  if (!elegivel(c, opts.vendida)) return [];
  const v: Validity | null = captureValidity(c, opts.hoje);
  if (!v) return [];
  const imovel = rotuloImovel(c, opts.codigoAnuncio);
  const out: AvisoPlanejado[] = [];
  const faltam = (n: number) =>
    `Faltam ${n} ${n === 1 ? "dia" : "dias"} para vencer a exclusividade do imóvel ${imovel}. Bom momento para conversar com o proprietário sobre a renovação.`;
  if (v.daysLeft > 15 && v.daysLeft <= 30)
    out.push({
      tipo: "vence_30",
      chave: v.end,
      titulo: "Exclusividade vence em até 30 dias",
      mensagem: faltam(v.daysLeft),
    });
  else if (v.daysLeft > 0 && v.daysLeft <= 15)
    out.push({
      tipo: "vence_15",
      chave: v.end,
      titulo: "Exclusividade vence em até 15 dias",
      mensagem: faltam(v.daysLeft),
    });
  else if (v.daysLeft === 0)
    out.push({
      tipo: "vence_hoje",
      chave: v.end,
      titulo: "Exclusividade venceu hoje",
      mensagem: `A exclusividade do imóvel ${imovel} venceu hoje. Fale com o proprietário sobre renovar ou encerrar.`,
    });
  else if (v.daysLeft <= -7) {
    const semanas = Math.floor(-v.daysLeft / 7);
    const dias = -v.daysLeft;
    out.push({
      tipo: "vencida_semanal",
      chave: addDias(v.end, semanas * 7),
      titulo: "Exclusividade vencida",
      mensagem: `A exclusividade do imóvel ${imovel} venceu há ${dias} dias. Fale com o proprietário sobre renovar ou encerrar.`,
    });
  }

  const r = statusReuniao(c, opts.reunioes, opts.hoje);
  if (r?.pendente) {
    const k = Math.floor((r.dias - REUNIAO_DIAS) / 7);
    out.push({
      tipo: k === 0 ? "reuniao_45" : "reuniao_semanal",
      chave: addDias(r.base, REUNIAO_DIAS + k * 7),
      titulo: "Reunião com o proprietário pendente",
      mensagem: `Já são ${r.dias} dias sem reunião com o proprietário do imóvel ${imovel}. Faça a reunião de prestação de contas e registre no ADM MAX.`,
    });
  }
  return out;
}

export type LinhaResumo = {
  corretorId: string;
  corretor: string;
  vencidas: string[];
  vencem15: string[];
  reunioesPendentes: string[];
};

/** Resumo semanal (segunda de manhã) para gestor/TL, separado por corretor. Vazio = não envia. */
export function linhasResumo(
  caps: readonly CapturaAviso[],
  opts: {
    hoje: string;
    vendidas: ReadonlySet<string>;
    reunioes: ReadonlyMap<string, readonly string[]>;
    codigos: ReadonlyMap<string, string>;
    nomes: ReadonlyMap<string, string>;
  },
): LinhaResumo[] {
  const por = new Map<string, LinhaResumo>();
  for (const c of caps) {
    if (!elegivel(c, opts.vendidas.has(c.id))) continue;
    const v = captureValidity(c, opts.hoje);
    if (!v) continue;
    const r = statusReuniao(c, opts.reunioes.get(c.id) ?? [], opts.hoje);
    const venc = v.daysLeft < 0;
    const em15 = v.daysLeft >= 0 && v.daysLeft <= 15;
    if (!venc && !em15 && !r?.pendente) continue;
    const l = por.get(c.captor_id) ?? {
      corretorId: c.captor_id,
      corretor: opts.nomes.get(c.captor_id) || c.broker_name || "Corretor",
      vencidas: [],
      vencem15: [],
      reunioesPendentes: [],
    };
    const rot = rotuloImovel(c, opts.codigos.get(c.id));
    if (venc) l.vencidas.push(rot);
    if (em15) l.vencem15.push(rot);
    if (r?.pendente) l.reunioesPendentes.push(rot);
    por.set(c.captor_id, l);
  }
  return [...por.values()].sort((a, b) => a.corretor.localeCompare(b.corretor));
}

const MAX_ITENS = 6;
export function mensagemResumo(linhas: readonly LinhaResumo[]): string {
  const lista = (xs: string[]) =>
    xs.slice(0, MAX_ITENS).join(", ") + (xs.length > MAX_ITENS ? ` e mais ${xs.length - MAX_ITENS}` : "");
  const partes = ["Resumo semanal das exclusividades da sua equipe:"];
  for (const l of linhas) {
    const itens: string[] = [];
    if (l.vencidas.length) itens.push(`vencidas (${l.vencidas.length}): ${lista(l.vencidas)}`);
    if (l.vencem15.length) itens.push(`vencem em até 15 dias (${l.vencem15.length}): ${lista(l.vencem15)}`);
    if (l.reunioesPendentes.length)
      itens.push(`reuniões pendentes (${l.reunioesPendentes.length}): ${lista(l.reunioesPendentes)}`);
    partes.push(`\n${l.corretor}\n- ${itens.join("\n- ")}`);
  }
  return partes.join("\n");
}

/** Contagens da tela de Exclusividades: reuniões pendentes entre as captações em vigor. */
export function contarReunioesPendentes(
  caps: readonly CapturaAviso[],
  reunioes: ReadonlyMap<string, readonly string[]>,
  hoje: string,
  vendidas: ReadonlySet<string> = new Set(),
): number {
  let n = 0;
  for (const c of caps) {
    if (!elegivel(c, vendidas.has(c.id))) continue;
    if (statusReuniao(c, reunioes.get(c.id) ?? [], hoje)?.pendente) n++;
  }
  return n;
}
