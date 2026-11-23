/**
 * Soma de planos da equipe/imobiliária, meta da direção e cobertura (cartão t_f87b2ae5). Puro.
 *
 * - OFICIAL = soma de quem CONTA NA META: planos ASSINADOS + metas oficiais gravadas pelo clique "Usar como minha
 *   meta oficial" ainda sem assinatura (t_bd480fee, Denis 23/11). "Em preenchimento" sem meta oficial vem separado
 *   e NUNCA entra na meta oficial nem no farol.
 * - Meta da direção (comissão, vendas, VGV e captações do ANO, sem mês a mês por enquanto) é comparada
 *   com a soma dos assinados: diferença positiva = os planos passam da direção.
 * - Cobertura = quem tem plano assinado ÷ quem deveria ter (corretores ativos + gestor/TL que vendem).
 */
import {
  avaliar,
  INDICADORES,
  valoresVazios,
  type Avaliacao,
  type Indicador,
  type MetaPlano,
  type Posicao,
  type SituacaoPlano,
  type Valores,
  metaDoPlano,
  situacaoPlano,
} from "./regra";
import type { Respostas, TaxasFunil } from "@/lib/meu-plano-2027/regras";

export type PlanoPessoa = {
  userId: string;
  situacao: SituacaoPlano;
  /**
   * Meta que vale para a pessoa: assinado = metaDoPlano(respostas); não assinado com meta oficial gravada =
   * metaDaGravada (valores do clique); senão metaDoPlano(respostas) só para informar. null = sem meta.
   */
  meta: MetaPlano | null;
  /** true = `meta` veio da meta oficial GRAVADA pelo clique "Usar como minha meta oficial" (sem assinatura). */
  oficial?: boolean;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Selo de cada pessoa na meta da equipe (cartões t_a4fff17e e t_bd480fee). Regra ÚNICA, usada pelo somarPlanos,
 * pelos 3 painéis de metas e pelo selo da lista da Equipe do Meu Plano, para nunca divergirem:
 * - "conta": plano assinado E com meta (VGC) → entra na soma (igual a antes);
 * - "conta_falta_assinar": não assinou, mas gravou a meta oficial ("Usar como minha meta oficial", Denis 23/11)
 *   → entra na soma com os valores GRAVADOS; o pacto continua sem assinatura;
 * - "assinado_sem_meta": assinou, mas o plano não fecha meta (sem VGC) → não soma;
 * - "falta_meta": sem assinatura e sem meta oficial gravada (ou plano reaberto) → não conta.
 */
export type SeloMeta = "conta" | "conta_falta_assinar" | "assinado_sem_meta" | "falta_meta";
export function seloMeta(p: Pick<PlanoPessoa, "situacao" | "meta" | "oficial">): SeloMeta {
  if (p.situacao === "assinado") return p.meta ? "conta" : "assinado_sem_meta";
  return p.oficial && p.meta ? "conta_falta_assinar" : "falta_meta";
}

/** O selo entra na meta da equipe/imobiliária (soma, realizado comparado e farol)? */
export const contaNaMeta = (selo: SeloMeta) => selo === "conta" || selo === "conta_falta_assinar";

/** Texto e cor do selo na lista da Equipe do Meu Plano. */
export const SELO_META: Record<SeloMeta, { texto: string; tom: "green" | "amber" | "slate" }> = {
  conta: { texto: "Conta na meta", tom: "green" },
  conta_falta_assinar: { texto: "Conta na meta · falta assinar", tom: "amber" },
  assinado_sem_meta: { texto: "Assinou, falta a meta", tom: "amber" },
  falta_meta: { texto: "Falta a meta oficial", tom: "slate" },
};

/** Contador "X de N já contam na meta": quantos entram no somarPlanos (assinados + metas oficiais gravadas). */
export const contarNaMeta = (linhas: readonly { selo: SeloMeta }[]) =>
  linhas.filter((l) => contaNaMeta(l.selo)).length;

/** Cópia gravada em carreira_plano.meta_oficial pelo clique "Usar como minha meta oficial" (ou pela assinatura). */
export type MetaOficialGravada = {
  meta_comissao?: number | string | null;
  meta_vgv?: number | string | null;
  meta_vendas?: number | string | null;
  meta_captacoes?: number | string | null;
};

const numOuNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * Meta do ANO = valores GRAVADOS no clique (não recalcula das respostas). Mês a mês = o formato do próprio plano
 * (`formato` = metaDoPlano das respostas atuais), reescalado para fechar no valor gravado; sem formato, ano ÷ 12.
 * null = gravada sem meta de comissão (VGC), que é a meta principal.
 */
export function metaDaGravada(
  g: MetaOficialGravada | null | undefined,
  formato: MetaPlano | null,
): MetaPlano | null {
  if (!g) return null;
  const ano: Valores = {
    comissao: numOuNull(g.meta_comissao),
    vendas: numOuNull(g.meta_vendas),
    vgv: numOuNull(g.meta_vgv),
    captacoes: numOuNull(g.meta_captacoes),
  };
  if (ano.comissao == null) return null;
  const meses = Array.from({ length: 12 }, valoresVazios);
  const diverge = {} as Record<Indicador, boolean>;
  for (const k of INDICADORES) {
    diverge[k] = false;
    const a = ano[k];
    if (a == null) continue;
    const base = formato?.meses.map((m) => m[k] ?? 0);
    const tot = base?.reduce((t, x) => t + x, 0) ?? 0;
    for (let i = 0; i < 12; i++) meses[i][k] = r2(base && tot > 0 ? (base[i] / tot) * a : a / 12);
  }
  return { ano, meses, diverge };
}

/**
 * Plano cru (assinatura + respostas + meta oficial gravada, como vem da RPC) → situação, meta e selo, com a MESMA
 * conta do painel de metas (situacaoPlano + metaDoPlano com as taxas padrão). Vai direto para o somarPlanos.
 * Meta oficial só vale com o valor E a data gravados (a reabertura do plano apaga os dois).
 */
export function planoComSelo(
  p:
    | {
        assinadoEm?: string | null;
        respostas?: Respostas | null;
        metaOficial?: MetaOficialGravada | null;
        metaOficialEm?: string | null;
      }
    | null
    | undefined,
  padrao?: Partial<TaxasFunil> | null,
): { situacao: SituacaoPlano; meta: MetaPlano | null; oficial: boolean; selo: SeloMeta } {
  const situacao = situacaoPlano(p);
  const doPlano = situacao === "sem_plano" ? null : metaDoPlano(p?.respostas, padrao);
  const gravada =
    situacao !== "assinado" && p?.metaOficial && p.metaOficialEm
      ? metaDaGravada(p.metaOficial, doPlano)
      : null;
  const oficial = gravada != null;
  const meta = gravada ?? doPlano;
  return { situacao, meta, oficial, selo: seloMeta({ situacao, meta, oficial }) };
}

function somar(alvo: Valores, v: Valores) {
  for (const k of INDICADORES) {
    const x = v[k];
    if (x == null) continue;
    alvo[k] = r2((alvo[k] ?? 0) + x);
  }
}

export type SomaPlanos = {
  /**
   * Meta OFICIAL do grupo = soma de quem CONTA NA META (assinados + metas oficiais gravadas sem assinatura,
   * Denis 23/11); null em mês/indicador sem nenhum valor. O nome ficou por compatibilidade.
   */
  assinados: MetaPlano | null;
  /** Soma do ano dos planos em preenchimento SEM meta oficial gravada (só informativo, não conta). */
  preenchimentoAno: Valores;
  /** Pactos assinados (com ou sem meta): continua separado para o broker cobrar a assinatura. */
  qtdAssinados: number;
  /** Quantos entram na soma (selo "conta" + "conta_falta_assinar"). */
  qtdContam: number;
  /** Desses, quantos ainda não assinaram (meta oficial gravada pelo clique). */
  qtdFaltaAssinar: number;
  /** Em preenchimento SEM meta oficial gravada. */
  qtdPreenchimento: number;
  qtdSemPlano: number;
};

/** Soma os planos (cada pessoa uma vez, mesmo se repetida na lista). */
export function somarPlanos(planos: readonly PlanoPessoa[]): SomaPlanos {
  const vistos = new Set<string>();
  const ano = valoresVazios();
  const meses = Array.from({ length: 12 }, valoresVazios);
  const preenchimentoAno = valoresVazios();
  let qtdAssinados = 0;
  let qtdContam = 0;
  let qtdFaltaAssinar = 0;
  let qtdPreenchimento = 0;
  let qtdSemPlano = 0;
  for (const p of planos) {
    if (vistos.has(p.userId)) continue;
    vistos.add(p.userId);
    const selo = seloMeta(p);
    if (contaNaMeta(selo) && p.meta) {
      qtdContam++;
      if (selo === "conta") qtdAssinados++;
      else qtdFaltaAssinar++;
      somar(ano, p.meta.ano);
      p.meta.meses.forEach((m, i) => somar(meses[i], m));
    } else if (selo === "assinado_sem_meta") {
      // Assinado mas incompleto (sem VGC): conta como assinado, sem somar meta.
      qtdAssinados++;
    } else if (p.situacao === "preenchimento") {
      qtdPreenchimento++;
      if (p.meta) somar(preenchimentoAno, p.meta.ano);
    } else qtdSemPlano++;
  }
  const diverge = Object.fromEntries(INDICADORES.map((k) => [k, false])) as Record<
    Indicador,
    boolean
  >;
  return {
    assinados: qtdAssinados + qtdFaltaAssinar > 0 ? { ano, meses, diverge } : null,
    preenchimentoAno,
    qtdAssinados,
    qtdContam,
    qtdFaltaAssinar,
    qtdPreenchimento,
    qtdSemPlano,
  };
}

/**
 * Avaliação de UMA pessoa (painel do corretor e cartões do gestor), com a mesma regra do selo: quem conta na meta
 * (assinado ou meta oficial gravada) tem meta, %, ritmo e farol; os demais ficam ⚪ sem meta.
 */
export function avaliarPessoa(
  p: { situacao: SituacaoPlano; meta: MetaPlano | null; selo: SeloMeta },
  realMeses: Valores[],
  pos: Posicao,
): Avaliacao {
  const conta = contaNaMeta(p.selo);
  return avaliar(conta ? "assinado" : p.situacao, conta ? p.meta : null, realMeses, pos);
}

/** Avaliação do grupo: meta = soma de quem conta; realizado = realizadoMensal do grupo (sem dobro). */
export function avaliarGrupo(soma: SomaPlanos, realMeses: Valores[], pos: Posicao): Avaliacao {
  return avaliar(soma.assinados ? "assinado" : "sem_plano", soma.assinados, realMeses, pos);
}

// --- Meta da direção ------------------------------------------------------------------------------

/** Meta da direção do ANO (proposta de tabela metas_direcao). null = não definida. */
export type MetaDirecao = Valores;

export type ComparacaoDirecao = {
  direcao: number | null;
  somaAssinados: number | null;
  /** somaAssinados − direção. Negativo = faltam planos para chegar na direção. */
  diferenca: number | null;
  /** somaAssinados ÷ direção. */
  pct: number | null;
};

export function compararComDirecao(
  soma: SomaPlanos,
  direcao: MetaDirecao | null | undefined,
): Record<Indicador, ComparacaoDirecao> {
  const out = {} as Record<Indicador, ComparacaoDirecao>;
  for (const k of INDICADORES) {
    const d = direcao?.[k] ?? null;
    const s = soma.assinados?.ano[k] ?? null;
    const temD = d != null && d > 0;
    out[k] = {
      direcao: d,
      somaAssinados: s,
      diferenca: temD ? r2((s ?? 0) - d) : null,
      pct: temD ? Math.round(((s ?? 0) / d) * 10000) / 10000 : null,
    };
  }
  return out;
}

// --- Cobertura de planos --------------------------------------------------------------------------

export type PessoaCobertura = {
  userId: string;
  ativo: boolean;
  papeis: readonly string[];
  /** Gestor/TL com venda própria (o chamador decide pela produção ou pelo plano). */
  vende?: boolean;
};

const PAPEIS_LIDER = new Set(["gestor", "team_leader"]);

/** Entra na cobertura: corretor ativo; gestor/TL ativo só se vende. Admin/financeiro etc. não entram. */
export function contaNaCobertura(p: PessoaCobertura): boolean {
  if (!p.ativo) return false;
  if (p.papeis.includes("corretor")) return true;
  return p.papeis.some((r) => PAPEIS_LIDER.has(r)) && !!p.vende;
}

export type Cobertura = {
  elegiveis: number;
  assinados: number;
  preenchimento: number;
  semPlano: number;
  /** assinados ÷ elegíveis; null sem elegíveis. */
  pct: number | null;
  /** userIds elegíveis sem plano assinado (para o alerta "falta assinar"). */
  faltam: string[];
};

export function coberturaPlanos(
  pessoas: readonly PessoaCobertura[],
  situacaoDe: (userId: string) => SituacaoPlano,
): Cobertura {
  const vistos = new Set<string>();
  let assinados = 0;
  let preenchimento = 0;
  let semPlano = 0;
  const faltam: string[] = [];
  for (const p of pessoas) {
    if (vistos.has(p.userId) || !contaNaCobertura(p)) continue;
    vistos.add(p.userId);
    const s = situacaoDe(p.userId);
    if (s === "assinado") assinados++;
    else {
      faltam.push(p.userId);
      if (s === "preenchimento") preenchimento++;
      else semPlano++;
    }
  }
  const elegiveis = vistos.size;
  return {
    elegiveis,
    assinados,
    preenchimento,
    semPlano,
    pct: elegiveis > 0 ? Math.round((assinados / elegiveis) * 10000) / 10000 : null,
    faltam,
  };
}
