/**
 * Painéis de metas 2027 — REGRA DE CÁLCULO ÚNICA (cartão t_f87b2ae5, maquete t_5494fd47 aprovada por
 * Denis em 19/11/2026, tópico 6238). Só funções puras: nada aqui lê ou grava no banco.
 *
 * Os 3 painéis (corretor, gestor/TL, imobiliária) devem usar SÓ estas funções, para os números baterem.
 *
 * Decisões de Denis (19/11) aplicadas:
 * - Meta só vale com plano ASSINADO (assinado_corretor_em). "Em preenchimento" aparece separado.
 * - Meta do ano = metaOficialDoPlano(calc()) — a mesma que a assinatura grava como meta oficial.
 * - Meta do MÊS = distribuição mês a mês do plano (tabelasMes / mt.mes.*), não anual ÷ 12.
 *   Mês que o corretor não digitou usa a sugestão do próprio plano (anual ÷ 12 em inteiros).
 * - Meta principal = comissão (VGC); vendas (transações), VGV e captações são secundárias.
 * - Farol de META (novo, separado do Farol de atividade): 🟢 ≥100% do esperado até hoje,
 *   🟡 80–99%, 🔴 <80%, ⚪ sem plano assinado (ou sem meta).
 * - Datas sempre no fuso de São Paulo (hoje = hojeSaoPaulo()).
 */
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import {
  calc,
  metaOficialDoPlano,
  ok,
  type Respostas,
  type TaxasFunil,
} from "@/lib/meu-plano-2027/regras";
import { tabelasMes } from "@/lib/meu-plano-2027/meses";

// --- Tipos -----------------------------------------------------------------------------------------

export const INDICADORES = ["comissao", "vendas", "vgv", "captacoes"] as const;
export type Indicador = (typeof INDICADORES)[number];
/** Indicador que manda no farol (meta principal). */
export const INDICADOR_PRINCIPAL: Indicador = "comissao";

/** Valor por indicador. null = sem dado (ex.: plano sem ticket → sem meta de VGV). */
export type Valores = Record<Indicador, number | null>;

export type SituacaoPlano = "assinado" | "preenchimento" | "sem_plano";

export type MetaPlano = {
  ano: Valores;
  /** 12 meses (índice 0 = janeiro). */
  meses: Valores[];
  /** Soma dos meses ≠ meta do ano (o corretor digitou meses que não fecham). Só aviso. */
  diverge: Record<Indicador, boolean>;
};

export const valoresVazios = (): Valores => ({
  comissao: null,
  vendas: null,
  vgv: null,
  captacoes: null,
});
export const valoresZero = (): Valores => ({ comissao: 0, vendas: 0, vgv: 0, captacoes: 0 });

const r2 = (v: number) => Math.round(v * 100) / 100;
const val = (v: number): number | null => (ok(v) ? v : null);

// --- Situação do plano -----------------------------------------------------------------------------

/** Assinado = o corretor assinou (mesma regra do Meu mês). Respostas sem assinatura = em preenchimento. */
export function situacaoPlano(
  p:
    | {
        assinadoEm?: string | null;
        respostas?: Respostas | null;
      }
    | null
    | undefined,
): SituacaoPlano {
  if (!p) return "sem_plano";
  const temRespostas = !!p.respostas && Object.keys(p.respostas).length > 0;
  if (p.assinadoEm && temRespostas) return "assinado";
  return temRespostas ? "preenchimento" : "sem_plano";
}

// --- Meta do plano (ano + meses) -------------------------------------------------------------------

/**
 * Meta do ano e de cada mês a partir das respostas do plano. null = plano incompleto (sem VGC).
 * - comissão do mês = linha "VGC" da distribuição;
 * - vendas do mês = linha "Transações" (captação + venda), a mesma unidade da meta do ano;
 * - captações do mês = linha "Novas CREs";
 * - VGV do mês = transações do mês ÷ 2 × ticket médio (mesma conta do VGV do ano, Denis 18/11).
 */
