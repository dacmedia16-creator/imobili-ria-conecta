import { FileCheck2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  signedOrigin,
  signedSignerLabels,
  type ClicksignSignedInfo,
} from "@/lib/exclusive-clicksign";

const dataHoraSP = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

/**
 * Passo 5 "Documento assinado": resumo do contrato assinado (origem, quando chegou e quem assinou).
 * O PDF (ver/imprimir/baixar), a data de assinatura e o botão Aprovar ficam no cartão de aprovação
 * logo abaixo. Sem e-mail: a Clicksign devolve só nome e papel gravados no envio.
 */
export function DocumentoAssinadoResumo({
  info: raw,
  fileName,
  anexadoEm,
  aprovada,
}: {
  info: ClicksignSignedInfo | null | "unknown";
  fileName: string | null | undefined;
  anexadoEm: string | null | undefined;
  aprovada: boolean;
}) {
  const info = raw === "unknown" ? null : raw;
  return (
    <Card className="border-emerald-300" data-testid="documento-assinado">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-emerald-600" /> Contrato assinado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Origem</dt>
          <dd>{signedOrigin(raw, fileName)}</dd>
          <dt className="text-muted-foreground">{info ? "Todos assinaram em" : "Anexado em"}</dt>
          <dd>{dataHoraSP(info ? info.closed_at : anexadoEm)}</dd>
          <dt className="text-muted-foreground">Quem assinou</dt>
          <dd>
            {info && info.signers.length ? (
              <ul className="list-inside list-disc">
                {signedSignerLabels(info.signers).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            ) : (
              "Confira as assinaturas no próprio PDF."
            )}
          </dd>
        </dl>
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
          {aprovada
            ? "Captação aprovada com este contrato."
            : "Próximo passo: o gestor confere o PDF e a data de assinatura e aprova a captação."}
        </p>
      </CardContent>
    </Card>
  );
}
