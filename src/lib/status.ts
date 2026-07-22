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

// Compradores e vendedores são em número livre (comprador_1, comprador_2, comprador_3, ...) —
// o corretor pode adicionar quantos precisar, não só os 2 de cada lado que existiam antes.
export type DocParte = `comprador_${number}` | `vendedor_${number}` | "imovel" | "outros" | "juridico";

const PARTE_FIXA_LABEL: Record<"imovel" | "outros" | "juridico", string> = {
  imovel: "Documentos do Imóvel",
  outros: "Outros",
  juridico: "Certidões (Jurídico)",
};

/** Rótulo de exibição para qualquer "parte"/"papel" — comprador_N/vendedor_N num formato livre, mais os 3 fixos. */
export function parteLabel(parte: string): string {
  const m = parte.match(/^(comprador|vendedor)_(\d+)$/);
  if (m) {
    const tipo = m[1] === "comprador" ? "Cliente Comprador" : "Cliente Vendedor/Proprietário";
    return `${tipo} ${m[2]}`;
  }
  return (PARTE_FIXA_LABEL as Record<string, string>)[parte] ?? parte;
}

/** Pra qual "parte" base (sempre o nº 1 do mesmo tipo) um comprador_N/vendedor_N reaproveitaria documento — null se não se aplica (já é o 1º, ou não é comprador/vendedor). */
export function parteBase(parte: string): string | null {
  const m = parte.match(/^(comprador|vendedor)_(\d+)$/);
  if (!m || m[2] === "1") return null;
  return `${m[1]}_1`;
}

/** Ordena comprador_N/vendedor_N em ordem natural (vendedor antes de comprador, depois por número). */
export function parteSortKey(parte: string): [number, number] {
  const m = parte.match(/^(vendedor|comprador)_(\d+)$/);
  if (!m) return [99, 0];
  return [m[1] === "vendedor" ? 0 : 1, Number(m[2])];
}

/** Status a partir do qual a venda já passou pelo gestor e está (ou já esteve) nas mãos do jurídico. */
export function chegouAoJuridico(status: SaleStatus): boolean {
  return !["rascunho", "devolvida_ajuste", "enviada_revisao"].includes(status);
}


