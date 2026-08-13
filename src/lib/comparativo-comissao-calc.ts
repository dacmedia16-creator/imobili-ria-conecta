/**
 * Fórmulas puras do "Comparativo de Comissão — Padrão 6%". Nenhuma função aqui lê ou escreve no
 * banco — só transforma os números que a página já carregou, pra poder ser testado sem Supabase e
 * sem montar o componente.
 */
import type {
  ComparativoCalculado, ComparativoRowComCalculo, EventoFechamento, GrupoMensal, GrupoSecundario, ResumoComparativo, SituacaoComissao,
} from "@/lib/comparativo-comissao-types";

/** Padrão de comparação — comissão de 6% sobre o valor negociado. */
export const PERCENTUAL_PADRAO = 6;
/** Tolerância de arredondamento pra decidir "igual a 6%" (pontos percentuais). */
const TOLERANCIA_SITUACAO_PP = 0.001;
/** Tolerância pra sinalizar "Divergência no cadastro" entre sales.percentual_comissao e o
 * percentual calculado a partir de valor_total_comissao/valor_negociado — cobre só ruído de
 * arredondamento de digitação, não uma divergência real. */
const TOLERANCIA_DIVERGENCIA_PP = 0.01;

const numOrNull = (v: number | null | undefined): number | null => (v == null || Number.isNaN(v) ? null : Number(v));

/** percentualReal = valorNegociado > 0 ? (valorTotalComissao / valorNegociado) * 100 : null */
export function percentualReal(valorNegociado: number | null | undefined, valorTotalComissao: number | null | undefined): number | null {
  const negociado = numOrNull(valorNegociado);
  const comissao = numOrNull(valorTotalComissao) ?? 0;
  if (negociado == null || negociado <= 0) return null;
  return (comissao / negociado) * 100;
}

/** vgvEquivalente6 = valorTotalComissao > 0 ? valorTotalComissao / 0.06 : null */
export function vgvEquivalente6(valorTotalComissao: number | null | undefined): number | null {
  const comissao = numOrNull(valorTotalComissao);
  if (comissao == null || comissao <= 0) return null;
  return comissao / (PERCENTUAL_PADRAO / 100);
}

/** diferencaVgv = valorNegociado - vgvEquivalente6 (precisa dos dois valores válidos — um
 * valorNegociado zero/negativo não é um VGV real comparável, mesma regra de percentualReal). */
export function diferencaVgv(valorNegociado: number | null | undefined, vgvEq: number | null): number | null {
  const negociado = numOrNull(valorNegociado);
  if (negociado == null || negociado <= 0 || vgvEq == null) return null;
  return negociado - vgvEq;
}

/** percentualReducao = valorNegociado > 0 ? (diferencaVgv / valorNegociado) * 100 : null */
export function percentualReducao(valorNegociado: number | null | undefined, diferenca: number | null): number | null {
  const negociado = numOrNull(valorNegociado);
  if (negociado == null || negociado <= 0 || diferenca == null) return null;
  return (diferenca / negociado) * 100;
}

export function situacaoDe(pctReal: number | null): SituacaoComissao | null {
  if (pctReal == null) return null;
  const delta = pctReal - PERCENTUAL_PADRAO;
  if (Math.abs(delta) <= TOLERANCIA_SITUACAO_PP) return "igual";
  return delta < 0 ? "abaixo" : "acima";
}

/** true quando sales.percentual_comissao (cadastrado) diverge do percentual calculado a partir dos
 * valores em reais — sinaliza pra revisão manual, nunca corrige nada aqui. */
export function divergenciaCadastro(percentualCadastrado: number | null | undefined, pctReal: number | null): boolean {
  const cadastrado = numOrNull(percentualCadastrado);
  if (cadastrado == null || pctReal == null) return false;
  return Math.abs(cadastrado - pctReal) > TOLERANCIA_DIVERGENCIA_PP;
}

/** Roda as 6 fórmulas acima em sequência pra uma venda. */
export function calcularComparativo(args: {
  valorNegociado: number | null | undefined;
  valorTotalComissao: number | null | undefined;
  percentualCadastrado?: number | null;
}): ComparativoCalculado {
  const pctReal = percentualReal(args.valorNegociado, args.valorTotalComissao);
  const vgvEq = vgvEquivalente6(args.valorTotalComissao);
  const diferenca = diferencaVgv(args.valorNegociado, vgvEq);
  const reducao = percentualReducao(args.valorNegociado, diferenca);
  return {
    percentualReal: pctReal,
    vgvEquivalente6: vgvEq,
    diferencaVgv: diferenca,
    percentualReducao: reducao,
    situacao: situacaoDe(pctReal),
    divergenciaCadastro: divergenciaCadastro(args.percentualCadastrado, pctReal),
  };
}

