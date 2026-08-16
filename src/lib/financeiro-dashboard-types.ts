/**
 * Tipos da Central Financeira (/financeiro) — Fase 1, somente leitura. Não confundir com
 * pagamento/repasse: tudo aqui é "previsto"/"recebido pela imobiliária" ou "comissão calculada"
 * (competência), nunca "pago ao beneficiário" (ver comparativo-comissao-types.ts para o
 * precedente da mesma distinção no Comparativo 6%).
 */

export type SituacaoParcela =
  | "recebido"
  | "recebido_parcial"
  | "recebido_diferenca"
  | "a_vencer"
  | "vencido"
  | "sem_previsao"
  | "cancelado_arquivado";

export const SITUACAO_PARCELA_LABEL: Record<SituacaoParcela, string> = {
  recebido: "Recebido",
  recebido_parcial: "Recebido parcialmente",
  recebido_diferenca: "Recebido com diferença",
  a_vencer: "A vencer",
  vencido: "Vencido",
  sem_previsao: "Sem previsão",
  cancelado_arquivado: "Cancelado/arquivado",
};

/** Uma parcela prevista de recebimento da imobiliária (grupo prev_recebimento{,2,3} de uma
 * ocorrência), já enriquecida com dados de venda/equipe pra exibição. */
export type ParcelaRecebimento = {
  key: string;
  saleId: string;
  occId: string;
  parcela: 1 | 2 | 3;
  imovelLabel: string;
  codigoInterno: string | null;
  corretorId: string;
  corretorNome: string;
  teamId: string | null;
  teamNome: string | null;
  gestorId: string | null;
  gestorNome: string | null;
  saleStatus: string;
  modalidade: string;
  cancelada: boolean;
  dataPrevista: string;
  formaPrevista: string | null;
  valorBrutoPrevisto: number;
  valorParceria: number;
  valorLiquidoPrevisto: number;
  dataRecebimento: string | null;
  valorRecebido: number | null;
  diferenca: number | null;
  situacao: SituacaoParcela;
};

export type OrigemComissao = "automatica" | "manual";
export type SituacaoRecebimentoVenda = "nao_recebido" | "parcial" | "recebido";

/** Uma linha de comissão calculada (competência) para um beneficiário — nunca "paga". */
export type ComissaoCalculada = {
  id: string;
  saleId: string;
  occId: string;
  imovelLabel: string;
  codigoInterno: string | null;
  dataEfetivacao: string | null;
  modalidade: string;
  saleCorretorId: string;
  papel: string;
  beneficiarioNome: string | null;
  beneficiarioUserId: string | null;
  teamId: string | null;
  teamNome: string | null;
  gestorId: string | null;
  gestorNome: string | null;
  percentual: number | null;
  valor: number;
  origem: OrigemComissao;
  semVinculoUsuario: boolean;
  situacaoRecebimentoVenda: SituacaoRecebimentoVenda;
};

export type GravidadeDivergencia = "alta" | "media" | "baixa";

/** Por que um beneficiário sem `user_id` está sem vínculo — nunca inferido só pela ausência de
 * correspondência (ver classificarVinculoBeneficiario em financeiro-dashboard-calc.ts). */
export type ClassificacaoVinculoBeneficiario =
  | "vinculo_pendente"
  | "externo_explicito"
  | "sem_correspondencia";

export type DivergenciaFinanceira = {
  id: string;
  gravidade: GravidadeDivergencia;
  saleId: string | null;
  imovelLabel: string | null;
  tipo: string;
  explicacao: string;
  valorAfetado: number | null;
  acaoRecomendada: string;
  linkTo: string | null;
};

export type AgingBucketKey =
  | "vence_hoje"
  | "prox_7"
  | "prox_30"
  | "d31_60"
  | "d61_90"
  | "acima_90"
  | "venc_1_7"
  | "venc_8_15"
  | "venc_16_30"
  | "venc_31_60"
  | "venc_mais_60";

export const AGING_BUCKET_LABEL: Record<AgingBucketKey, string> = {
  vence_hoje: "Vencendo hoje",
  prox_7: "Próximos 7 dias",
  prox_30: "Próximos 30 dias",
  d31_60: "31 a 60 dias",
  d61_90: "61 a 90 dias",
  acima_90: "Acima de 90 dias",
  venc_1_7: "Vencido 1–7 dias",
  venc_8_15: "Vencido 8–15 dias",
  venc_16_30: "Vencido 16–30 dias",
  venc_31_60: "Vencido 31–60 dias",
  venc_mais_60: "Vencido há mais de 60 dias",
};

export const AGING_A_VENCER_ORDEM: AgingBucketKey[] = [
  "vence_hoje",
  "prox_7",
  "prox_30",
  "d31_60",
  "d61_90",
  "acima_90",
];
export const AGING_VENCIDO_ORDEM: AgingBucketKey[] = [
  "venc_1_7",
  "venc_8_15",
  "venc_16_30",
  "venc_31_60",
  "venc_mais_60",
];

export type AgingFaixa = {
  key: AgingBucketKey;
  label: string;
  quantidade: number;
  valor: number;
  parcelas: ParcelaRecebimento[];
};

export type GrupoComissao = {
  chave: string;
  label: string;
  quantidade: number;
  valorTotal: number;
};

export type ModalidadeFiltroFin = "todas" | "padrao" | "lancamento";
export type SituacaoRecebimentoFiltro =
  | "todas"
  | "recebido"
  | "parcial"
  | "a_vencer"
  | "vencido"
  | "sem_previsao";
export type AgrupamentoComissao = "beneficiario" | "gestor" | "equipe" | "papel" | "mes" | "geral";

export type FinanceiroFiltros = {
  dataDe: string;
  dataAte: string;
  modalidade: ModalidadeFiltroFin;
  corretorId: string | null;
  gestorId: string | null;
  teamId: string | null;
  papel: string | null;
  situacaoRecebimento: SituacaoRecebimentoFiltro;
  busca: string;
  incluirCanceladas: boolean;
};

/** Uma venda efetivada (mesma regra do Comparativo 6%: 1ª entrada em `ocorrencia_analise_financeiro`)
 * — nível "venda", não "beneficiário". Alimenta só os cards de VGV/comissão bruta da Visão Geral;
 * a divisão por beneficiário é sempre ComissaoCalculada, nunca esta. */
export type EfetivacaoVenda = {
  saleId: string;
  imovelLabel: string;
  codigoInterno: string | null;
  dataEfetivacao: string;
  modalidade: string;
  corretorId: string;
  teamId: string | null;
  gestorId: string | null;
  valorNegociado: number;
  valorTotalComissao: number;
};

export type ResumoFinanceiro = {
  vgvEfetivado: number;
  comissaoBruta: number;
  previstoImobiliaria: number;
  recebidoImobiliaria: number;
  saldoAReceber: number;
  vencido: number;
  aVencer: number;
  previsao30: number;
  previsao60: number;
  previsao90: number;
  comissoesCalculadasTotal: number;
  divergenciasAbertas: number;
};