export function metaDoPlano(
  respostas: Respostas | null | undefined,
  padrao?: Partial<TaxasFunil> | null,
): MetaPlano | null {
  if (!respostas || Object.keys(respostas).length === 0) return null;
  const C = calc(respostas, padrao);
  const oficial = metaOficialDoPlano(C);
  if (!oficial) return null;
  const [cres, vgcTab] = tabelasMes(respostas, C);
  const linha = (t: typeof cres, id: string) => t.linhas.find((l) => l.id === id)!;
  const novas = linha(cres, "novas");
  const trans = linha(vgcTab, "trans");
  const vgc = linha(vgcTab, "vgc");
  const ticket = ok(C.ticket) && C.ticket > 0 ? C.ticket : NaN;
  const meses: Valores[] = vgc.meses.map((_, i) => {
    const t = trans.meses[i].usado;
    return {
      comissao: val(vgc.meses[i].usado),
      vendas: val(t),
      vgv: oficial.vgv == null ? null : val(ok(t) ? (t / 2) * ticket : NaN),
      captacoes: oficial.captacoes == null ? null : val(novas.meses[i].usado),
    };
  });
  const ano: Valores = {
    comissao: oficial.comissao,
    vendas: oficial.vendas,
    vgv: oficial.vgv,
    captacoes: oficial.captacoes,
  };
  const diverge = {} as Record<Indicador, boolean>;
  for (const k of INDICADORES) {
    const a = ano[k];
    const s = somaMeses(meses, k, 12);
    diverge[k] = a != null && s != null && Math.round(s) !== Math.round(a);
  }
  return { ano, meses, diverge };
}

/** Soma dos meses 1..ate (ate = 1..12) de um indicador; null se nenhum mês tem valor. */
export function somaMeses(meses: Valores[], k: Indicador, ate: number): number | null {
  const xs = meses.slice(0, Math.max(0, ate)).map((m) => m[k]);
  if (xs.every((x) => x == null)) return null;
  return xs.reduce<number>((t, x) => t + (x ?? 0), 0);
}

// --- Onde estamos no ano (fuso de São Paulo) -------------------------------------------------------

export type Posicao = {
  /** "antes" = ainda não começou o ano do plano; "depois" = ano já terminou. */
  fase: "antes" | "durante" | "depois";
  /** Mês atual 1..12 (antes = 1, depois = 12). */
  mes: number;
  dia: number;
  diasMes: number;
  /** Fração do mês atual já passada, contando hoje (dia ÷ dias do mês). */
  fracMes: number;
  /** Semanas que faltam no mês, contando a semana de hoje (mínimo 1). */
  semanasRestantes: number;
};

/** `hoje` = data civil de São Paulo (aaaa-mm-dd), vinda de hojeSaoPaulo(). */
export function posicaoNoAno(hoje: string, ano: number = ANO_PLANO): Posicao {
  const [a, m, d] = hoje.split("-").map(Number);
  const diasDe = (mm: number) => new Date(Date.UTC(ano, mm, 0)).getUTCDate();
  if (a < ano)
    return { fase: "antes", mes: 1, dia: 0, diasMes: 31, fracMes: 0, semanasRestantes: 5 };
  if (a > ano)
    return { fase: "depois", mes: 12, dia: 31, diasMes: 31, fracMes: 1, semanasRestantes: 1 };
  const diasMes = diasDe(m);
  return {
    fase: "durante",
    mes: m,
    dia: d,
    diasMes,
    fracMes: d / diasMes,
    semanasRestantes: Math.max(1, Math.ceil((diasMes - d + 1) / 7)),
  };
}

// --- Avaliação de um indicador --------------------------------------------------------------------

export type Ritmo = "frente" | "no_ritmo" | "atras" | "sem_meta";

export type AvaliacaoIndicador = {
  metaAno: number | null;
  metaMes: number | null;
  realAno: number;
  realMes: number;
  /** Fração (0,5 = 50%). null = meta vazia ou 0. */
  pctAno: number | null;
  pctMes: number | null;
  /** Quanto já deveria estar feito até hoje, pela distribuição mensal do plano. */
  esperado: number | null;
  /** realAno ÷ esperado. null = sem meta; esperado 0 com meta = 1 (nada era esperado ainda). */
  pctEsperado: number | null;
  /** realAno − esperado (positivo = à frente). */
  diferenca: number | null;
  ritmo: Ritmo;
  faltaAno: number | null;
  faltaMes: number | null;
  faltaSemana: number | null;
};

/** Tira só o ruído de ponto flutuante (9 casas): 0,1 + 0,2 = 100%, mas 99,995% continua < 100%. */
const fr = (x: number) => Math.round(x * 1e9) / 1e9;

