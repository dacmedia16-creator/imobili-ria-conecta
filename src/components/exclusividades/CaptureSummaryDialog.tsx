import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  captureValidity,
  formatDateBR,
  captureUnitLabel,
  validityText,
  VALIDITY_STYLE,
  type Capture,
  type ExclusiveUnit,
} from "@/lib/exclusive-captures";
import { brl, parseBRL } from "@/lib/exclusive-captures-dashboard";
import { ArrowRight } from "lucide-react";

/** Resumo rápido da gestão de uma exclusividade aprovada (aberto ao clicar no card). */
export function CaptureSummaryDialog({
  capture,
  today,
  onClose,
  units = [],
}: {
  capture: Capture | null;
  today: string;
  onClose: () => void;
  units?: ExclusiveUnit[];
}) {
  const c = capture;
  const i = c?.form_data.imovel;
  const v = c ? captureValidity(c, today) : null;
  const valor = parseBRL(i?.valor_imovel);
  const pct = Number(
    String(c?.form_data.condicoes?.comissao_percentual_numero ?? "").replace(",", "."),
  );
  const endereco = [i?.endereco, i?.complemento].filter((x) => x?.trim()).join(" — ");
  const cidade = [i?.bairro, [i?.municipio, i?.estado].filter((x) => x?.trim()).join("/")]
    .filter((x) => x?.trim())
    .join(" · ");
  const donos = [
    c?.form_data.proprietario_1?.nome_completo,
    c?.form_data.proprietario_2?.nome_completo,
  ]
    .filter((x) => x?.trim())
    .join(" e ");
  const decorrido = v
    ? Math.min(100, Math.max(0, Math.round(((v.days - v.daysLeft) / v.days) * 100)))
    : 0;

  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || "—"}</span>
    </div>
  );

  return (
    <Dialog open={!!c} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {c && (
          <>
            <DialogHeader>
              <DialogTitle>{i?.endereco || i?.tipo_imovel || "Imóvel"}</DialogTitle>
              <DialogDescription>Resumo da gestão da exclusividade</DialogDescription>
            </DialogHeader>

            {v ? (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Vigência</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${VALIDITY_STYLE[v.level]}`}
                  >
                    {validityText(v)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${decorrido}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Assinada em {formatDateBR(v.start)}</span>
                  <span>Vence em {formatDateBR(v.end)}</span>
                </div>
                <p className="text-sm">
                  {v.daysLeft >= 0 ? (
                    <>
                      Faltam{" "}
                      <strong>
                        {v.daysLeft} dia{v.daysLeft === 1 ? "" : "s"}
                      </strong>{" "}
                      de {v.days} ({decorrido}% do prazo já passou).
                    </>
                  ) : (
                    <>
                      Venceu há{" "}
                      <strong>
                        {-v.daysLeft} dia{v.daysLeft === -1 ? "" : "s"}
                      </strong>
                      . Converse com o proprietário sobre a renovação.
                    </>
                  )}
                </p>
              </div>
            ) : (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                Data de assinatura ainda não informada — abra a captação para preencher.
              </p>
            )}

            <div>
              {row("Proprietário", donos)}
              {row("Endereço", endereco)}
              {row("Bairro / cidade", cidade)}
              {row("Tipo", i?.tipo_imovel ?? "")}
              {row("Valor do imóvel", valor ? brl(valor) : "")}
              {row(
                "Comissão",
                pct
                  ? `${String(pct).replace(".", ",")}%${valor ? ` (${brl((valor * pct) / 100)})` : ""}`
                  : "",
              )}
              {row(
                "Prazo contratado",
                v
                  ? `${v.days} dias`
                  : c.form_data.condicoes?.prazo_dias_numero
                    ? `${c.form_data.condicoes.prazo_dias_numero} dias`
                    : "",
              )}
              {row("Captador", c.broker_name ?? "")}
              {row("Unidade", captureUnitLabel(c, units))}
            </div>

            <div className="flex justify-end">
              <Button asChild>
                <Link to="/exclusividades/$id" params={{ id: c.id }}>
                  Abrir captação completa <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