export const DOC_TYPES: { key: string; label: string; grupo: DocGrupo; obrigatorio?: boolean }[] = [
  { key: "rg", label: "RG", grupo: "pessoal", obrigatorio: true },
  { key: "cpf", label: "CPF", grupo: "pessoal", obrigatorio: true },
  { key: "cnh", label: "CNH (dispensa RG e CPF)", grupo: "pessoal" },
  { key: "certidao", label: "Certidão de nascimento ou casamento", grupo: "pessoal", obrigatorio: true },
  { key: "comprovante_endereco", label: "Comprovante de endereço", grupo: "pessoal", obrigatorio: true },
  { key: "matricula", label: "Matrícula do imóvel", grupo: "imovel", obrigatorio: true },
  { key: "iptu", label: "IPTU", grupo: "imovel", obrigatorio: true },
  { key: "cnd_condominio", label: "CND do condomínio (se aplicável)", grupo: "imovel" },
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

/** Papel(is) responsável(is) pela próxima ação em cada status — usado para destacar, na lista de
 * vendas, quais vendas estão esperando uma ação do usuário logado ("é a vez dele"). */
export type ResponsavelRole = "corretor" | "gestor" | "juridico" | "financeiro";
export function proximoResponsavelRoles(status: SaleStatus): ResponsavelRole[] {
  switch (status) {
    case "rascunho":
    case "devolvida_ajuste":
    case "contrato_conferencia_corretor":
      return ["corretor"];
    case "enviada_revisao":
    case "contrato_conferencia_gestor":
    case "contrato_ok_corretor":
    case "aguardando_assinatura":
    case "contrato_assinado":
    case "ocorrencia_pendente":
    case "ocorrencia_devolvida_gestor":
      return ["gestor"];
    case "aprovada_gestor":
    case "enviada_juridico":
    case "em_elaboracao_contrato":
      return ["juridico"];
    case "ocorrencia_analise_financeiro":
      return ["financeiro"];
    default:
      return [];
  }
}

export const COMISSAO_PAPEIS: { key: string; label: string }[] = [
  { key: "corretor_captador", label: "Corretor captador" },
  { key: "indicador_captador", label: "Indicador do captador" },
  { key: "corretor_vendedor", label: "Corretor vendedor" },
  { key: "indicador_vendedor", label: "Indicador do vendedor" },
  { key: "gestor", label: "Gestor" },
  { key: "team_leader", label: "Team Leader" },
  { key: "outro", label: "Outro" },
];

/** Tipos de parceria externa que a Resumo pode sinalizar antes de a venda chegar à Ocorrência. */
export const PARCERIA_TIPOS: { key: string; label: string }[] = [
  { key: "imobiliaria_externa", label: "Imobiliária externa" },
  { key: "remax_externa", label: "Outra unidade RE/MAX" },
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
  if (!vendedor?.nome || !vendedor?.cpf_cnpj) pend.push({ campo: "vendedor", mensagem: "Falta preencher pelo menos um vendedor/proprietário (nome + CPF)" });
  const comprador = parties?.comprador_1;
  if (!comprador?.nome || !comprador?.cpf_cnpj) pend.push({ campo: "comprador", mensagem: "Falta preencher pelo menos um comprador (nome + CPF)" });

  // Valores
  if (!sale?.valor_negociado || Number(sale.valor_negociado) <= 0) pend.push({ campo: "valor_negociado", mensagem: "Falta informar o valor negociado" });
  if (!sale?.percentual_comissao && !sale?.valor_total_comissao) pend.push({ campo: "comissao", mensagem: "Falta informar o percentual ou o valor total da comissão" });
  if (!payment || (!payment.entrada_valor && !payment.parcela1_valor && !payment.financiamento && !payment.fgts && !sale?.forma_pagamento)) {
    pend.push({ campo: "pagamento", mensagem: "Falta informar a forma de pagamento" });
  }

  // Docs obrigatórios — a CNH dispensa RG e CPF, já que contém as duas informações.
  // Os do grupo "pessoal" são exigidos de cada comprador/vendedor (pode haver quantos o corretor
  // adicionar), não só do 1º de cada — cada um precisa dos seus próprios documentos.
  const obrigatorios = DOC_TYPES.filter(d => d.obrigatorio);
  const partesPessoais = partesComExigenciaPessoal(parties, docs);
  for (const t of obrigatorios) {
    const substituiPorCnh = t.key === "rg" || t.key === "cpf";
    if (t.grupo === "pessoal") {
      for (const parte of partesPessoais) {
        if (!temDocDoTipo(docs, t.key, parte)) {
          pend.push({ campo: `doc_${t.key}_${parte}`, mensagem: `Falta enviar ${t.label} de ${parteLabel(parte)}${substituiPorCnh ? " (ou a CNH)" : ""}` });
        }
      }
    } else if (!docs.some(d => docSatisfazObrigatorio(d, t.key))) {
      pend.push({ campo: `doc_${t.key}`, mensagem: `Falta enviar ${t.label}` });
    }
  }

  return pend;
}

/**
 * Comprador_N/vendedor_N que precisam ter seus próprios documentos pessoais obrigatórios (RG, CPF,
 * Certidão, Comprovante de endereço): os dois papéis-base (sempre) mais qualquer parte extra que já
 * tenha nome preenchido na aba Partes ou já tenha ao menos um documento enviado na aba Documentos —
 * o corretor pode adicionar tantos compradores/vendedores quanto precisar, e cada um conta.
 */
export function partesComExigenciaPessoal(parties: Record<string, any>, docs: { parte?: string | null }[]): string[] {
  const base = ["vendedor_1", "comprador_1"];
  const extrasDeParties = Object.keys(parties).filter((p) => /^(vendedor|comprador)_\d+$/.test(p) && parties[p]?.nome);
  const extrasDeDocs = docs.map((d) => d.parte).filter((p): p is string => !!p && /^(vendedor|comprador)_\d+$/.test(p));
  return Array.from(new Set([...base, ...extrasDeParties, ...extrasDeDocs]));
}

/**
 * Um documento obrigatório conta como resolvido assim que enviado (não pode estar recusado).
 * A aprovação em si acontece depois, já com o gestor/jurídico revisando — exigir aprovação
 * aqui travaria o envio, já que só quem aprova é quem só entra na venda depois do envio.
 */
export function docSatisfazObrigatorio(doc: { tipo: string; status: string }, tipoObrigatorio: string): boolean {
  const substituiPorCnh = tipoObrigatorio === "rg" || tipoObrigatorio === "cpf";
  return (doc.tipo === tipoObrigatorio || (substituiPorCnh && doc.tipo === "cnh")) && doc.status !== "recusado";
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
