/**
 * Soma de planos da equipe/imobiliária, meta da direção e cobertura (cartão t_f87b2ae5). Puro.
 *
 * - OFICIAL = soma das METAS OFICIAIS GRAVADAS (carreira_plano.meta_oficial), FONTE ÚNICA (t_91ec7aa3, Denis 23/11):
 *   conta quem gravou a meta pelo botão verde "Usar como minha meta oficial" (já no clique, mesmo sem assinar) ou
 *   pela assinatura. Os valores são os GRAVADOS, para todos: o painel não recalcula mais pelas respostas.
 *   Sem meta gravada (mesmo assinado) não conta. Meta gravada fora dos LIMITES de bloqueio fica fora, "a conferir".
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
import { LIMITES } from "@/lib/meu-plano-2027/conferencia";

export type PlanoPessoa = {
  userId: string;
  situacao: SituacaoPlano;
  /**
   * Meta da pessoa: com meta oficial gravada = metaDaGravada (valores GRAVADOS); sem ela = metaDoPlano(respostas)
   * só para informar ("em preenchimento", não conta). null = sem meta.
   */
  meta: MetaPlano | null;
  /** true = `meta` veio da meta oficial GRAVADA (botão verde ou assinatura). Só essa conta na meta. */
  oficial?: boolean;
  /** Meta gravada acima dos limites de bloqueio: fica fora da soma, à parte como "a conferir". */
  foraDoLimite?: boolean;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Selo de cada pessoa na meta da equipe (cartões t_a4fff17e, t_bd480fee e t_91ec7aa3). Regra ÚNICA, usada pelo
 * somarPlanos, pelos 3 painéis de metas e pelo selo/contador da lista da Equipe do Meu Plano:
 * - "conta": tem meta oficial gravada e assinou → entra na soma com os valores GRAVADOS;
 * - "conta_falta_assinar": tem meta oficial gravada (botão verde) e não assinou → entra na soma igual;
 * - "meta_a_conferir": tem meta gravada, mas acima dos LIMITES de bloqueio → fica FORA da soma, à parte;
 * - "assinado_sem_meta": assinou, mas não tem meta oficial gravada → não conta;
 * - "falta_meta": sem assinatura e sem meta oficial gravada (ou plano reaberto) → não conta.
 */
export type SeloMeta =
  "conta" | "conta_falta_assinar" | "meta_a_conferir" | "assinado_sem_meta" | "falta_meta";
export function seloMeta(
  p: Pick<PlanoPessoa, "situacao" | "meta" | "oficial" | "foraDoLimite">,
): SeloMeta {
  if (p.oficial && p.meta) {
    if (p.foraDoLimite) return "meta_a_conferir";
    return p.situacao === "assinado" ? "conta" : "conta_falta_assinar";
  }
  return p.situacao === "assinado" ? "assinado_sem_meta" : "falta_meta";
}

/** O selo entra na meta da equipe/imobiliária (soma, realizado comparado e farol)? */
export const contaNaMeta = (selo: SeloMeta) => selo === "conta" || selo === "conta_falta_assinar";

/** Texto e cor do selo na lista da Equipe do Meu Plano. */
export const SELO_META: Record<
  SeloMeta,
  { texto: string; tom: "green" | "amber" | "red" | "slate" }
> = {
  conta: { texto: "Conta na meta", tom: "green" },
  conta_falta_assinar: { texto: "Conta na meta · falta assinar", tom: "amber" },
  meta_a_conferir: { texto: "Meta a conferir · não conta", tom: "red" },
  assinado_sem_meta: { texto: "Assinou, falta a meta", tom: "amber" },
  falta_meta: { texto: "Falta a meta oficial", tom: "slate" },
};

/** Contador "X de N já contam na meta": quantos entram no somarPlanos (metas gravadas dentro do limite). */
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
 * Meta gravada acima dos LIMITES de bloqueio (conferencia.ts) → motivo; dentro → null. Denis 23/11: fica FORA da
 * soma oficial e aparece à parte, "a conferir". Mesmos tetos da tela e do banco (carreira_plano_usar_meta):
 * comissão (VGC) acima de R$ 5 mi; transações (captação + venda, até 500 cada) acima de 1.000; captações acima de
 * 500 (mesmo critério usado para desmarcar as metas absurdas em t_b26b7b26).
 */
