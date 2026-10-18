// Status por signatário da Clicksign, comum à CAPTAÇÃO e à VENDA. O servidor (clicksign-manage /
// clicksign-sale, action "status") devolve signed/opened/status; respostas antigas, sem esses campos,
// caem em "Enviado" ou "Assinou" sem erro. Não existe "E-mail não entregue": a Clicksign não oferece
// evento nem endpoint de bounce (docs oficiais, 18/10/2026).

export type SignerStatus = "enviado" | "abriu" | "assinou";

export type SignerStatusInput = {
  signed?: boolean | null;
  opened?: boolean | null;
  status?: string | null;
};

export function signerStatusOf(s: SignerStatusInput): SignerStatus {
  if (s.signed === true || s.status === "assinou") return "assinou";
  if (s.opened === true || s.status === "abriu") return "abriu";
  return "enviado";
}

export const SIGNER_STATUS_LABEL: Record<SignerStatus, string> = {
  enviado: "Enviado",
  abriu: "Abriu o contrato",
  assinou: "Assinou",
};

export function signerStatusLabel(s: SignerStatusInput): string {
  return SIGNER_STATUS_LABEL[signerStatusOf(s)];
}
