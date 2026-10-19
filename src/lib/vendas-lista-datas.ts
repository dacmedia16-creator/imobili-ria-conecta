import { dataCivilSaoPaulo } from "@/lib/hoje-sao-paulo";
import type { SaleStatus } from "@/lib/status";

// Lista de Vendas (pedido de Denis 19/10/2026 + item 13 da reunião de 15/10): mostrar SEMPRE as duas
// datas com legenda — "Criada em" e "Assinada em" (ou "Ainda não assinada").
// `data_venda` da RPC list_vendas_comerciais_paginadas (migration 20261013120000) é a data oficial:
// última assinatura ou, sem assinatura, a criação. Aqui só decidimos se ela é mesmo uma assinatura;
// a regra de data oficial, o filtro de período e os relatórios não mudam.

/** Status que só existem depois do contrato assinado (Vendidos + ocorrência concluída). */
const STATUS_POS_ASSINATURA: ReadonlySet<string> = new Set<SaleStatus>([
  "contrato_assinado",
  "ocorrencia_pendente",
  "ocorrencia_analise_financeiro",
  "ocorrencia_devolvida_gestor",
  "ocorrencia_concluida",
]);

export type LinhaDatasVenda = {
  status: string | null;
  modalidade: string | null;
  created_at: string;
  data_assinatura: string | null;
  data_venda: string | null;
};

export type DatasVendaLista = {
  /** dd/mm/aaaa da criação (data civil de São Paulo). */
  criadaEm: string | null;
  /** dd/mm/aaaa da assinatura oficial, ou null quando ainda não assinada. */
  assinadaEm: string | null;
};

/** "YYYY-MM-DD" (ou timestamptz) -> "dd/mm/aaaa" no fuso de São Paulo. */
export function formatarDataBR(valor: string | null | undefined): string | null {
  const d = dataCivilSaoPaulo(valor);
  if (!d) return null;
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a}`;
}

/**
 * @param temContratoAssinadoNoHistorico venda tem ao menos um `contrato_assinado` em
 *   sale_status_history (lido pela própria tela, sob a RLS do usuário).
 */
export function datasDaVendaNaLista(
  s: LinhaDatasVenda,
  temContratoAssinadoNoHistorico: boolean,
): DatasVendaLista {
  const criadaCivil = dataCivilSaoPaulo(s.created_at);
  const vendaCivil = dataCivilSaoPaulo(s.data_venda);
  const lancamento = s.modalidade === "lancamento";
  const assinada = lancamento
    ? // Lançamento: a RPC só usa sales.data_assinatura; sem ela, data_venda é a criação.
      Boolean(s.data_assinatura)
    : temContratoAssinadoNoHistorico ||
      Boolean(s.data_assinatura) ||
      STATUS_POS_ASSINATURA.has(s.status ?? "") ||
      // data_venda diferente da criação só acontece quando veio de uma assinatura.
      (vendaCivil != null && criadaCivil != null && vendaCivil !== criadaCivil);
  return {
    criadaEm: formatarDataBR(criadaCivil),
    assinadaEm: assinada ? formatarDataBR(vendaCivil) : null,
  };
}
