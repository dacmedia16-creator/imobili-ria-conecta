/**
 * Barra de ações do topo do detalhe da venda (FASE 2, item 18 — t_7fcda931).
 *
 * SÓ ORGANIZA a tela: 1 botão principal + "Devolver" + menu "Mais". As condições de quem vê cada
 * botão são as mesmas que estavam escritas direto no JSX de `vendas.$id.tsx` (nenhuma regra nova);
 * o banco continua conferindo tudo de novo em cada ação.
 */
export type AcaoVendaId =
  | "enviar_revisao"
  | "aprovar_juridico"
  | "iniciar_contrato"
  | "subir_certidoes"
  | "anexar_contrato"
  | "substituir_contrato"
  | "enviar_contrato_gestor"
  | "enviar_corretor_conferir"
  | "enviar_direto_assinatura"
  | "dar_ok_contrato"
  | "enviar_assinatura"
  | "subir_contrato_assinado"
  | "substituir_contrato_assinado"
  | "marcar_contrato_assinado"
  | "criar_ocorrencia"
  | "enviar_ocorrencia_financeiro"
  | "desfazer_contrato_assinado"
  | "arquivar"
  | "desarquivar"
  | "cancelar_venda"
  | "excluir_venda"
  // Devoluções: o alvo vai no id (abre o mesmo diálogo de motivo de sempre).
  | "devolver_corretor"
  | "devolver_gestor"
  | "devolver_juridico";

export type AcaoVenda = {
  id: AcaoVendaId;
  label: string;
  /** Desabilitado: o motivo aparece escrito na tela (não só no title, que o celular não mostra). */
  disabled?: boolean;
  motivo?: string;
  /** Dica opcional (title) quando habilitado. */
  dica?: string;
  destrutiva?: boolean;
  /** Status de destino das devoluções (openReturnDialog). */
  alvo?: string;
};

export type AcoesVenda = { principal: AcaoVenda | null; devolver: AcaoVenda[]; mais: AcaoVenda[] };

export type EstadoAcoesVenda = {
  status: string;
  isGestor: boolean;
  isJuridico: boolean;
  isFinanceiro: boolean;
  isOwner: boolean;
  isAdminLike: boolean;
  podeEnviarRevisao: boolean;
  gestorDaEquipeRascunho: boolean;
  envioDiretoJuridico: boolean;
  canUploadCertidoes: boolean;
  contratoDocs: number;
  certidoesJuridicoDocs: number;
  contratoPendenciaDescricao: string | null | undefined;
  /** sale.contrato_libera_assinatura === false */
  assinaturaBloqueadaJuridico: boolean;
  clicksignAtalhoGestor: boolean;
  envioManualSimples: boolean;
  assinaturaManual: boolean;
  contratoAssinadoDocs: number;
  canCloseSale: boolean;
  canUnarchive: boolean;
  etapaAntesDeArquivar: string | null;
  canCancel: boolean;
  canDelete: boolean;
};

export const MOTIVO_ASSINATURA_BLOQUEADA = "Jurídico marcou que ainda não pode ir para assinatura";
export const MOTIVO_SEM_CERTIDAO =
  "Anexe ao menos uma certidão (ou sinalize a pendência ao anexar o contrato).";
export const MOTIVO_SEM_CONTRATO = "Anexe o contrato antes de enviar ao gestor.";
export const MOTIVO_SEM_CONTRATO_ASSINADO = "Suba o contrato assinado antes de marcar.";

const devolver = (alvo: string, label: string): AcaoVenda => ({
  id:
    alvo === "devolvida_ajuste" || alvo === "contrato_conferencia_corretor"
      ? "devolver_corretor"
      : alvo === "em_elaboracao_contrato"
        ? "devolver_juridico"
        : "devolver_gestor",
  label,
  alvo,
});

