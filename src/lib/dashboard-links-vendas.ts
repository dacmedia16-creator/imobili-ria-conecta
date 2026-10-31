/**
 * Item 20 (t_55ee647c): para onde cada número do Início leva na lista de Vendas.
 *
 * Regra (decisão MAX Principal): o número da lista precisa bater com o do cartão. Por isso só
 * ganham filtro os cartões que contam UM status (dashboard_stats_leve), com o período aberto
 * (o cartão não tem período). Cartões que somam 2 ou mais status, contam ocorrências ou dependem
 * de papel na venda continuam abrindo a lista sem filtro (`undefined`), exatamente como antes.
 * Nada aqui muda consulta, filtro ou permissão: só monta o endereço que a lista já entende
 * (readSalesFiltersFromUrl em vendas.index.tsx).
 */
export type BuscaVendas = { filtros: 1; status: string; de: ""; ate: "" };

const buscaStatus = (status: string): BuscaVendas => ({ filtros: 1, status, de: "", ate: "" });

/** Chave do cartão (campo de dashboard_stats) → filtro da lista. */
export const LINK_VENDAS_POR_CARTAO: Record<string, BuscaVendas | undefined> = {
  // Corretor
  minhas_vendas: undefined, // conta por papel na venda (corretor), não por status
  minhas_pendencias: undefined, // rascunho + devolvida_ajuste
  // Os dois abaixo contam só as vendas em que a pessoa é corretora/responsável; a lista mostra
  // todas as que ela enxerga (ex.: como indicadora). Na dúvida, sem filtro.
  meus_contratos_conferir: undefined,
  meus_assinados: undefined,
  // Gestor / Team Leader
  gestor_aguardando_revisao: buscaStatus("enviada_revisao"),
  gestor_contratos_conferir: undefined, // 2 status
  gestor_ocorrencias_enviar: undefined, // 2 status
  gestor_devolvidas: undefined, // 2 status
  // Jurídico
  juridico_aprovadas_gestor: buscaStatus("aprovada_gestor"),
  juridico_em_elaboracao: buscaStatus("em_elaboracao_contrato"),
  juridico_aguardando_assinatura: buscaStatus("aguardando_assinatura"),
  juridico_assinados: buscaStatus("contrato_assinado"),
  // Financeiro
  fin_ocorrencias_analise: buscaStatus("ocorrencia_analise_financeiro"),
  fin_devolvidas: buscaStatus("ocorrencia_devolvida_gestor"),
  occ_pendentes_total: undefined, // conta ocorrências, não vendas
  occ_concluidas_total: undefined, // conta ocorrências, não vendas
};

/** "outubro de 2026" → "Outubro de 2026" (só a primeira letra; o "de" fica minúsculo). */
export function primeiraMaiuscula(texto: string): string {
  return texto ? texto.charAt(0).toLocaleUpperCase("pt-BR") + texto.slice(1) : texto;
}

/**
 * Painel recolhível do Início: a escolha explícita da pessoa vale; sem escolha, abre quando há
 * pendência. Valores antigos ("0" gravado automaticamente ao montar) ficam numa chave anterior e
 * não contam como escolha.
 */
export function painelComecaAberto(escolhaSalva: string | null, temPendencia: boolean): boolean {
  if (escolhaSalva === "1") return true;
  if (escolhaSalva === "0") return false;
  return temPendencia;
}
