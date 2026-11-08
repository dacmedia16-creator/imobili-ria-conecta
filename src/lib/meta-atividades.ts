// Meta x atividades (cartão t_09c29e96): liga o Meu Plano 2027 ao Diário de atividades.
// Funções puras. As metas vêm SEMPRE de calc() do plano (regras.ts) — aqui só se converte o mês em semana,
// sem repetir fórmula do book. Decisões de Denis (08/11/2026):
//   1) "Contato" do plano = "Ligação" do diário.
//   2) V1 e V2 = visitas ao proprietário; "Visita com comprador" só conta, sem meta.
//      Registros antigos "visita" ficam no histórico como "Visita (antiga)" e não entram nas metas.
//   3) Meta de ACM = meta de V2 da semana.
// Sem pontos e fora do ranking (decisão de 16/10, mantida).
import { calc, ok, type Respostas, type TaxasFunil } from "@/lib/meu-plano-2027/regras";

export type MetasSemana = {
  ligacoes: number;
  v1: number;
  v2: number;
  acm: number;
  /** Captações no mês (captMes do plano). */
  captMes: number;
  /** Metas do mês, para a linha "no mês". */
  mes: { ligacoes: number; v1: number; v2: number; acm: number };
};

/**
 * Converte o resultado de calc() em metas da semana. null = plano sem dados suficientes
 * (o corretor vê o convite para fazer o plano).
 */
export function metasDoCalc(C: {
  contSem: number;
  contMes: number;
  v1Mes: number;
  v2Mes: number;
  captMes: number;
}): MetasSemana | null {
  if (![C.contSem, C.v1Mes, C.v2Mes, C.captMes].every(ok)) return null;
  const v1 = Math.ceil(C.v1Mes / 4);
  const v2 = Math.ceil(C.v2Mes / 4);
  return {
    ligacoes: C.contSem,
    v1,
    v2,
    acm: v2,
    captMes: C.captMes,
    mes: {
      ligacoes: ok(C.contMes) ? C.contMes : C.contSem * 4,
      v1: C.v1Mes,
      v2: C.v2Mes,
      acm: C.v2Mes,
    },
  };
}

/** Metas da semana direto das respostas do plano (+ taxas padrão da imobiliária). */
export function metasDoPlano(
  S: Respostas | null | undefined,
  padrao?: Partial<TaxasFunil> | null,
): MetasSemana | null {
  if (!S || Object.keys(S).length === 0) return null;
  return metasDoCalc(calc(S, padrao));
}

// Cópia das metas calculadas, guardada no próprio plano (campos "ms.*"). Serve para o team leader ver
// feito x meta sem receber as respostas do plano (que têm gastos pessoais). Quem grava é a tela do
// próprio corretor (plano ou diário), a partir de calc().
export const CHAVES_SNAPSHOT = {
  ligacoes: "ms.lig",
  v1: "ms.v1",
  v2: "ms.v2",
  captMes: "ms.capt",
  ligMes: "ms.ligMes",
  v1Mes: "ms.v1Mes",
  v2Mes: "ms.v2Mes",
} as const;

export function snapshotDasMetas(m: MetasSemana | null): Record<string, number | null> {
  const K = CHAVES_SNAPSHOT;
  return {
    [K.ligacoes]: m?.ligacoes ?? null,
    [K.v1]: m?.v1 ?? null,
    [K.v2]: m?.v2 ?? null,
    [K.captMes]: m?.captMes ?? null,
    [K.ligMes]: m?.mes.ligacoes ?? null,
    [K.v1Mes]: m?.mes.v1 ?? null,
    [K.v2Mes]: m?.mes.v2 ?? null,
  };
}

/** Só as chaves do snapshot que mudaram (para gravar o mínimo). Vazio = nada a gravar. */
export function snapshotMudou(
  S: Respostas | null | undefined,
  m: MetasSemana | null,
): Record<string, number | null> {
  const novo = snapshotDasMetas(m);
  const dif: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(novo)) {
    const atual = S?.[k];
    const a = atual === undefined || atual === null || atual === "" ? null : Number(atual);
    if (a !== v) dif[k] = v;
  }
  return dif;
}

export function metasDoSnapshot(x: Record<string, unknown> | null | undefined): MetasSemana | null {
  if (!x) return null;
  const K = CHAVES_SNAPSHOT;
  const n = (k: string) =>
    x[k] === null || x[k] === undefined || x[k] === "" ? NaN : Number(x[k]);
  const v2 = n(K.v2);
  const r = {
    ligacoes: n(K.ligacoes),
    v1: n(K.v1),
    v2,
    acm: v2,
    captMes: n(K.captMes),
    mes: { ligacoes: n(K.ligMes), v1: n(K.v1Mes), v2: n(K.v2Mes), acm: n(K.v2Mes) },
  };
  return [r.ligacoes, r.v1, r.v2, r.captMes].every(ok) ? r : null;
}

// Período -----------------------------------------------------------------------------------------------