export function metaGravadaForaDoLimite(g: MetaOficialGravada | null | undefined): string | null {
  if (!g) return null;
  const c = numOuNull(g.meta_comissao);
  const v = numOuNull(g.meta_vendas);
  const k = numOuNull(g.meta_captacoes);
  const maxTrans = LIMITES.transBloqueio * 2;
  if (c != null && c > LIMITES.vgcBloqueio) return "meta de comissão do ano acima de R$ 5 milhões";
  if (v != null && v > maxTrans) return `mais de ${maxTrans} transações no ano`;
  if (k != null && k > LIMITES.transBloqueio)
    return `mais de ${LIMITES.transBloqueio} captações no ano`;
  return null;
}

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
 * Plano cru (assinatura + respostas + meta oficial gravada, como vem da RPC) → situação, meta e selo. Vai direto
 * para o somarPlanos. FONTE ÚNICA (t_91ec7aa3): a meta que conta é a GRAVADA (valor E data; a reabertura apaga os
 * dois), assinado ou não. As respostas só dão o formato mês a mês e, sem meta gravada, a soma informativa.
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
): {
  situacao: SituacaoPlano;
  meta: MetaPlano | null;
  oficial: boolean;
  foraDoLimite: boolean;
  /** Motivo do "a conferir" (meta gravada fora do limite); null = dentro. */
  motivoAConferir: string | null;
  selo: SeloMeta;
} {
  const situacao = situacaoPlano(p);
  const doPlano = situacao === "sem_plano" ? null : metaDoPlano(p?.respostas, padrao);
  const gravada = p?.metaOficial && p.metaOficialEm ? metaDaGravada(p.metaOficial, doPlano) : null;
  const oficial = gravada != null;
  const meta = gravada ?? doPlano;
  const motivoAConferir = oficial ? metaGravadaForaDoLimite(p?.metaOficial) : null;
  const foraDoLimite = motivoAConferir != null;
  return {
    situacao,
    meta,
    oficial,
    foraDoLimite,
    motivoAConferir,
    selo: seloMeta({ situacao, meta, oficial, foraDoLimite }),
  };
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
   * Meta OFICIAL do grupo = soma das metas oficiais GRAVADAS dentro do limite (fonte única, Denis 23/11); null
   * sem nenhuma. O nome ficou por compatibilidade.
   */
  assinados: MetaPlano | null;
  /** Metas gravadas fora do limite: NÃO entram na soma; aparecem à parte, "a conferir". */
  qtdAConferir: number;
  /** Soma do ano dessas metas fora do limite (só informativo). */
  aConferirAno: Valores;
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
  const aConferirAno = valoresVazios();
  let qtdAConferir = 0;
  let qtdAssinados = 0;
  let qtdContam = 0;
  let qtdFaltaAssinar = 0;
  let qtdPreenchimento = 0;
  let qtdSemPlano = 0;
  for (const p of planos) {
    if (vistos.has(p.userId)) continue;
    vistos.add(p.userId);
    const selo = seloMeta(p);
    // Pactos assinados: contados à parte, com ou sem meta (o broker cobra a assinatura).
    if (p.situacao === "assinado") qtdAssinados++;
    if (contaNaMeta(selo) && p.meta) {
      qtdContam++;
      if (selo === "conta_falta_assinar") qtdFaltaAssinar++;
      somar(ano, p.meta.ano);
      p.meta.meses.forEach((m, i) => somar(meses[i], m));
    } else if (selo === "meta_a_conferir") {
      qtdAConferir++;
      if (p.meta) somar(aConferirAno, p.meta.ano);
    } else if (selo === "assinado_sem_meta") {
      // Assinou sem meta oficial gravada: só o pacto conta (acima); não soma meta.
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
    assinados: qtdContam > 0 ? { ano, meses, diverge } : null,
    preenchimentoAno,
    qtdAConferir,
    aConferirAno,
    qtdAssinados,
    qtdContam,
    qtdFaltaAssinar,
    qtdPreenchimento,
    qtdSemPlano,
  };
}

/**
 * Avaliação de UMA pessoa (painel do corretor e cartões do gestor), com a mesma regra do selo: quem conta na meta
 * (meta oficial gravada dentro do limite) tem meta, %, ritmo e farol; os demais ficam ⚪ sem meta.
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
