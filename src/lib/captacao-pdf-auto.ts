/**
 * PDF para assinatura automático (Denis 03/11/2026, t_ef7dc621, "opção 1"): quando quem pode gerar
 * (gestor, team leader ou ADM — a mesma regra do cartão "Gerar PDF para assinatura") abre uma
 * captação normal já enviada pelo corretor e ainda sem PDF salvo, a tela gera e salva o PDF sozinha,
 * uma única vez por captação aberta. Só regra de tela; o banco continua decidindo quem pode gravar
 * (exclusive_register_document: só gestor/TL/ADM e só com a captação em 'enviada').
 */
export type PdfAutoInput = {
  /** Captação carregada para o id da rota. */
  capture: {
    id: string;
    status: string;
    manual?: boolean | null;
    archived_at?: string | null;
  } | null;
  routeId: string;
  /** Mesma condição do cartão atual: gestor, team leader, admin ou super_admin. */
  manager: boolean;
  docs: ReadonlyArray<{ kind: string }>;
  /** Catálogo do Plano de Marketing ainda carregando: espera (senão o PDF sairia sem o Plano). */
  dossieLoading: boolean;
  busy: boolean;
  /** Ids já tentados nesta tela (sucesso ou falha): nunca tenta de novo sozinho. */
  tentados: ReadonlySet<string>;
};

export function deveGerarPdfAuto(i: PdfAutoInput): boolean {
  const c = i.capture;
  if (!c || c.id !== i.routeId) return false;
  if (!i.manager || c.manual || c.archived_at || c.status !== "enviada") return false;
  if (i.docs.some((d) => d.kind === "gerado")) return false;
  if (i.dossieLoading || i.busy) return false;
  return !i.tentados.has(c.id);
}

export const PDF_AUTO_FALHA = (motivo: string) =>
  `O PDF para assinatura não foi gerado automaticamente: ${motivo.trim().replace(/\.+$/, "")}. Corrija e use "Gerar PDF para assinatura".`;