const somar = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Semana de segunda a domingo que contém `hoje` (data de São Paulo, aaaa-mm-dd). Igual ao banco. */
export function semanaDe(hoje: string): { inicio: string; fim: string } {
  const [y, m, d] = hoje.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // segunda = 0
  const inicio = somar(hoje, -dow);
  return { inicio, fim: somar(inicio, 6) };
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** "Semana de 02/11 a 08/11" e "novembro". */
export function rotulosPeriodo(hoje: string) {
  const s = semanaDe(hoje);
  return {
    semana: `Semana de ${ddmm(s.inicio)} a ${ddmm(s.fim)}`,
    mes: MESES[Number(hoje.slice(5, 7)) - 1],
  };
}

// Feito x meta ----------------------------------------------------------------------------------------

export type Faixa = "verde" | "amarelo" | "vermelho";

/** Verde quando bate a meta; amarelo a partir de 70%; vermelho abaixo de 70%. Meta 0 = verde. */
export function faixa(feito: number, meta: number): Faixa {
  if (!(meta > 0)) return "verde";
  const p = feito / meta;
  if (p >= 1) return "verde";
  if (p >= 0.7) return "amarelo";
  return "vermelho";
}

/** Percentual da barra (0 a 100). */
export function percentual(feito: number, meta: number): number {
  if (!(meta > 0)) return 100;
  return Math.max(0, Math.min(100, Math.round((feito / meta) * 100)));
}

export const faltam = (feito: number, meta: number) => Math.max(0, meta - feito);

/** "9 de 12" · "faltam 3" (ou "meta batida"). */
export function textoLinha(feito: number, meta: number): { de: string; resto: string } {
  const f = faltam(feito, meta);
  return { de: `${feito} de ${meta}`, resto: f > 0 ? `faltam ${f}` : "meta batida" };
}

export type Feito = {
  ligacoes: number;
  v1: number;
  v2: number;
  acm: number;
  visitaComprador: number;
  captMes: number;
};

export type LinhaQuadro = {
  chave: "ligacoes" | "v1" | "v2" | "acm" | "captMes";
  rotulo: string;
  feito: number;
  meta: number;
  faixa: Faixa;
  pct: number;
  /** Só nas linhas semanais: feito e meta do mês corrente. */
  mes?: { feito: number; meta: number };
};

export function montarQuadro(
  semana: Feito,
  mes: Omit<Feito, "captMes">,
  m: MetasSemana,
): LinhaQuadro[] {
  const L = (
    chave: LinhaQuadro["chave"],
    rotulo: string,
    feito: number,
    meta: number,
    noMes?: { feito: number; meta: number },
  ): LinhaQuadro => ({
    chave,
    rotulo,
    feito,
    meta,
    faixa: faixa(feito, meta),
    pct: percentual(feito, meta),
    ...(noMes ? { mes: noMes } : {}),
  });
  return [
    L("ligacoes", "Ligações", semana.ligacoes, m.ligacoes, {
      feito: mes.ligacoes,
      meta: m.mes.ligacoes,
    }),
    L("v1", "V1 · 1ª visita ao proprietário", semana.v1, m.v1, { feito: mes.v1, meta: m.mes.v1 }),
    L("v2", "V2 · 2ª visita ao proprietário", semana.v2, m.v2, { feito: mes.v2, meta: m.mes.v2 }),
    L("acm", "ACM", semana.acm, m.acm, { feito: mes.acm, meta: m.mes.acm }),
    L("captMes", "Captações no mês", semana.captMes, m.captMes),
  ];
}

/**
 * Quão perto da meta da SEMANA (0 = nada feito, 1 = tudo batido): média de min(1, feito/meta) nas 4
 * linhas semanais (ligações, V1, V2, ACM). Serve só para ordenar a visão do gestor (mais longe primeiro);
 * não é ponto nem ranking e não aparece na tela.
 */
export function proximidade(semana: Feito, m: MetasSemana): number {
  const r = (f: number, x: number) => (x > 0 ? Math.min(1, f / x) : 1);
  return (
    (r(semana.ligacoes, m.ligacoes) +
      r(semana.v1, m.v1) +
      r(semana.v2, m.v2) +
      r(semana.acm, m.acm)) /
    4
  );
}

export type LinhaEquipeMetas = {
  user_id: string;
  nome: string;
  semana: Feito;
  mes: Omit<Feito, "captMes">;
  antigasMes: number;
  metas: MetasSemana | null;
  ultimo: string | null;
};

const n0 = (v: unknown) => (v == null ? 0 : Number(v) || 0);

/** Linhas de carreira_diario_equipe_semana. Gestor/admin recebem o plano (metas pela calc(), sempre
 * atuais); o team leader recebe só a cópia "ms.*". */
export function normalizarEquipeSemana(
  rows: Record<string, unknown>[] | null | undefined,
  padrao: Partial<TaxasFunil> | null,
): LinhaEquipeMetas[] {
  return (rows ?? []).map((r) => {
    const respostas = (r.respostas as Respostas | null) ?? null;
    const metas =
      (respostas ? metasDoPlano(respostas, padrao) : null) ??
      metasDoSnapshot(r.metas as Record<string, unknown> | null);
    return {
      user_id: String(r.user_id),
      nome: (r.nome as string | null) ?? "Corretor",
      semana: {
        ligacoes: n0(r.lig_sem),
        v1: n0(r.v1_sem),
        v2: n0(r.v2_sem),
        acm: n0(r.acm_sem),
        visitaComprador: n0(r.comprador_sem),
        captMes: n0(r.capt_mes),
      },
      mes: {
        ligacoes: n0(r.lig_mes),
        v1: n0(r.v1_mes),
        v2: n0(r.v2_mes),
        acm: n0(r.acm_mes),
        visitaComprador: n0(r.comprador_mes),
      },
      antigasMes: n0(r.antigas_mes),
      metas,
      ultimo: r.ultimo_dia ? String(r.ultimo_dia).slice(0, 10) : null,
    };
  });
}

/** Ordena do mais longe para o mais perto da meta; quem não tem plano vai para o fim (por nome). */
export function ordenarPorDistancia<
  T extends { nome: string; metas: MetasSemana | null; semana: Feito },
>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => {
    if (!a.metas && !b.metas) return a.nome.localeCompare(b.nome, "pt-BR");
    if (!a.metas) return 1;
    if (!b.metas) return -1;
    const d = proximidade(a.semana, a.metas) - proximidade(b.semana, b.metas);
    return d !== 0 ? d : a.nome.localeCompare(b.nome, "pt-BR");
  });
}
