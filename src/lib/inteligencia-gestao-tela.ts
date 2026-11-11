// Inteligência de gestão 2/3 (cartão t_01d580b6): liga os dados das RPCs às regras do cartão 1
// (src/lib/inteligencia-gestao.ts). Só montagem de entrada e textos de tela; NENHUMA regra nova:
//   - farol/sinais/gargalo/previsão = funções do cartão 1;
//   - lead sem resposta = sinalLeads (prazoDoLead do Painel de leads);
//   - reunião de 45 dias = statusReuniao (avisos de exclusividade, PR #285);
//   - VGC = pontas do Painel da Equipe (painel-equipe-calc.ts).
import { dataCivilSaoPaulo } from "./hoje-sao-paulo";
import { CONFIG_PADRAO, type LeadConfig } from "./leads";
import { statusReuniao } from "./avisos-exclusividade";
import type { Feito, MetasSemana } from "./meta-atividades";
import {
  diasEntre,
  mesAnterior,
  mesDaData,
  resumoMes,
  type PainelEquipeDados,
} from "./painel-equipe-calc";
import type { ProducaoPonta } from "./producao-por-pessoa-types";
import {
  capturaBase,
  gargalo,
  sinalLeads,
  trimestreDe,
  umAUmAtrasada,
  type CaptacaoFarol,
  type Combinado,
  type CorSinal,
  type EntradaFarol,
  type Farol,
  type Funil90,
  type Gargalo,
  type LeadFarol,
} from "./inteligencia-gestao";

// --- Dados de gestao_farol_dados (migration 20261108180000) ----------------------------------------

export type Ultima1a1 = {
  id: string;
  data: string;
  proxima_data: string;
  /** Nome de quem conduziu. */
  com: string | null;
  combinados: Combinado[];
};

export type FarolPessoa = {
  user_id: string;
  nome: string;
  team_id: string | null;
  entrou_em: string | null;
  metas_em: string | null;
  leads: LeadFarol[] | null;
  captacoes: CaptacaoFarol[] | null;
  funil90: Funil90 | null;
  funil90_equipe: Funil90 | null;
  ultima_1a1: Ultima1a1 | null;
};

export type FarolDados = {
  hoje: string;
  lead_config: Pick<
    LeadConfig,
    "prazo_aceite_min" | "prazo_primeira_interacao_dias" | "prazo_sem_interacao_dias"
  > | null;
  taxas_em: string | null;
  pessoas: FarolPessoa[];
};

export const FEITO_ZERO: Feito = {
  ligacoes: 0,
  v1: 0,
  v2: 0,
  acm: 0,
  visitaComprador: 0,
  captMes: 0,
};
const FUNIL_ZERO: Funil90 = { ligacoes: 0, v1: 0, v2: 0, captacoes: 0 };
const n0 = (v: unknown) => (v == null ? 0 : Number(v) || 0);

function funil(x: unknown): Funil90 | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  return { ligacoes: n0(r.ligacoes), v1: n0(r.v1), v2: n0(r.v2), captacoes: n0(r.captacoes) };
}

/** Normaliza o JSON da RPC (números podem vir como texto; listas ausentes ficam null). */
export function normalizarFarolDados(raw: unknown): FarolDados {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pessoas = Array.isArray(r.pessoas) ? (r.pessoas as Record<string, unknown>[]) : [];
  return {
    hoje: String(r.hoje ?? ""),
    lead_config: (r.lead_config as FarolDados["lead_config"]) ?? null,
    taxas_em: (r.taxas_em as string | null) ?? null,
    pessoas: pessoas.map((p) => {
      const u = p.ultima_1a1 as Record<string, unknown> | null;
      return {
        user_id: String(p.user_id),
        nome: (p.nome as string | null) ?? "Corretor",
        team_id: (p.team_id as string | null) ?? null,
        entrou_em: (p.entrou_em as string | null) ?? null,
        metas_em: (p.metas_em as string | null) ?? null,
        leads: Array.isArray(p.leads) ? (p.leads as LeadFarol[]) : null,
        captacoes: Array.isArray(p.captacoes)
          ? (p.captacoes as Record<string, unknown>[]).map((c) => ({
              id: String(c.id),
              status: String(c.status),
              signed_on: (c.signed_on as string | null) ?? null,
              prazo_dias: c.prazo_dias == null ? null : String(c.prazo_dias),
              vendida: c.vendida === true,
              reunioes: Array.isArray(c.reunioes) ? (c.reunioes as string[]) : null,
            }))
          : null,
        funil90: funil(p.funil90),
        funil90_equipe: funil(p.funil90_equipe),
        ultima_1a1: u
          ? {
              id: String(u.id),
              data: String(u.data),
              proxima_data: String(u.proxima_data),
              com: (u.com as string | null) ?? null,
              combinados: Array.isArray(u.combinados) ? (u.combinados as Combinado[]) : [],
            }
          : null,
      };
    }),
  };
}

