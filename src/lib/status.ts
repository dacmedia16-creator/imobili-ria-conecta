export type SaleStatus =
  | "rascunho"
  | "enviada_revisao"
  | "devolvida_ajuste"
  | "aprovada_gestor"
  | "enviada_juridico"
  | "em_elaboracao_contrato"
  | "contrato_conferencia_gestor"
  | "contrato_conferencia_corretor"
  | "contrato_ok_corretor"
  | "aguardando_assinatura"
  | "contrato_assinado"
  | "ocorrencia_pendente"
  | "ocorrencia_analise_financeiro"
  | "ocorrencia_devolvida_gestor"
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
  contrato_conferencia_gestor: "Contrato — conferência do gestor",
  contrato_conferencia_corretor: "Contrato — conferência do corretor",
  contrato_ok_corretor: "Contrato aprovado pelo corretor",
  aguardando_assinatura: "Aguardando assinatura",
  contrato_assinado: "Contrato assinado",
  ocorrencia_pendente: "Ocorrência pendente",
  ocorrencia_analise_financeiro: "Ocorrência em análise (Financeiro)",
  ocorrencia_devolvida_gestor: "Ocorrência devolvida ao gestor",
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
  contrato_conferencia_gestor: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  contrato_conferencia_corretor: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  contrato_ok_corretor: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  aguardando_assinatura: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  contrato_assinado: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  ocorrencia_pendente: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  ocorrencia_analise_financeiro: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  ocorrencia_devolvida_gestor: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  ocorrencia_concluida: "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100",
  arquivada: "bg-muted text-muted-foreground",
  cancelada: "bg-destructive/15 text-destructive",
};

/** Agrupa os status granulares nas 6 macro-etapas do fluxo, para exibir um stepper visual. */
export type FlowStageKey = "corretor" | "gestor" | "juridico" | "contrato" | "financeiro" | "concluida";
export const FLOW_STAGES: { key: FlowStageKey; label: string; statuses: SaleStatus[] }[] = [
  { key: "corretor", label: "Corretor", statuses: ["rascunho", "devolvida_ajuste"] },
  { key: "gestor", label: "Gestor", statuses: ["enviada_revisao"] },
  { key: "juridico", label: "Jurídico", statuses: ["aprovada_gestor", "enviada_juridico", "em_elaboracao_contrato"] },
  { key: "contrato", label: "Contrato / assinatura", statuses: ["contrato_conferencia_gestor", "contrato_conferencia_corretor", "contrato_ok_corretor", "aguardando_assinatura", "contrato_assinado"] },
  { key: "financeiro", label: "Financeiro", statuses: ["ocorrencia_pendente", "ocorrencia_analise_financeiro", "ocorrencia_devolvida_gestor"] },
  { key: "concluida", label: "Concluída", statuses: ["ocorrencia_concluida"] },
];

/** true quando o status atual representa uma devolução (algo precisa ser corrigido antes de seguir) */
export function isReturnStatus(status: SaleStatus): boolean {
  return status === "devolvida_ajuste" || status === "ocorrencia_devolvida_gestor";
}

export function flowStageIndex(status: SaleStatus): number {
  return FLOW_STAGES.findIndex((s) => s.statuses.includes(status));
}

/** Quantos dias faz desde `sinceIso`, e um rótulo/tom prontos para exibir como indicador de "tempo parado". */
export function agingInfo(sinceIso: string): { dias: number; label: string; tone: "muted" | "amber" | "destructive" } {
  const dias = Math.max(0, Math.floor((Date.now() - new Date(sinceIso).getTime()) / (1000 * 60 * 60 * 24)));
  const label = dias === 0 ? "hoje" : dias === 1 ? "há 1 dia" : `há ${dias} dias`;
  const tone = dias > 5 ? "destructive" : dias >= 3 ? "amber" : "muted";
  return { dias, label, tone };
}

export type DocGrupo = "pessoal" | "imovel" | "outros";
export const DOC_GRUPO_LABEL: Record<DocGrupo, string> = {
  pessoal: "Documentos pessoais",
  imovel: "Documentos do imóvel",
  outros: "Outros documentos",
};

export type DocParte = "comprador_1" | "comprador_2" | "vendedor_1" | "vendedor_2" | "imovel" | "outros";
export const DOC_PARTE_LABEL: Record<DocParte, string> = {
  comprador_1: "Cliente Comprador 1",
  comprador_2: "Cliente Comprador 2",
  vendedor_1: "Cliente Vendedor 1",
  vendedor_2: "Cliente Vendedor 2",
  imovel: "Documentos do Imóvel",
  outros: "Outros",
};


export const DOC_TYPES: { key: string; label: string; grupo: DocGrupo; obrigatorio?: boolean }[] = [
  { key: "rg", label: "RG", grupo: "pessoal", obrigatorio: true },
  { key: "cpf", label: "CPF", grupo: "pessoal", obrigatorio: true },
  { key: "cnh", label: "CNH (dispensa RG e CPF)", grupo: "pessoal" },
  { key: "certidao", label: "Certidão de nascimento ou casamento", grupo: "pessoal" },
  { key: "comprovante_endereco", label: "Comprovante de endereço", grupo: "pessoal" },
  { key: "matricula", label: "Matrícula do imóvel", grupo: "imovel", obrigatorio: true },
  { key: "iptu", label: "IPTU", grupo: "imovel" },
  { key: "cnd_condominio", label: "CND do condomínio (se aplicável)", grupo: "imovel" },
  { key: "contrato", label: "Contrato (versão para revisão)", grupo: "outros" },
  { key: "contrato_assinado", label: "Contrato assinado", grupo: "outros" },
  { key: "outros", label: "Outros documentos", grupo: "outros" },
];


