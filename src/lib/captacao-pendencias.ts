/**
 * Ficha da captação (FASE 2 item 19 — t_7fcda931): em que passo resolver cada pendência e quais
 * passos estão completos. SÓ TELA: as listas de pendência continuam vindo de `missingRequirements`
 * / `manualPendencies` (mesmas regras de antes); aqui só se escolhe o passo do link e o ✓.
 */
export type PassoCaptacao = "documentos" | "dados" | "dossie" | "revisao" | "assinado" | "contrato";

export type PendenciaCaptacao = { texto: string; passo: PassoCaptacao };

const DOCUMENTO = /RG e CPF ou CNH|RG \+ CPF ou CNH|^Matrícula|^IPTU|Comprovante de residência/i;

/** Passo onde a pessoa resolve a pendência (mesmos textos de exclusive-captures.ts). */
export function passoDaPendencia(texto: string, manual: boolean): PassoCaptacao {
  if (/^Plano de Marketing/i.test(texto)) return "dossie";
  if (manual) {
    if (texto === "Contrato assinado") return "contrato";
    // No cadastro manual os documentos opcionais ficam no passo do Plano de Marketing.
    if (DOCUMENTO.test(texto)) return "dossie";
    return "dados";
  }
  if (DOCUMENTO.test(texto)) return "documentos";
  return "dados";
}

export function pendenciasPorPasso(textos: string[], manual: boolean): PendenciaCaptacao[] {
  return textos.map((texto) => ({ texto, passo: passoDaPendencia(texto, manual) }));
}

/**
 * ✓ no passo: nenhum item pendente nele. "Revisão/Envio" fica ✓ quando a captação já saiu do
 * rascunho (enviada, em assinatura ou aprovada); "Documento assinado" é ✓ sempre que existe.
 */
export function passoCompleto(
  passo: PassoCaptacao,
  pendencias: PendenciaCaptacao[],
  status: string,
): boolean {
  if (passo === "assinado") return true;
  if (passo === "revisao") return ["enviada", "em_assinatura", "aprovada"].includes(status);
  return !pendencias.some((p) => p.passo === passo);
}