/** Prazos de lead da imobiliária (os outros campos do LeadConfig não entram na regra de prazo). */
export function leadConfigDe(d: FarolDados): LeadConfig | null {
  return d.lead_config ? { ...CONFIG_PADRAO, ...d.lead_config } : null;
}

/**
 * Entrada do farol de uma pessoa. `copiaMetas` = as metas vieram da cópia ms.* (visão do TL): só aí a
 * tela pode mostrar "meta de DD/MM".
 */
export function entradaDaPessoa(
  p: FarolPessoa,
  d: FarolDados,
  extra: {
    dias_sem_vender: number | null;
    semana: Feito;
    metas: MetasSemana | null;
    copiaMetas: boolean;
  },
): EntradaFarol {
  return {
    user_id: p.user_id,
    nome: p.nome,
    entrou_em: p.entrou_em,
    dias_sem_vender: extra.dias_sem_vender,
    semana: extra.semana,
    capt_mes: extra.semana.captMes,
    metas: extra.metas,
    metas_em: extra.copiaMetas ? p.metas_em : null,
    taxas_em: extra.copiaMetas ? dataCivilSaoPaulo(d.taxas_em) : null,
    leads: p.leads,
    lead_config: leadConfigDe(d),
    captacoes: p.captacoes,
  };
}

export const gargaloDaPessoa = (p: FarolPessoa): Gargalo =>
  gargalo(p.funil90 ?? FUNIL_ZERO, p.funil90_equipe ?? FUNIL_ZERO);

// --- "O que fazer hoje": itens que ainda não existiam em minhas_pendencias -----------------------------

export type KindExtra = "lead_sem_resposta" | "reuniao_45" | "um_a_um_atrasada";
export type PendenciaExtra = {
  kind: KindExtra;
  chave: string;
  detalhe: string;
  imovel: string | null;
  /** Captação (reunião de 45 dias) para o link "Abrir". */
  capture_id: string | null;
};
export const ROTULO_EXTRA: Record<KindExtra, string> = {
  lead_sem_resposta: "Lead sem resposta",
  reuniao_45: "Reunião 45 dias",
  um_a_um_atrasada: "1:1 atrasada",
};

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * "Lead sem resposta" (só prazo vencido, a mesma conta do sinal de leads) e "Reunião 45 dias" (reunião
 * pendente pela regra dos avisos; só onde o módulo de avisos está ligado — senão `reunioes` vem null).
 */
export function pendenciasExtras(
  p: FarolPessoa,
  d: FarolDados,
  hoje: string,
  agora: Date,
  imovelDe: (captureId: string) => string | null = () => null,
): PendenciaExtra[] {
  const out: PendenciaExtra[] = [];
  const s = sinalLeads(p.leads, leadConfigDe(d), agora);
  if (s.cor === "vermelho")
    out.push({
      kind: "lead_sem_resposta",
      chave: `lead-${p.user_id}`,
      detalhe: s.texto,
      imovel: null,
      capture_id: null,
    });
  for (const c of p.captacoes ?? []) {
    const base = capturaBase(c);
    if (!base || !c.reunioes) continue;
    const r = statusReuniao(base, c.reunioes, hoje);
    if (!r?.pendente) continue;
    out.push({
      kind: "reuniao_45",
      chave: `reuniao-${c.id}`,
      detalhe: `${r.dias} dias sem reunião com o proprietário`,
      imovel: imovelDe(c.id),
      capture_id: c.id,
    });
  }
  return out;
}

/** Para gestor/TL: uma linha por corretor com a próxima 1:1 vencida. */
export function umAUmAtrasadas(d: FarolDados, hoje: string): PendenciaExtra[] {
  return d.pessoas
    .filter((p) => umAUmAtrasada(p.ultima_1a1?.proxima_data ?? null, hoje))
    .sort((a, b) =>
      (a.ultima_1a1?.proxima_data ?? "").localeCompare(b.ultima_1a1?.proxima_data ?? ""),
    )
    .map((p) => ({
      kind: "um_a_um_atrasada" as const,
      chave: `1a1-${p.user_id}`,
      detalhe: `1:1 com ${p.nome} era para ${ddmm(p.ultima_1a1!.proxima_data)}`,
      imovel: null,
      capture_id: null,
    }));
}

