/**
 * Tipos do "Comparativo de Comissão — Padrão 6%" (/comparativo-comissao). Página somente leitura:
 * nenhum tipo aqui é persistido de volta no banco, só usados pra exibição.
 */

/** Evento de sale_status_history que comprova a efetivação da venda — regra de negócio
 * confirmada: assinatura/etapas anteriores concluídas E ocorrência efetivamente enviada ao
 * financeiro. É SEMPRE 'ocorrencia_analise_financeiro', igual pras duas modalidades
 * (tradicional e Lançamento) — 'contrato_assinado' sozinho não basta, porque ainda existe uma
 * etapa de preenchimento da ocorrência pelo gestor entre ele e o envio real ao financeiro. Ver
 * migration 20260813020000_corrige_efetivacao_comparativo_comissao. */
export type EventoFechamento = "ocorrencia_analise_financeiro";

/** Uma linha já ELEGÍVEL (efetivada), como devolvida pela RPC comparativo_comissao_6pct() — a
 * própria RPC só retorna quem passa em todas as regras (status não cancelada/arquivada, valores
 * válidos, e tem a primeira entrada em 'ocorrencia_analise_financeiro' no histórico); nada é
 * filtrado depois no frontend além da revalidação defensiva (ver elegivelParaComparativo). */
export type ComparativoRawRow = {
  sale_id: string;
  codigo_interno: string | null;
  imovel_id: string | null;
  modalidade: string; // 'padrao' | 'lancamento'
  status: string;
  corretor_id: string;
  valor_negociado: number;
  valor_total_comissao: number;
  parceria_externa?: number;
  percentual_comissao: number | null;
  data_fechamento: string; // date (YYYY-MM-DD) — data de efetivação
  evento_fechamento: EventoFechamento;
};

/** Motivo de uma venda aparecer no contador "Inconsistências encontradas": venda em etapa que já
 * indica envio/passagem pelo financeiro mas sem a entrada correspondente em
 * 'ocorrencia_analise_financeiro' no histórico (ex.: dado inserido fora da esteira normal, como o
 * TESTE-VITEST da suíte de integração), ou valores inválidos. Ver
 * comparativo_comissao_6pct_inconsistencias, migration 20260813020000. */
export type MotivoInconsistencia = "sem_historico_fechamento" | "valores_invalidos";

/** Linha da RPC comparativo_comissao_6pct_inconsistencias() — só ID/código interno e motivo, nunca
 * nome de corretor, valores ou outro dado pessoal (o contador é só informativo). */
export type InconsistenciaRow = {
  sale_id: string;
  codigo_interno: string | null;
  modalidade: string;
  motivo: MotivoInconsistencia;
};

/** Linha enriquecida com nome do corretor e vínculo de equipe/gestor — resolvidos no frontend
 * (profiles/teams/team_members/team_co_leaders), nunca pela RPC. */
export type ComparativoRow = ComparativoRawRow & {
  corretorNome: string;
  teamId: string | null;
  teamNome: string | null;
  gestorId: string | null;
  gestorNome: string | null;
};

export type SituacaoComissao = "abaixo" | "igual" | "acima";

/** Campos derivados pelas fórmulas (comparativo-comissao-calc.ts) — nunca persistidos. */
export type ComparativoCalculado = {
  percentualReal: number | null;
  vgvEquivalente6: number | null;
  diferencaVgv: number | null;
  percentualReducao: number | null;
  situacao: SituacaoComissao | null;
  divergenciaCadastro: boolean;
};

export type ComparativoRowComCalculo = ComparativoRow & ComparativoCalculado;

export type ModalidadeFiltro = "todas" | "padrao" | "lancamento";
export type SituacaoFiltro = "todas" | SituacaoComissao;
export type AgrupamentoSecundario = "corretor" | "equipe" | "gestor";
export type OrdenacaoCampo = "data" | "valor_negociado" | "valor_comissao" | "percentual_real" | "vgv_equivalente" | "diferenca";
export type OrdenacaoDirecao = "asc" | "desc";

export type ComparativoFiltros = {
  dataDe: string; // YYYY-MM-DD
  dataAte: string; // YYYY-MM-DD
  modalidade: ModalidadeFiltro;
  situacao: SituacaoFiltro;
  corretorId: string | null; // null = todos
  teamId: string | null; // null = todas
  busca: string; // código interno ou imóvel
};

export type ResumoComparativo = {
  quantidade: number;
  vgvRealTotal: number;
  comissaoTotal: number;
  percentualMedioPonderado: number | null;
  vgvEquivalente6Total: number;
  diferencaTotal: number;
};

export type GrupoMensal = {
  mes: string; // YYYY-MM
  quantidade: number;
  vgvReal: number;
  comissaoTotal: number;
  percentualMedioPonderado: number | null;
  vgvEquivalente6: number;
  diferenca: number;
};

export type GrupoSecundario = {
  chave: string;
  label: string;
  quantidade: number;
  vgvReal: number;
  comissaoTotal: number;
  percentualMedioPonderado: number | null;
  vgvEquivalente6: number;
  diferenca: number;
};
