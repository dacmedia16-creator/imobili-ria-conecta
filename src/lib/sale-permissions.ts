import type { AppRole } from "@/lib/auth";
import type { SaleStatus } from "@/lib/status";

type SaleParticipantes = {
  corretor_id: string;
  corretor_captador_id?: string | null;
  corretor_vendedor_id?: string | null;
  modalidade?: string | null;
};
type ExtraParticipante = { papel: string | null; user_id: string | null };

/** Corretores participantes da venda (atribuição de venda/produção/comissão), espelho de
 * public.sale_corretores. `sales.corretor_id` é só quem CADASTROU (autoria) — entra apenas como
 * fallback quando ainda não há nenhum corretor definido (rascunho recém-criado). */
export function corretoresDaVenda(
  sale: SaleParticipantes,
  extras: ExtraParticipante[] = [],
): string[] {
  const ids = new Set<string>();
  if (sale.corretor_captador_id) ids.add(sale.corretor_captador_id);
  if (sale.corretor_vendedor_id) ids.add(sale.corretor_vendedor_id);
  for (const e of extras)
    if (e.user_id && (e.papel === "corretor_captador" || e.papel === "corretor_vendedor"))
      ids.add(e.user_id);
  if (ids.size === 0 && sale.corretor_id) ids.add(sale.corretor_id);
  return [...ids];
}

/** Quem age na etapa do corretor (espelho de public.sale_responsaveis): os participantes na
 * venda padrão; no Lançamento, o operador que cadastrou (fluxo operacional, sem atribuição). */
export function responsaveisDaVenda(
  sale: SaleParticipantes,
  extras: ExtraParticipante[] = [],
): string[] {
  if (sale.modalidade === "lancamento") return [sale.corretor_id];
  return corretoresDaVenda(sale, extras);
}

/** Linha de listagem (RPC list_vendas_comerciais_paginadas*): `corretores_ids` já vem calculado
 * no banco (sale_corretores). Sem a coluna (resposta antiga), cai no criador. */
export type LinhaVendaParticipantes = {
  corretor_id: string;
  modalidade?: string | null;
  corretores_ids?: string[] | null;
};
export function corretoresDaLinha(s: LinhaVendaParticipantes): string[] {
  return s.corretores_ids && s.corretores_ids.length > 0 ? s.corretores_ids : [s.corretor_id];
}
export function responsaveisDaLinha(s: LinhaVendaParticipantes): string[] {
  return s.modalidade === "lancamento" ? [s.corretor_id] : corretoresDaLinha(s);
}

/** Papéis do usuário logado em relação a uma venda específica — extraído de vendas.$id.tsx,
 * que antes chamava hasAny/hasRole (do hook useAuth) direto no corpo do componente.
 * `responsaveis`: IDs de quem responde pela etapa do corretor (ver responsaveisDaVenda). */
export function getSaleRoleFlags(
  roles: AppRole[],
  responsaveis: string | string[],
  userId: string | undefined,
) {
  const ids = Array.isArray(responsaveis) ? responsaveis : [responsaveis];
  return {
    isOwner: !!userId && ids.includes(userId),
    isFinanceiro: roles.some((r) =>
      (["financeiro", "admin", "super_admin"] as AppRole[]).includes(r),
    ),
    isAdminLike: roles.some((r) => (["admin", "super_admin"] as AppRole[]).includes(r)),
    // team_leader tem exatamente as mesmas permissões de gestor em toda a venda (ver policies/
    // funções espelhadas na migration team_leader_same_perms_as_gestor).
    isGestor: roles.some((r) => (["gestor", "team_leader"] as AppRole[]).includes(r)),
    isJuridico: roles.includes("juridico"),
  };
}

/** Financeiro travou a venda (ocorrência aceita) ou ela já foi concluída — corretor, gestor e
 * jurídico ficam em modo leitura; só financeiro/admin/super_admin continuam editando. */
export function isSaleLocked(status: SaleStatus, aceitaFin: boolean): boolean {
  return aceitaFin || status === "ocorrencia_concluida";
}