// --- Previsão do trimestre (bloco "Meta do mês" do Painel da Equipe) -----------------------------------

/**
 * Insumos da previsão na base do Painel da Equipe (pontas da equipe = mesma conta do VGC do topo):
 *   recebido   = VGC das vendas da equipe já concluídas, assinadas no trimestre;
 *   andamento  = VGC das vendas da equipe ainda em andamento (assinadas e não concluídas);
 *   ritmo      = média do VGC da equipe nos 3 meses anteriores ao mês atual.
 * shortcut: venda ainda sem assinatura não tem VGC nas pontas e fica fora do "andamento".
 */
export function insumosPrevisao(
  dados: PainelEquipeDados,
  pontas: readonly ProducaoPonta[],
  hoje: string,
) {
  const tri = trimestreDe(hoje);
  const abertas = new Set(
    dados.andamento.filter((a) => a.status !== "ocorrencia_concluida").map((a) => a.sale_id),
  );
  let recebido = 0;
  let andamento = 0;
  for (const p of pontas) {
    if (p.teamId !== dados.equipe.id) continue;
    if (abertas.has(p.saleId)) andamento += p.comissao;
    else if (tri.meses.includes(mesDaData(p.concluidaEm) ?? "")) recebido += p.comissao;
  }
  const meses: string[] = [];
  let m = hoje.slice(0, 7);
  for (let i = 0; i < 3; i++) meses.push((m = mesAnterior(m)));
  const ritmoMensal =
    meses.reduce((s, x) => s + resumoMes(dados, pontas as ProducaoPonta[], x).vgc, 0) / 3;
  return {
    trimestre: tri,
    recebido: Math.round(recebido * 100) / 100,
    andamento: Math.round(andamento * 100) / 100,
    ritmoMensal: Math.round(ritmoMensal * 100) / 100,
    mesesRestantes: tri.mesesRestantes,
  };
}

/** Meta do trimestre = soma das metas de comissão da equipe nos 3 meses (metas_progresso). Sem nenhuma = null. */
export function somaMetas(valores: readonly (number | null | undefined)[]): number | null {
  const v = valores.filter((x): x is number => x != null && Number(x) > 0).map(Number);
  return v.length ? v.reduce((s, x) => s + x, 0) : null;
}

// --- Pauta: números do mês ---------------------------------------------------------------------------------

export function numerosDoMes(i: {
  dias_sem_vender: number | null;
  mes: Omit<Feito, "captMes" | "visitaComprador">;
  captMes: number;
  metas: MetasSemana | null;
}): Record<string, number | string | null> {
  const de = (f: number, m: number | undefined) => (m == null ? String(f) : `${f} de ${m}`);
  return {
    "Dias sem vender": i.dias_sem_vender == null ? "ainda não vendeu" : i.dias_sem_vender,
    "Ligações no mês": de(i.mes.ligacoes, i.metas?.mes.ligacoes),
    "V1 no mês": de(i.mes.v1, i.metas?.mes.v1),
    "V2 no mês": de(i.mes.v2, i.metas?.mes.v2),
    "ACM no mês": de(i.mes.acm, i.metas?.mes.acm),
    "Captações no mês": de(i.captMes, i.metas?.captMes),
  };
}

/** Dias desde a última venda (data civil) — null = nunca vendeu. */
export function diasDesde(ultima: string | null | undefined, hoje: string): number | null {
  const d = dataCivilSaoPaulo(ultima ?? null);
  return d ? diasEntre(d, hoje) : null;
}

// --- Apresentação ------------------------------------------------------------------------------------------

export type TomSinal = "green" | "amber" | "red" | "slate";
export const TOM_COR: Record<CorSinal, TomSinal> = {
  verde: "green",
  amarelo: "amber",
  vermelho: "red",
  sem_plano: "slate",
  sem_dado: "slate",
  aguardando: "slate",
};
export const EMOJI_COR: Record<CorSinal, string> = {
  verde: "🟢",
  amarelo: "🟡",
  vermelho: "🔴",
  sem_plano: "⚪",
  sem_dado: "⚪",
  aguardando: "⚪",
};
export const TOM_FAROL: Record<Farol, TomSinal | "blue"> = {
  risco: "red",
  atencao: "amber",
  tranquilo: "green",
  novo: "blue",
};

const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** "quinta, 12/11". */
export function dataComDia(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${ddmm(iso)}`;
}
