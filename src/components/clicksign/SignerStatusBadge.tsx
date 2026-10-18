import { CheckCircle2, Eye, Mail } from "lucide-react";
import {
  signerStatusOf,
  SIGNER_STATUS_LABEL,
  type SignerStatusInput,
} from "@/lib/clicksign-signer-status";

/** Selo "Enviado" / "Abriu o contrato" / "Assinou", reutilizado na captação e na venda. */
export function SignerStatusBadge({ signer }: { signer: SignerStatusInput }) {
  const st = signerStatusOf(signer);
  const label = SIGNER_STATUS_LABEL[st];
  if (st === "assinou") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700" data-status={st}>
        <CheckCircle2 className="h-4 w-4" /> {label}
      </span>
    );
  }
  if (st === "abriu") {
    return (
      <span className="inline-flex items-center gap-1 text-sky-700" data-status={st}>
        <Eye className="h-4 w-4" /> {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-amber-800" data-status={st}>
      <Mail className="h-4 w-4" /> {label}
    </span>
  );
}