export function corretorPodeEditar(isOwner: boolean, status: SaleStatus): boolean {
  // Depois da conferência do jurídico, o corretor ainda pode anexar documentos complementares
  // enquanto revisa o contrato; contrato e contrato assinado continuam com fluxo próprio.
  return (
    isOwner &&
    (["rascunho", "devolvida_ajuste", "contrato_conferencia_corretor"] as SaleStatus[]).includes(
      status,
    )
  );
}

export function gestorPodeEditar(
  isGestor: boolean,
  status: SaleStatus,
  donoPertenceEquipe = false,
): boolean {
  return (
    isGestor &&
    (status === "rascunho"
      ? donoPertenceEquipe
      : (
          [
            "enviada_revisao",
            "contrato_conferencia_gestor",
            "contrato_ok_corretor",
            "aguardando_assinatura",
            "contrato_assinado",
            "ocorrencia_pendente",
            "ocorrencia_devolvida_gestor",
          ] as SaleStatus[]
        ).includes(status))
  );
}

/** O gestor pode encerrar uma venda somente enquanto ela está em uma etapa sob responsabilidade
 * dele. O vínculo com a própria equipe é validado separadamente na tela e, obrigatoriamente, no
 * banco (is_lead_of), para a regra não depender apenas do frontend. */
export function gestorPodeEncerrar(isGestor: boolean, status: SaleStatus): boolean {
  return gestorPodeEditar(isGestor, status, false);
}

/** Etapas anteriores à assinatura do contrato (reunião de gestores 08/10/2026). */
export const STATUS_ANTES_ASSINATURA: readonly SaleStatus[] = [
  "rascunho",
  "enviada_revisao",
  "devolvida_ajuste",
  "aprovada_gestor",
  "enviada_juridico",
  "em_elaboracao_contrato",
  "contrato_conferencia_gestor",
  "contrato_conferencia_corretor",
  "contrato_ok_corretor",
  "aguardando_assinatura",
];

/** Arquivar venda (reunião de gestores 08/10/2026): qualquer pessoa que já vê/opera a venda —
 * inclusive o corretor — pode arquivar ANTES da assinatura do contrato; do contrato assinado em
 * diante, só admin/super_admin (comportamento anterior deles, inalterado). Quem chega à tela já
 * passou pela leitura da venda; o bloco 'arquivada' do trigger validate_sale_status_transition
 * (can_view_sale + etapa) continua sendo a autoridade. Motivo obrigatório no banco. */
export function podeArquivarVenda(isAdminLike: boolean, status: SaleStatus): boolean {
  if (status === "arquivada" || status === "cancelada") return false;
  return isAdminLike || STATUS_ANTES_ASSINATURA.includes(status);
}

/** Desarquivar venda (Denis, 09/10/2026): admin/super_admin, quem criou a venda (sales.corretor_id)
 * ou o gestor/team leader que lidera a venda. A venda volta para a etapa em que estava ao ser
 * arquivada (`etapaAnterior`, último registro do histórico); sem essa etapa não há para onde voltar.
 * Espelha o bloco "from_status = arquivada" do trigger validate_sale_status_transition. */
export function podeDesarquivarVenda(args: {
  status: SaleStatus;
  etapaAnterior: SaleStatus | null | undefined;
  isAdminLike: boolean;
  isCriador: boolean;
  isGestorDaVenda: boolean;
}): boolean {
  if (args.status !== "arquivada") return false;
  if (!args.etapaAnterior || args.etapaAnterior === "arquivada") return false;
  return args.isAdminLike || args.isCriador || args.isGestorDaVenda;
}

/** Cancelar venda (regra de Denis, 28/09/2026): só o dono da plataforma (platform_admins), e só
 * depois do rascunho — rascunho se exclui, não se cancela. Espelha o bloco "cancelada" do trigger
 * validate_sale_status_transition, que é a autoridade. */
export function podeCancelarVenda(isPlatformAdmin: boolean, status: SaleStatus): boolean {
  return (
    isPlatformAdmin && status !== "rascunho" && status !== "cancelada" && status !== "arquivada"
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