export function montarAcoesVenda(e: EstadoAcoesVenda): AcoesVenda {
  const principais: AcaoVenda[] = [];
  const dev: AcaoVenda[] = [];
  const mais: AcaoVenda[] = [];
  const s = e.status;

  // Corretor: envio inicial ou reenvio após devolução (dono gestor/TL vai direto ao jurídico).
  if (e.podeEnviarRevisao || e.gestorDaEquipeRascunho)
    principais.push({
      id: "enviar_revisao",
      label: e.envioDiretoJuridico ? "Enviar ao jurídico" : "Enviar ao gestor",
    });

  // Gestor: revisão inicial.
  if (e.isGestor && s === "enviada_revisao") {
    principais.push({ id: "aprovar_juridico", label: "Aprovar p/ jurídico" });
    dev.push(devolver("devolvida_ajuste", "Devolver ao corretor"));
  }

  // Jurídico: aceitar e elaborar.
  if (e.isJuridico && s === "aprovada_gestor") {
    principais.push({ id: "iniciar_contrato", label: "Iniciar contrato" });
    dev.push(devolver("enviada_revisao", "Devolver ao gestor"));
    dev.push(devolver("devolvida_ajuste", "Devolver ao corretor"));
  }
  const certidoes: AcaoVenda | null =
    e.isJuridico && e.canUploadCertidoes
      ? { id: "subir_certidoes", label: "Subir certidões" }
      : null;
  if (e.isJuridico && s === "em_elaboracao_contrato") {
    const semCertidao = e.certidoesJuridicoDocs === 0 && !e.contratoPendenciaDescricao;
    if (e.contratoDocs === 0) {
      // Sem contrato o envio ficava desabilitado: o passo seguinte é anexar.
      principais.push({ id: "anexar_contrato", label: "Anexar contrato" });
      mais.push({
        id: "enviar_contrato_gestor",
        label: "Enviar ao gestor",
        disabled: true,
        motivo: MOTIVO_SEM_CONTRATO,
      });
    } else {
      principais.push({
        id: "enviar_contrato_gestor",
        label: "Enviar ao gestor",
        disabled: semCertidao,
        motivo: semCertidao ? MOTIVO_SEM_CERTIDAO : undefined,
      });
      mais.push({ id: "substituir_contrato", label: "Substituir versão do contrato" });
    }
    dev.push(devolver("enviada_revisao", "Devolver ao gestor"));
    dev.push(devolver("devolvida_ajuste", "Devolver ao corretor"));
  }

  // Gestor: conferência do contrato.
  if (e.isGestor && s === "contrato_conferencia_gestor") {
    principais.push({ id: "enviar_corretor_conferir", label: "Enviar ao corretor conferir" });
    mais.push({
      id: "enviar_direto_assinatura",
      label: "Enviar direto para assinatura",
      disabled: e.assinaturaBloqueadaJuridico,
      motivo: e.assinaturaBloqueadaJuridico ? MOTIVO_ASSINATURA_BLOQUEADA : undefined,
      dica: e.clicksignAtalhoGestor
        ? "Pula a conferência do corretor: escolha assinatura digital (Clicksign) ou papel"
        : undefined,
    });
    dev.push(devolver("em_elaboracao_contrato", "Devolver ao jurídico"));
  }

  // Corretor (ou admin): conferência do contrato.
  if ((e.isOwner || e.isAdminLike) && s === "contrato_conferencia_corretor") {
    principais.push({ id: "dar_ok_contrato", label: "Dar OK no contrato" });
    dev.push(devolver("contrato_conferencia_gestor", "Devolver ao gestor"));
  }

  // Liberar para assinatura sem Clicksign (com Clicksign a escolha fica no cartão próprio).
  if (e.envioManualSimples)
    principais.push({
      id: "enviar_assinatura",
      label: "Enviar para assinatura",
      disabled: e.assinaturaBloqueadaJuridico,
      motivo: e.assinaturaBloqueadaJuridico ? MOTIVO_ASSINATURA_BLOQUEADA : undefined,
    });
  if (e.isGestor && s === "contrato_ok_corretor") {
    dev.push(devolver("em_elaboracao_contrato", "Devolver ao jurídico"));
    dev.push(devolver("contrato_conferencia_corretor", "Devolver ao corretor"));
  }

  // Em assinatura pela Clicksign: caminho de reserva do gestor (subir/marcar/devolver).
  if (e.isGestor && s === "aguardando_assinatura" && !e.assinaturaManual) {
    if (e.contratoAssinadoDocs === 0) {
      principais.push({ id: "subir_contrato_assinado", label: "Subir contrato assinado" });
      mais.push({
        id: "marcar_contrato_assinado",
        label: "Marcar contrato assinado",
        disabled: true,
        motivo: MOTIVO_SEM_CONTRATO_ASSINADO,
      });
    } else {
      principais.push({ id: "marcar_contrato_assinado", label: "Marcar contrato assinado" });
      mais.push({ id: "substituir_contrato_assinado", label: "Substituir contrato assinado" });
    }
    dev.push(devolver("em_elaboracao_contrato", "Devolver ao jurídico"));
  }

  if (e.isGestor && s === "contrato_assinado")
    principais.push({ id: "criar_ocorrencia", label: "Criar ocorrência e continuar" });
  if (e.isGestor && (s === "ocorrencia_pendente" || s === "ocorrencia_devolvida_gestor"))
    principais.push({
      id: "enviar_ocorrencia_financeiro",
      label: "Enviar ocorrência ao financeiro",
    });
  if (e.isGestor && s === "ocorrencia_pendente")
    mais.push({
      id: "desfazer_contrato_assinado",
      label: "Desfazer contrato assinado",
      alvo: "aguardando_assinatura",
    });

  // Financeiro: devolver ocorrência (o aceite fica no painel de Ocorrência).
  if (e.isFinanceiro && s === "ocorrencia_analise_financeiro")
    dev.push(devolver("ocorrencia_devolvida_gestor", "Devolver ao gestor"));

  const desarquivar: AcaoVenda | null =
    e.canUnarchive && e.etapaAntesDeArquivar ? { id: "desarquivar", label: "Desarquivar" } : null;

  // Um só botão principal; se houver mais de um, os outros vão para o "Mais".
  let principal = principais.shift() ?? null;
  mais.unshift(...principais);
  if (certidoes) {
    if (!principal) principal = certidoes;
    else mais.push(certidoes);
  }
  if (desarquivar) {
    if (!principal) principal = desarquivar;
    else mais.push(desarquivar);
  }
  if (e.canCloseSale && s !== "arquivada" && s !== "cancelada")
    mais.push({ id: "arquivar", label: "Arquivar" });
  if (e.canCancel) mais.push({ id: "cancelar_venda", label: "Cancelar venda", destrutiva: true });
  if (e.canDelete) mais.push({ id: "excluir_venda", label: "Excluir venda", destrutiva: true });

  return { principal, devolver: dev, mais };
}