/** Percentual médio PONDERADO de um conjunto de vendas — nunca a média simples dos percentuais
 * individuais. null quando não há VGV real pra dividir (conjunto vazio ou soma zero). */
export function percentualMedioPonderado(rows: { valor_negociado: number; valor_total_comissao: number }[]): number | null {
  const somaNegociado = rows.reduce((s, r) => s + Number(r.valor_negociado ?? 0), 0);
  if (somaNegociado <= 0) return null;
  const somaComissao = rows.reduce((s, r) => s + Number(r.valor_total_comissao ?? 0), 0);
  return (somaComissao / somaNegociado) * 100;
}

function agregar<T extends { valor_negociado: number; valor_total_comissao: number; diferencaVgv: number | null }>(rows: T[]) {
  const vgvReal = rows.reduce((s, r) => s + Number(r.valor_negociado ?? 0), 0);
  const comissaoTotal = rows.reduce((s, r) => s + Number(r.valor_total_comissao ?? 0), 0);
  const vgvEq = comissaoTotal > 0 ? comissaoTotal / (PERCENTUAL_PADRAO / 100) : 0;
  return {
    quantidade: rows.length,
    vgvReal,
    comissaoTotal,
    percentualMedioPonderado: percentualMedioPonderado(rows),
    vgvEquivalente6: vgvEq,
    diferenca: vgvReal - vgvEq,
  };
}

export function resumoComparativo(rows: ComparativoRowComCalculo[]): ResumoComparativo {
  const a = agregar(rows);
  return {
    quantidade: a.quantidade,
    vgvRealTotal: a.vgvReal,
    comissaoTotal: a.comissaoTotal,
    percentualMedioPonderado: a.percentualMedioPonderado,
    vgvEquivalente6Total: a.vgvEquivalente6,
    diferencaTotal: a.diferenca,
  };
}

/** Agrupa por mês da data de fechamento (YYYY-MM), ordenado cronologicamente. */
export function agruparPorMes(rows: ComparativoRowComCalculo[]): GrupoMensal[] {
  const porMes = new Map<string, ComparativoRowComCalculo[]>();
  for (const r of rows) {
    const mes = r.data_fechamento.slice(0, 7);
    const bucket = porMes.get(mes);
    if (bucket) bucket.push(r); else porMes.set(mes, [r]);
  }
  return Array.from(porMes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, bucket]) => ({ mes, ...agregar(bucket) }));
}

/** Agrupamento secundário — por corretor, equipe ou gestor/team leader. Vendas sem o vínculo
 * (ex.: corretor fora de qualquer equipe) caem em "sem-equipe"/"sem-gestor", nunca são descartadas
 * nem atribuídas a outra pessoa. */
export function agruparPor(
  rows: ComparativoRowComCalculo[],
  tipo: "corretor" | "equipe" | "gestor",
): GrupoSecundario[] {
  const chaveELabel = (r: ComparativoRowComCalculo): [string, string] => {
    if (tipo === "corretor") return [r.corretor_id, r.corretorNome];
    if (tipo === "equipe") return [r.teamId ?? "sem-equipe", r.teamNome ?? "Sem equipe"];
    return [r.gestorId ?? "sem-gestor", r.gestorNome ?? "Sem gestor/team leader"];
  };
  const grupos = new Map<string, { label: string; rows: ComparativoRowComCalculo[] }>();
  for (const r of rows) {
    const [chave, label] = chaveELabel(r);
    const bucket = grupos.get(chave);
    if (bucket) bucket.rows.push(r); else grupos.set(chave, { label, rows: [r] });
  }
  return Array.from(grupos.entries())
    .map(([chave, { label, rows: bucket }]) => ({ chave, label, ...agregar(bucket) }))
    .sort((a, b) => b.comissaoTotal - a.comissaoTotal);
}

const STATUS_EXCLUIDOS = new Set(["cancelada", "arquivada"]);

