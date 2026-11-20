/**
 * Soma de planos da equipe/imobiliária, meta da direção e cobertura (cartão t_f87b2ae5). Puro.
 *
 * - OFICIAL = soma dos planos ASSINADOS (ano e meses). "Em preenchimento" vem separado e NUNCA
 *   entra na meta oficial nem no farol.
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
} from "./regra";

export type PlanoPessoa = {
  userId: string;
  situacao: SituacaoPlano;
  /** metaDoPlano(respostas); null = sem plano ou incompleto. */
  meta: MetaPlano | null;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function somar(alvo: Valores, v: Valores) {
  for (const k of INDICADORES) {
    const x = v[k];
    if (x == null) continue;
    alvo[k] = r2((alvo[k] ?? 0) + x);
  }
}

export type SomaPlanos = {
  /** Meta OFICIAL do grupo (só assinados); null em mês/indicador sem nenhum valor. */
  assinados: MetaPlano | null;
  /** Soma do ano dos planos em preenchimento (só informativo). */
  preenchimentoAno: Valores;
  qtdAssinados: number;
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
  let qtdPreenchimento = 0;
  let qtdSemPlano = 0;
  for (const p of planos) {
    if (vistos.has(p.userId)) continue;
    vistos.add(p.userId);
    if (p.situacao === "assinado" && p.meta) {
      qtdAssinados++;
      somar(ano, p.meta.ano);
      p.meta.meses.forEach((m, i) => somar(meses[i], m));
    } else if (p.situacao === "preenchimento") {
      qtdPreenchimento++;
      if (p.meta) somar(preenchimentoAno, p.meta.ano);
    } else if (p.situacao === "assinado") {
      // Assinado mas incompleto (sem VGC): conta como assinado, sem somar meta.
      qtdAssinados++;
    } else qtdSemPlano++;
  }
  const diverge = Object.fromEntries(INDICADORES.map((k) => [k, false])) as Record<
    Indicador,
    boolean
  >;
  return {
    assinados: qtdAssinados > 0 ? { ano, meses, diverge } : null,
    preenchimentoAno,
    qtdAssinados,
    qtdPreenchimento,
    qtdSemPlano,
  };
}

/** Avaliação do grupo: meta = soma dos assinados; realizado = realizadoMensal do grupo (sem dobro). */
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
