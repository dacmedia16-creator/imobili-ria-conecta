/**
 * Metas mês a mês de 2027 (só planejamento), em DUAS tabelas iguais à cartilha (maquete t_88a3e82e):
 *
 *  CREs: Novas CREs · Canceladas/expiradas · CREs vendidas (digita) · = Imóveis em estoque (calculada,
 *        acumulada: início + novas − canceladas − vendidas; o "Anual" é dezembro).
 *  VGC:  Transações de captação · Transações de venda · Comissão média por transação (digita) ·
 *        = Transações (captação + venda) · = VGC (transações × comissão média do mês).
 *
 * O corretor digita o mês nas chaves `mt.mes.<linha>.<1..12>`. Mês vazio usa a sugestão: anual ÷ 12 em
 * números inteiros que fecham o ano (ex.: 56 → oito meses de 5 e quatro de 4); a comissão média vem com
 * o valor ANUAL em todos os meses (decisão de Denis, 13/11/2026) e o corretor pode trocar um mês.
 * A soma dos meses é só conferência: se não bater com a meta do ano, a tela/PDF avisam, sem bloquear.
 * NADA aqui altera calc() — a meta anual, o VGC, o estoque, o clube e a meta oficial vêm só de calc().
 *
 * Compatibilidade: `mt.mes.novas|canc|vendidas.*` continuam os mesmos. As chaves antigas
 * `mt.mes.trans.*` e `mt.mes.vgc.*` (linhas que agora são calculadas) ficam no banco e são ignoradas.
 */
import { MESES } from "./listas";
import { num, ok, type Calc, type Respostas } from "./regras";

export type IdLinhaDigita = "novas" | "canc" | "vendidas" | "tcapt" | "tvenda" | "com";
export type IdLinhaCalc = "estoque" | "trans" | "vgc";
export type IdLinhaMes = IdLinhaDigita | IdLinhaCalc;
export type IdTabelaMes = "cres" | "vgc";

/** Chave da resposta de um mês (mes = 1..12). */
export const chaveMes = (linha: IdLinhaDigita, mes: number) => `mt.mes.${linha}.${mes}`;

/** Linhas digitáveis por tabela (ordem da cartilha). */
export const DIGITA: Record<IdTabelaMes, IdLinhaDigita[]> = {
  cres: ["novas", "canc", "vendidas"],
  vgc: ["tcapt", "tvenda", "com"],
};
/** Chaves antigas (mt.mes.trans.* e mt.mes.vgc.*): não são apagadas, só ignoradas. */
export const LINHAS_ANTIGAS = ["trans", "vgc"] as const;

/** Todas as chaves digitáveis de uma tabela (usado no "Voltar tudo para a sugestão"). */
export const chavesTabela = (t: IdTabelaMes) =>
  DIGITA[t].flatMap((l) => MESES.map((_, i) => chaveMes(l, i + 1)));

export type CelulaMes = {
  /** Valor usado na conta (digitado ou sugestão). */
  usado: number;
  /** Só linhas digitáveis: o que foi digitado (NaN = vazio) e a sugestão daquele mês. */
  digitado: number;
  temValor: boolean;
  sugestao: number;
};
export type LinhaMes = {
  id: IdLinhaMes;
  rot: string;
  /** Rótulo curto (cabeçalho do celular). */
  curto: string;
  calc: boolean;
  dinheiro: boolean;
  meses: CelulaMes[];
  /** Coluna "Anual": soma dos meses; estoque = dezembro; comissão = valor do ano. */
  anual: number;
  /** Meta do ano para conferir a soma (NaN = linha sem conferência). */
  meta: number;
  /** Como ler o "Anual" quando não é soma. */
  notaAnual?: string;
  algumDigitado: boolean;
  /** Soma ≠ meta do ano (só depois de digitar algum mês). */
  diverge: boolean;
};
export type TabelaMes = { id: IdTabelaMes; titulo: string; linhas: LinhaMes[] };

/** anual ÷ 12 em inteiros que fecham o ano; se o anual não for inteiro, a fração ÷ 12 em todos os meses. */
export function sugestoesMes(anual: number): number[] {
  if (!ok(anual)) return MESES.map(() => NaN);
  if (!Number.isInteger(anual) || anual < 0) return MESES.map(() => anual / 12);
  const base = Math.floor(anual / 12);
  const resto = anual - base * 12;
  return MESES.map((_, i) => base + (i < resto ? 1 : 0));
}

const r1 = (v: number) => Math.round(v * 10);
const r2 = (v: number) => Math.round(v * 100);
const v0 = (x: number) => (ok(x) ? x : 0);
const somaOuNaN = (a: number[]) =>
  a.every((x) => !ok(x)) ? NaN : a.reduce((t, x) => t + v0(x), 0);

