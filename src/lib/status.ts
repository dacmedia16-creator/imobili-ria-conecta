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

export const DOC_TYPES: { key: string; label: string; grupo: "pessoal" | "imovel" }[] = [
  { key: "rg", label: "RG", grupo: "pessoal" },
  { key: "cpf", label: "CPF", grupo: "pessoal" },
  { key: "certidao", label: "Certidão de nascimento ou casamento", grupo: "pessoal" },
  { key: "comprovante_endereco", label: "Comprovante de endereço", grupo: "pessoal" },
  { key: "matricula", label: "Matrícula do imóvel", grupo: "imovel" },
  { key: "iptu", label: "IPTU", grupo: "imovel" },
  { key: "cnd_condominio", label: "CND do condomínio (se aplicável)", grupo: "imovel" },
];