export function avaliarIndicador(
  meta: MetaPlano | null,
  k: Indicador,
  realMeses: Valores[],
  pos: Posicao,
): AvaliacaoIndicador {
  const m = pos.mes;
  const ateMes = pos.fase === "antes" ? 0 : m;
  const realAno = somaMeses(realMeses, k, ateMes) ?? 0;
  const realMes = pos.fase === "antes" ? 0 : (realMeses[m - 1]?.[k] ?? 0);
  const metaAno = meta?.ano[k] ?? null;
  const metaMes = meta && pos.fase !== "antes" ? (meta.meses[m - 1]?.[k] ?? null) : null;
  const temMeta = metaAno != null && metaAno > 0;
  let esperado: number | null = null;
  if (temMeta && meta) {
    if (pos.fase === "antes") esperado = 0;
    else {
      const ateAnterior = somaMeses(meta.meses, k, m - 1) ?? 0;
      esperado = ateAnterior + (meta.meses[m - 1]?.[k] ?? 0) * pos.fracMes;
    }
  }
  const pctEsperado = esperado == null ? null : esperado > 0 ? fr(realAno / esperado) : 1;
  const diferenca = esperado == null ? null : r2(realAno - esperado);
  const ritmo: Ritmo =
    pctEsperado == null
      ? "sem_meta"
      : pctEsperado > 1
        ? "frente"
        : pctEsperado === 1
          ? "no_ritmo"
          : "atras";
  const faltaMes = metaMes == null ? null : Math.max(0, r2(metaMes - realMes));
  return {
    metaAno,
    metaMes,
    realAno: r2(realAno),
    realMes: r2(realMes),
    pctAno: temMeta ? fr(realAno / metaAno!) : null,
    pctMes: metaMes != null && metaMes > 0 ? fr(realMes / metaMes) : null,
    esperado: esperado == null ? null : r2(esperado),
    pctEsperado,
    diferenca,
    ritmo,
    faltaAno: metaAno == null ? null : Math.max(0, r2(metaAno - realAno)),
    faltaMes,
    faltaSemana: faltaMes == null ? null : r2(faltaMes / pos.semanasRestantes),
  };
}

// --- Farol de meta ---------------------------------------------------------------------------------

/** "cinza" = ⚪ sem plano assinado ou sem meta; "aguardando" = antes de 01/01/2027. */
export type FarolMeta = "verde" | "amarelo" | "vermelho" | "cinza" | "aguardando";
export const FAROL_META_ROTULO: Record<FarolMeta, string> = {
  verde: "🟢 No ritmo",
  amarelo: "🟡 Atenção",
  vermelho: "🔴 Atrás",
  cinza: "⚪ Sem meta oficial",
  aguardando: "⚪ Plano vale a partir de jan/2027",
};
export const LIMITE_VERDE = 1;
export const LIMITE_AMARELO = 0.8;

export function farolMeta(
  pctEsperado: number | null,
  situacao: SituacaoPlano,
  pos?: Pick<Posicao, "fase">,
): FarolMeta {
  if (situacao !== "assinado") return "cinza";
  if (pos?.fase === "antes") return "aguardando";
  if (pctEsperado == null || !Number.isFinite(pctEsperado)) return "cinza";
  const p = fr(pctEsperado);
  if (p >= LIMITE_VERDE) return "verde";
  if (p >= LIMITE_AMARELO) return "amarelo";
  return "vermelho";
}

// --- Avaliação completa de uma pessoa (ou de um grupo) ---------------------------------------------

export type Avaliacao = {
  situacao: SituacaoPlano;
  farol: FarolMeta;
  indicadores: Record<Indicador, AvaliacaoIndicador>;
};

/**
 * Meta só conta se o plano estiver ASSINADO: plano em preenchimento ou sem plano mostra o realizado,
 * mas sem meta, sem % e com farol ⚪.
 */
export function avaliar(
  situacao: SituacaoPlano,
  meta: MetaPlano | null,
  realMeses: Valores[],
  pos: Posicao,
): Avaliacao {
  const metaValida = situacao === "assinado" ? meta : null;
  const indicadores = {} as Record<Indicador, AvaliacaoIndicador>;
  for (const k of INDICADORES) indicadores[k] = avaliarIndicador(metaValida, k, realMeses, pos);
  return {
    situacao,
    farol: farolMeta(indicadores[INDICADOR_PRINCIPAL].pctEsperado, situacao, pos),
    indicadores,
  };
}
