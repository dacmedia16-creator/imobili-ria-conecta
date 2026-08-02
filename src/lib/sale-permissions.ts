import type { AppRole } from "@/lib/auth";
import type { SaleStatus } from "@/lib/status";

/** Papéis do usuário logado em relação a uma venda específica — extraído de vendas.$id.tsx,
 * que antes chamava hasAny/hasRole (do hook useAuth) direto no corpo do componente. */
export function getSaleRoleFlags(
  roles: AppRole[],
  saleCorretorId: string,
  userId: string | undefined,
) {
  return {
    isOwner: saleCorretorId === userId,
    isFinanceiro: roles.some((r) =>
      (["financeiro", "admin", "super_admin"] as AppRole[]).includes(r),
    ),
    isAdminLike: roles.some((r) => (["admin", "super_admin"] as AppRole[]).includes(r)),
    isGestor: roles.includes("gestor"),
    isJuridico: roles.includes("juridico"),
  };
}

/** Financeiro travou a venda (ocorrência aceita) ou ela já foi concluída — corretor, gestor e
 * jurídico ficam em modo leitura; só financeiro/admin/super_admin continuam editando. */
export function isSaleLocked(status: SaleStatus, aceitaFin: boolean): boolean {
  return aceitaFin || status === "ocorrencia_concluida";
}

export function corretorPodeEditar(isOwner: boolean, status: SaleStatus): boolean {
  return isOwner && (status === "rascunho" || status === "devolvida_ajuste");
}

export function gestorPodeEditar(isGestor: boolean, status: SaleStatus): boolean {
  return (
    isGestor &&
    (
      [
        "enviada_revisao",
        "contrato_conferencia_gestor",
        "contrato_ok_corretor",
        "aguardando_assinatura",
        "contrato_assinado",
        "ocorrencia_pendente",
        "ocorrencia_devolvida_gestor",
      ] as SaleStatus[]
    ).includes(status)
  );
}

export function juridicoPodeEditar(isJuridico: boolean, status: SaleStatus): boolean {
  return (
    isJuridico && (["aprovada_gestor", "em_elaboracao_contrato"] as SaleStatus[]).includes(status)
  );
}

/** Quem pode editar campos (Resumo/Partes/Pagamento/Docs) segundo o estado atual. */
export function podeEditarVenda(args: {
  corretorEdits: boolean;
  gestorEdits: boolean;
  juridicoEdits: boolean;
  isFinanceiro: boolean;
  isAdminLike: boolean;
  locked: boolean;
}): boolean {
  return (
    (args.corretorEdits ||
      args.gestorEdits ||
      args.juridicoEdits ||
      args.isFinanceiro ||
      args.isAdminLike) &&
    (!args.locked || args.isFinanceiro || args.isAdminLike)
  );
}

/** Divisão da comissão é decisão do gestor — mesmo quando a venda volta pro corretor
 * (devolvida_ajuste) pra ajustar outra coisa, ele só pode VER essa parte, não editar. */
export function podeEditarComissao(args: {
  gestorEdits: boolean;
  isFinanceiro: boolean;
  isAdminLike: boolean;
  locked: boolean;
}): boolean {
  return (
    (args.gestorEdits || args.isFinanceiro || args.isAdminLike) &&
    (!args.locked || args.isFinanceiro || args.isAdminLike)
  );
}

/** Corretor só enxerga o bloco "Divisão da comissão" quando o gestor devolveu a venda pra ele
 * (devolvida_ajuste) — fora disso o bloco fica oculto. Gestor/financeiro/admin/jurídico sempre veem. */
export function deveOcultarBlocoComissao(isOwner: boolean, status: SaleStatus): boolean {
  return isOwner && status !== "devolvida_ajuste";
}

/** Única regra da divisão de comissão: captador + vendedor não pode ultrapassar o valor total. */
export function comissaoValorExcedido(
  valorTotalComissao: number,
  valorCaptador: number,
  valorVendedor: number,
): boolean {
  const total = Number(valorTotalComissao ?? 0);
  const soma = Number(valorCaptador ?? 0) + Number(valorVendedor ?? 0);
  return total > 0 && soma > total + 0.01;
}

export function podeVerOcorrencia(status: SaleStatus): boolean {
  return (
    [
      "contrato_assinado",
      "ocorrencia_pendente",
      "ocorrencia_analise_financeiro",
      "ocorrencia_devolvida_gestor",
      "ocorrencia_concluida",
    ] as SaleStatus[]
  ).includes(status);
}

export function podeVerResumoCompleto(status: SaleStatus): boolean {
  return !(["rascunho", "devolvida_ajuste", "enviada_revisao"] as SaleStatus[]).includes(status);
}

export function podeEditarOcorrencia(args: {
  isGestor: boolean;
  status: SaleStatus;
  isFinanceiro: boolean;
  isAdminLike: boolean;
}): boolean {
  return (
    (args.isGestor &&
      (
        ["contrato_assinado", "ocorrencia_pendente", "ocorrencia_devolvida_gestor"] as SaleStatus[]
      ).includes(args.status)) ||
    args.isFinanceiro ||
    args.isAdminLike
  );
}

export function podeFinalizarOcorrencia(isFinanceiro: boolean, isAdminLike: boolean): boolean {
  return isFinanceiro || isAdminLike;
}