function digitavel(
  S: Respostas,
  id: IdLinhaDigita,
  rot: string,
  curto: string,
  sugestoes: number[],
  opc: { meta: number; dinheiro?: boolean; anual?: number; notaAnual?: string },
): LinhaMes {
  const meses = MESES.map((_, i) => {
    const digitado = num(S[chaveMes(id, i + 1)]);
    const temValor = ok(digitado);
    const sugestao = sugestoes[i];
    return { digitado, temValor, sugestao, usado: temValor ? digitado : sugestao };
  });
  const algumDigitado = meses.some((m) => m.temValor);
  const anual = opc.anual ?? somaOuNaN(meses.map((m) => m.usado));
  const diverge = algumDigitado && ok(opc.meta) && ok(anual) && r1(anual) !== r1(opc.meta);
  return {
    id,
    rot,
    curto,
    calc: false,
    dinheiro: !!opc.dinheiro,
    meses,
    anual,
    meta: opc.meta,
    notaAnual: opc.notaAnual,
    algumDigitado,
    diverge,
  };
}

function calculada(
  id: IdLinhaCalc,
  rot: string,
  curto: string,
  valores: number[],
  opc: {
    anual: number;
    meta?: number;
    dinheiro?: boolean;
    notaAnual?: string;
    algumDigitado?: boolean;
  },
): LinhaMes {
  const meta = opc.meta ?? NaN;
  const algumDigitado = !!opc.algumDigitado;
  const diverge = algumDigitado && ok(meta) && ok(opc.anual) && r2(opc.anual) !== r2(meta);
  return {
    id,
    rot,
    curto,
    calc: true,
    dinheiro: !!opc.dinheiro,
    meses: valores.map((v) => ({ usado: v, digitado: NaN, temValor: false, sugestao: NaN })),
    anual: opc.anual,
    meta,
    notaAnual: opc.notaAnual,
    algumDigitado,
    diverge,
  };
}

export function tabelasMes(S: Respostas, C: Calc): TabelaMes[] {
  // --- CREs ---
  const novas = digitavel(S, "novas", "Novas CREs", "Novas", sugestoesMes(C.novas), {
    meta: C.novas,
  });
  const canc = digitavel(
    S,
    "canc",
    "Canceladas/expiradas",
    "Cancel./expir.",
    sugestoesMes(C.canc),
    {
      meta: C.canc,
    },
  );
  const vend = digitavel(S, "vendidas", "CREs vendidas", "Vendidas", sugestoesMes(C.vendidas), {
    meta: C.vendidas,
  });
  let corre = C.creIni;
  const estoque = MESES.map((_, i) => {
    corre = ok(corre)
      ? corre + v0(novas.meses[i].usado) - v0(canc.meses[i].usado) - v0(vend.meses[i].usado)
      : NaN;
    return corre;
  });
  const cres: TabelaMes = {
    id: "cres",
    titulo: "Distribuição mês a mês — CREs",
    linhas: [
      novas,
      canc,
      vend,
      calculada("estoque", "Imóveis em estoque", "Estoque", estoque, {
        anual: estoque[11],
        notaAnual: "= dezembro",
      }),
    ],
  };

  // --- VGC ---
  const tcapt = digitavel(S, "tcapt", "Transações de captação", "Captação", sugestoesMes(C.tCapt), {
    meta: C.tCapt,
  });
  const tvenda = digitavel(S, "tvenda", "Transações de venda", "Venda", sugestoesMes(C.tVenda), {
    meta: C.tVenda,
  });
  const com = digitavel(
    S,
    "com",
    "Comissão média por transação",
    "Comissão média R$",
    MESES.map(() => C.comMedia),
    { meta: NaN, dinheiro: true, anual: C.comMedia, notaAnual: "valor do ano" },
  );
  // Mesma regra de calc(): sem captação não há transações; venda vazia conta 0.
  const trans = MESES.map((_, i) => {
    const c = tcapt.meses[i].usado;
    return ok(c) ? c + v0(tvenda.meses[i].usado) : NaN;
  });
  const vgcMes = MESES.map((_, i) => {
    const cm = com.meses[i].usado;
    return ok(trans[i]) && ok(cm) ? trans[i] * cm : NaN;
  });
  const vgc: TabelaMes = {
    id: "vgc",
    titulo: "Distribuição mês a mês — VGC",
    linhas: [
      tcapt,
      tvenda,
      com,
      calculada("trans", "Transações", "Trans.", trans, {
        anual: somaOuNaN(trans),
        meta: C.transMeta,
        algumDigitado: tcapt.algumDigitado || tvenda.algumDigitado,
      }),
      calculada("vgc", "VGC", "VGC", vgcMes, {
        anual: somaOuNaN(vgcMes),
        meta: C.vgc,
        dinheiro: true,
        algumDigitado: tcapt.algumDigitado || tvenda.algumDigitado || com.algumDigitado,
      }),
    ],
  };
  return [cres, vgc];
}

/** Algum mês digitado em qualquer linha das duas tabelas (o título deixa de dizer "÷ 12"). */
export const temMesDigitado = (T: TabelaMes[]) =>
  T.some((t) => t.linhas.some((l) => !l.calc && l.algumDigitado));
