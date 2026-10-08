/**
 * Os dois PDFs da captação exclusiva normal (pedido de Denis em 08/10):
 *  - PDF PARA ASSINATURA: só o contrato + o Plano de Marketing (é o "gerado", salvo na captação).
 *    Sem RG, matrícula ou outros documentos e sem capa.
 *  - PDF COMPLETO: contrato ASSINADO + todos os documentos anexados. O Plano de Marketing não é
 *    repetido, porque já está dentro do contrato assinado. Disponível depois da aprovação.
 */
import type { Capture, CaptureDocument } from "@/lib/exclusive-captures";

/** Ordem do PDF completo: contrato assinado primeiro, depois os documentos (sem o contrato gerado). */
export function completePdfDocs(docs: CaptureDocument[]): CaptureDocument[] {
  const signed = docs.filter((d) => d.kind === "assinado");
  const others = docs.filter((d) => d.kind !== "assinado" && d.kind !== "gerado");
  return [...signed, ...others];
}

/** PDF completo só existe com a captação aprovada e o contrato assinado anexado. */
export function canBuildCompletePdf(
  capture: Pick<Capture, "status">,
  docs: CaptureDocument[],
): boolean {
  return capture.status === "aprovada" && docs.some((d) => d.kind === "assinado");
}

export const signaturePdfName = (id: string) => `contrato-exclusividade-${id.slice(0, 8)}.pdf`;
export const completePdfName = (id: string) => `contrato-assinado-${id.slice(0, 8)}-completo.pdf`;
