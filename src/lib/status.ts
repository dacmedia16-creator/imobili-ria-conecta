export type SaleStatus =
  | "rascunho"
  | "enviada_revisao"
  | "devolvida_ajuste"
  | "aprovada_gestor"
  | "enviada_juridico"
  | "em_elaboracao_contrato"
  | "aguardando_assinatura"
  | "contrato_assinado"
  | "ocorrencia_pendente"
  | "ocorrencia_concluida"
  | "arquivada"
  | "cancelada";

export const STATUS_LABEL: Record<SaleStatus, string> = {
  rascunho: "Rascunho",
  enviada_revisao: "Enviada para revisão",
  devolvida_ajuste: "Devolvida para ajuste",
  aprovada_gestor: "Aprovada pelo gestor",
  enviada_juridico: "Enviada ao jurídico",
  em_elaboracao_contrato: "Em elaboração de contrato",
  aguardando_assinatura: "Aguardando assinatura",
  contrato_assinado: "Contrato assinado",
  ocorrencia_pendente: "Ocorrência pendente",
  ocorrencia_concluida: "Ocorrência concluída",
  arquivada: "Arquivada",
  cancelada: "Cancelada",
};

export const STATUS_TONE: Record<SaleStatus, string> = {
  rascunho: "bg-muted text-muted-foreground",
  enviada_revisao: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  devolvida_ajuste: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  aprovada_gestor: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  enviada_juridico: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  em_elaboracao_contrato: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  aguardando_assinatura: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  contrato_assinado: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  ocorrencia_pendente: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  ocorrencia_concluida: "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100",
  arquivada: "bg-muted text-muted-foreground",
  cancelada: "bg-destructive/15 text-destructive",
};

export const DOC_TYPES: { key: string; label: string; grupo: "pessoal" | "imovel"; obrigatorio?: boolean }[] = [
  { key: "rg", label: "RG", grupo: "pessoal", obrigatorio: true },
  { key: "cpf", label: "CPF", grupo: "pessoal", obrigatorio: true },
  { key: "certidao", label: "Certidão de nascimento ou casamento", grupo: "pessoal" },
  { key: "comprovante_endereco", label: "Comprovante de endereço", grupo: "pessoal" },
  { key: "matricula", label: "Matrícula do imóvel", grupo: "imovel", obrigatorio: true },
  { key: "iptu", label: "IPTU", grupo: "imovel" },
  { key: "cnd_condominio", label: "CND do condomínio (se aplicável)", grupo: "imovel" },
];

export const COMISSAO_PAPEIS: { key: string; label: string }[] = [
  { key: "corretor_captador", label: "Corretor captador" },
  { key: "indicador_captador", label: "Indicador do captador" },
  { key: "coordenador_captador", label: "Coordenador captador" },
  { key: "corretor_vendedor", label: "Corretor vendedor" },
  { key: "indicador_vendedor", label: "Indicador do vendedor" },
  { key: "coordenador_vendedor", label: "Coordenador vendedor" },
];

export type Pendencia = { campo: string; mensagem: string };

/**
 * Valida se a venda está pronta para ser enviada para revisão do gestor.
 * Retorna lista de pendências em português simples para o corretor.
 */
export function validarProntaParaRevisao(
  sale: any,
  parties: Record<string, any>,
  payment: any,
  docs: any[],
): Pendencia[] {
  const pend: Pendencia[] = [];

  // Imóvel
  if (!sale?.imovel_id && !sale?.codigo_interno) pend.push({ campo: "imovel", mensagem: "Falta identificar o imóvel (ID ou código interno)" });
  if (!sale?.matricula) pend.push({ campo: "matricula", mensagem: "Falta informar a matrícula do imóvel" });

  // Partes
  const vendedor = parties?.vendedor_1;
  if (!vendedor?.nome || !vendedor?.cpf_cnpj) pend.push({ campo: "vendedor", mensagem: "Falta preencher pelo menos um vendedor (nome + CPF)" });
  const comprador = parties?.comprador_1;
  if (!comprador?.nome || !comprador?.cpf_cnpj) pend.push({ campo: "comprador", mensagem: "Falta preencher pelo menos um comprador (nome + CPF)" });

  // Valores
  if (!sale?.valor_negociado || Number(sale.valor_negociado) <= 0) pend.push({ campo: "valor_negociado", mensagem: "Falta informar o valor negociado" });
  if (!sale?.percentual_comissao && !sale?.valor_total_comissao) pend.push({ campo: "comissao", mensagem: "Falta informar o percentual ou o valor total da comissão" });
  if (!payment || (!payment.entrada_valor && !payment.parcela1_valor && !payment.financiamento && !payment.fgts && !sale?.forma_pagamento)) {
    pend.push({ campo: "pagamento", mensagem: "Falta informar a forma de pagamento" });
  }

  // Docs obrigatórios
  const obrigatorios = DOC_TYPES.filter(d => d.obrigatorio);
  for (const t of obrigatorios) {
    const tem = docs.some(d => d.tipo === t.key && d.status !== "recusado");
    if (!tem) pend.push({ campo: `doc_${t.key}`, mensagem: `Falta enviar ${t.label}` });
  }

  return pend;
}
