/**
 * Telas lote 3 (t_d97f306e, Denis 24/11): helpers puros dos itens 7-9 do relatório t_d62be550.
 * Só apresentação — nenhuma consulta, regra de permissão ou cálculo financeiro mora aqui.
 */
import { intervaloResumoMensal, type ResumoMensalPeriodo } from "@/lib/dashboard-resumo-mensal";

// ---------------------------------------------------------------------------------------------
// Item 7 — KPIs do Início comparados ao mês anterior
// ---------------------------------------------------------------------------------------------

export type Comparacao =
  | { tipo: "sem"; motivo: string }
  | { tipo: "igual" }
  | { tipo: "variacao"; pct: number; sentido: "sobe" | "desce" };

/**
 * Variação percentual contra o período anterior. Nunca inventa número: sem valor anterior
 * positivo (zero, negativo ou ausente) não existe % confiável, então devolve "sem".
 */
export function compararPeriodos(
  atual: number | null | undefined,
  anterior: number | null | undefined,
): Comparacao {
  if (typeof atual !== "number" || !Number.isFinite(atual))
    return { tipo: "sem", motivo: "Valor do mês sem dado." };
  if (typeof anterior !== "number" || !Number.isFinite(anterior))
    return { tipo: "sem", motivo: "Período anterior sem dado." };
  if (anterior === 0 && atual === 0) return { tipo: "igual" };
  if (anterior <= 0)
    return { tipo: "sem", motivo: "Período anterior sem valor para calcular a variação." };
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  if (pct === 0) return { tipo: "igual" };
  return { tipo: "variacao", pct: Math.abs(pct), sentido: pct > 0 ? "sobe" : "desce" };
}

const MES_CURTO = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export type PeriodoComparacao = ResumoMensalPeriodo & { rotulo: string };

/**
 * Período usado na comparação. Mês atual (em andamento) compara com o mês anterior ATÉ O MESMO
 * DIA (ex.: 1–24/11 contra 1–24/10), para não pôr um mês pela metade contra um mês inteiro.
 * Mês anterior (já fechado) compara com o mês antes dele, inteiro. Mesmo calendário de São Paulo
 * e mesmo formato de intervalo do resumo — a regra de cálculo é a mesma (calcularResumo).
 */
export function periodoComparacao(deslocamentoMes: 0 | -1, agora = new Date()): PeriodoComparacao {
  const base = intervaloResumoMensal(deslocamentoMes === 0 ? -1 : -2, agora);
  const [ano, mm, ultimo] = base.ate.split("-");
  const mes = MES_CURTO[Number(mm) - 1];
  if (deslocamentoMes !== 0) return { ...base, rotulo: `${mes}/${ano}` };
  const diaHoje = Number(intervaloResumoMensal(0, agora).hoje.slice(8, 10));
  const corte = Math.min(diaHoje, Number(ultimo));
  const dd = String(corte).padStart(2, "0");
  return {
    ...base,
    ate: `${ano}-${mm}-${dd}`,
    hoje: `${ano}-${mm}-${dd}`,
    rotulo: corte === Number(ultimo) ? `${mes}/${ano}` : `1–${corte} ${mes}`,
  };
}

/** Texto curto + leitura completa (leitor de tela) da comparação. Cor nunca vem sozinha. */
export function textoComparacao(c: Comparacao, rotulo: string): { curto: string; longo: string } {
  if (c.tipo === "sem")
    return { curto: "sem comparação", longo: `Sem comparação com ${rotulo}: ${c.motivo}` };
  if (c.tipo === "igual")
    return { curto: `= igual a ${rotulo}`, longo: `Igual ao período ${rotulo}.` };
  return c.sentido === "sobe"
    ? { curto: `▲ ${c.pct}% vs ${rotulo}`, longo: `Subiu ${c.pct}% em relação a ${rotulo}.` }
    : { curto: `▼ ${c.pct}% vs ${rotulo}`, longo: `Caiu ${c.pct}% em relação a ${rotulo}.` };
}

/**
 * Largura (%) da faixa da "Situação atual" relativa ao maior grupo. Grupo com valor nunca some:
 * fica com pelo menos 3% (o número exato está escrito ao lado). Zero fica vazio.
 */
export function larguraFaixa(total: number, maior: number): number {
  if (!(total > 0) || !(maior > 0)) return 0;
  return Math.max(3, Math.round((total / maior) * 100));
}

// ---------------------------------------------------------------------------------------------
// Item 8 — Vendas: chips dos filtros ativos
// ---------------------------------------------------------------------------------------------

export type ChaveChipVendas =
  "minhaVez" | "status" | "vez" | "periodo" | "q" | "equipe" | "midia" | "pagamento";

export type ChipFiltroVendas = { chave: ChaveChipVendas; texto: string };

export type EstadoFiltrosVendas = {
  soMinhaVez: boolean;
  statusFilter: string;
  vezFilter: string;
  dataDe: string;
  dataAte: string;
  periodoPadrao: { de: string; ate: string };
  esteira: boolean;
  q: string;
  equipeFilter: string;
  podeFiltrarEquipe: boolean;
  midiaFilter: string;
  pagamentoFilter: string;
};

const dataBr = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");

/** Um chip por filtro ligado, na ordem em que aparecem na tela. Cada chip tem um "x" na tela. */
export function chipsFiltrosVendas(
  f: EstadoFiltrosVendas,
  nome: {
    status: (k: string) => string;
    vez: (k: string) => string;
    equipe: (k: string) => string;
    midia: (k: string) => string;
    pagamento: (k: string) => string;
  },
): ChipFiltroVendas[] {
  const chips: ChipFiltroVendas[] = [];
  if (f.soMinhaVez) chips.push({ chave: "minhaVez", texto: "★ Minha vez" });
  if (f.statusFilter !== "todas")
    chips.push({ chave: "status", texto: `Status: ${nome.status(f.statusFilter)}` });
  if (f.vezFilter !== "todas")
    chips.push({ chave: "vez", texto: `Vez de agir: ${nome.vez(f.vezFilter)}` });
  if (!f.esteira && (f.dataDe !== f.periodoPadrao.de || f.dataAte !== f.periodoPadrao.ate)) {
    const texto =
      !f.dataDe && !f.dataAte
        ? "Período: todas as datas"
        : !f.dataDe
          ? `Período: até ${dataBr(f.dataAte)}`
          : !f.dataAte
            ? `Período: desde ${dataBr(f.dataDe)}`
            : `Período: ${dataBr(f.dataDe)} a ${dataBr(f.dataAte)}`;
    chips.push({ chave: "periodo", texto });
  }
  const busca = f.q.trim();
  if (busca)
    chips.push({
      chave: "q",
      texto: `Busca: “${busca.length > 24 ? `${busca.slice(0, 24)}…` : busca}”`,
    });
  if (f.podeFiltrarEquipe && f.equipeFilter !== "todas")
    chips.push({ chave: "equipe", texto: `Equipe: ${nome.equipe(f.equipeFilter)}` });
  if (f.midiaFilter !== "todas")
    chips.push({ chave: "midia", texto: `Mídia: ${nome.midia(f.midiaFilter)}` });
  if (f.pagamentoFilter !== "todas")
    chips.push({ chave: "pagamento", texto: `Pagamento: ${nome.pagamento(f.pagamentoFilter)}` });
  return chips;
}

/** Rótulo do atalho: "★ Minha vez (N)"; enquanto a contagem não chega (ou falha), sem número. */
export function rotuloMinhaVez(total: number | null): string {
  return total === null ? "★ Minha vez" : `★ Minha vez (${total})`;
}