/** Primeira vez que a venda entrou num status (ex.: 'ocorrencia_analise_financeiro') — menor
 * created_at entre as transições que bateram nesse status. Evita contar de novo se a venda foi
 * devolvida e reenviada mais de uma vez (reenvio nunca muda a data original de efetivação). null
 * quando a venda nunca chegou lá. */
export function primeiraDataDeStatus(historico: { para: string; created_at: string }[], status: string): string | null {
  const datas = historico.filter((h) => h.para === status).map((h) => h.created_at);
  if (!datas.length) return null;
  return datas.reduce((min, d) => (d < min ? d : min));
}

/** Evento único que comprova a efetivação da venda — regra de negócio confirmada: assinatura e
 * etapas anteriores concluídas E ocorrência efetivamente enviada ao financeiro. Vale igual pra
 * venda tradicional e Lançamento, sem distinção por modalidade — 'contrato_assinado' sozinho não
 * basta (ainda existe a etapa de preenchimento da ocorrência pelo gestor antes do envio real ao
 * financeiro; ver migration 20260813020000_corrige_efetivacao_comparativo_comissao). */
export const EVENTO_EFETIVACAO: EventoFechamento = "ocorrencia_analise_financeiro";

/** "Vendas que devem entrar": não cancelada/arquivada, tem valor negociado e comissão válidos
 * (>0), e tem data de efetivação do evento certo — 'ocorrencia_analise_financeiro', nunca aceita
 * 'contrato_assinado' sozinho como substituto. A RPC comparativo_comissao_6pct já garante isso em
 * SQL; esta função é a mesma regra em JS, usada como defesa — o frontend nunca aceita uma linha
 * que viole a regra, mesmo que uma resposta inesperada chegue. */
export function elegivelParaComparativo(row: {
  status: string;
  dataFechamento: string | null;
  eventoFechamento: EventoFechamento | null;
  valorNegociado: number | null | undefined;
  valorTotalComissao: number | null | undefined;
}): boolean {
  if (STATUS_EXCLUIDOS.has(row.status)) return false;
  if (row.dataFechamento == null || row.eventoFechamento == null) return false;
  if (row.eventoFechamento !== EVENTO_EFETIVACAO) return false;
  if (!(Number(row.valorNegociado ?? 0) > 0)) return false;
  if (!(Number(row.valorTotalComissao ?? 0) > 0)) return false;
  return true;
}

/** Status que indicam que a venda já entrou (ou passou) pela etapa de envio ao financeiro — mesmo
 * filtro aplicado em SQL por comparativo_comissao_6pct_inconsistencias. Numa venda de verdade, o
 * avanço automático contrato_assinado -> ocorrencia_pendente é instantâneo (mesma ação do gestor),
 * então nenhuma fica "parada" nesses dois status por muito tempo sem seguir adiante; se uma linha
 * aparece lá sem 'ocorrencia_analise_financeiro' no histórico (ex.: TESTE-VITEST, inserida direto
 * no banco pela suíte de integração, fora da esteira normal), é sinal de dado fora do fluxo — é
 * isso que o contador de inconsistências existe pra sinalizar. Exportada só como contrato
 * testado/documentado: a filtragem de verdade acontece na RPC, este módulo nunca lê
 * sale_status_history pra decidir inconsistência (InconsistenciaRow não carrega status/histórico). */
const STATUS_INDICA_ENVIO_FINANCEIRO = new Set([
  "contrato_assinado", "ocorrencia_pendente", "ocorrencia_analise_financeiro", "ocorrencia_devolvida_gestor", "ocorrencia_concluida",
]);
export function statusIndicaEnvioFinanceiro(status: string): boolean {
  return STATUS_INDICA_ENVIO_FINANCEIRO.has(status);
}

/** Únicos três papéis com acesso ao Comparativo 6% — mesma regra vale no menu (AppShell), na rota
 * (beforeLoad, que recebe direto o app_role bruto do banco — pode incluir o valor legado
 * "coordenador", fora do enum AppRole do frontend, daí o parâmetro aceitar string[] em vez de
 * AppRole[]) e na RPC (comparativo_comissao_6pct, checada no banco independente da RLS). */
const PAPEIS_COM_ACESSO = new Set(["admin", "super_admin", "financeiro"]);
export function podeAcessarComparativo6pct(roles: string[]): boolean {
  return roles.some((r) => PAPEIS_COM_ACESSO.has(r));
}