/** Retorna o rótulo do responsável pela próxima ação de acordo com o status. */
export function proximoResponsavel(status: SaleStatus): { titulo: string; papel: string } {
  switch (status) {
    case "rascunho": return { titulo: "Aguardando envio do corretor", papel: "Corretor" };
    case "devolvida_ajuste": return { titulo: "Aguardando correção do corretor", papel: "Corretor" };
    case "enviada_revisao": return { titulo: "Aguardando revisão do gestor", papel: "Gestor" };
    case "aprovada_gestor":
    case "enviada_juridico": return { titulo: "Aguardando elaboração do jurídico", papel: "Jurídico" };
    case "em_elaboracao_contrato": return { titulo: "Contrato em elaboração", papel: "Jurídico" };
    case "contrato_conferencia_gestor": return { titulo: "Gestor conferindo o contrato", papel: "Gestor" };
    case "contrato_conferencia_corretor": return { titulo: "Corretor conferindo o contrato", papel: "Corretor" };
    case "contrato_ok_corretor": return { titulo: "Aguardando gestor liberar assinatura", papel: "Gestor" };
    case "aguardando_assinatura": return { titulo: "Aguardando assinatura e upload do contrato assinado", papel: "Gestor / Partes" };
    case "contrato_assinado": return { titulo: "Contrato assinado — gestor deve preencher a ocorrência", papel: "Gestor" };
    case "ocorrencia_pendente": return { titulo: "Ocorrência pendente de envio ao financeiro", papel: "Gestor" };
    case "ocorrencia_analise_financeiro": return { titulo: "Ocorrência em análise do financeiro", papel: "Financeiro" };
    case "ocorrencia_devolvida_gestor": return { titulo: "Ocorrência devolvida — ajustar e reenviar", papel: "Gestor" };
    case "ocorrencia_concluida": return { titulo: "Ocorrência concluída", papel: "—" };
    case "arquivada": return { titulo: "Venda arquivada", papel: "—" };
    case "cancelada": return { titulo: "Venda cancelada", papel: "—" };
  }
}

export const COMISSAO_PAPEIS: { key: string; label: string }[] = [
  { key: "corretor_captador", label: "Corretor captador" },
  { key: "indicador_captador", label: "Indicador do captador" },
  { key: "coordenador_captador", label: "Coordenador captador" },
  { key: "corretor_vendedor", label: "Corretor vendedor" },
  { key: "indicador_vendedor", label: "Indicador do vendedor" },
  { key: "coordenador_vendedor", label: "Coordenador vendedor" },
  { key: "gestor", label: "Gestor" },
  { key: "team_leader", label: "Team Leader" },
  { key: "outro", label: "Outro" },
];

export type Pendencia = { campo: string; mensagem: string };

/** Toda checagem não-documental feita por validarProntaParaRevisao — mantém o total de checks em sincronia com a função. */
export const CHECKS_NAO_DOCUMENTAIS = ["imovel", "matricula", "vendedor", "comprador", "valor_negociado", "comissao", "pagamento"] as const;

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

  // Docs obrigatórios — a CNH dispensa RG e CPF, já que contém as duas informações.
  const obrigatorios = DOC_TYPES.filter(d => d.obrigatorio);
  for (const t of obrigatorios) {
    const substituiPorCnh = t.key === "rg" || t.key === "cpf";
    const tem = docs.some(d => docSatisfazObrigatorio(d, t.key));
    if (!tem) pend.push({ campo: `doc_${t.key}`, mensagem: `Falta aprovar ${t.label}${substituiPorCnh ? " (ou a CNH)" : ""}` });
  }

  return pend;
}

/** Um documento obrigatório só conta como resolvido quando está de fato aprovado (não basta ter sido enviado). */
export function docSatisfazObrigatorio(doc: { tipo: string; status: string }, tipoObrigatorio: string): boolean {
  const substituiPorCnh = tipoObrigatorio === "rg" || tipoObrigatorio === "cpf";
  return (doc.tipo === tipoObrigatorio || (substituiPorCnh && doc.tipo === "cnh")) && doc.status === "aprovado";
}

/**
 * Existe um documento do tipo `tipoAlvo` (ou uma CNH, quando `tipoAlvo` for "rg"/"cpf" — a CNH
 * dispensa os dois) para a `parte` informada, cujo status passe em `aceitaStatus`.
 * Ponto único da regra "CNH substitui RG/CPF", reaproveitado tanto pelo indicador de bloco
 * completo quanto pelo badge "Dispensado" da tela de Documentos.
 */
export function temDocDoTipo(
  docs: { tipo: string; parte?: string | null; status: string }[],
  tipoAlvo: string,
  parte: string,
  aceitaStatus: (status: string) => boolean = (s) => s !== "recusado",
): boolean {
  const substituiPorCnh = tipoAlvo === "rg" || tipoAlvo === "cpf";
  return docs.some(d => (d.tipo === tipoAlvo || (substituiPorCnh && d.tipo === "cnh")) && (d.parte ?? "outros") === parte && aceitaStatus(d.status));
}
