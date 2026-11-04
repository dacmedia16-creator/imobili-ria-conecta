import { AlertTriangle } from "lucide-react";
import { divergenciaComissao } from "@/lib/comissao-divergencia";
import { money } from "./shared";
import type { OccurrenceRow, SaleRow } from "@/lib/database.types";

const pct = (v: number | null) =>
  v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;

/**
 * Aviso interno (não sai na impressão) para Financeiro/Admin quando a comissão da venda e a da
 * ocorrência estão diferentes (t_59cb12e0). A Revisão e o relatório usam a da ocorrência.
 */
export function ComissaoDivergenciaAviso({
  sale,
  occ,
  visivel,
}: {
  sale: Pick<SaleRow, "percentual_comissao" | "valor_total_comissao" | "modalidade">;
  occ: Pick<
    OccurrenceRow,
    "percentual_comissao" | "valor_comissao" | "aceita_financeiro" | "status"
  > | null;
  visivel: boolean;
}) {
  if (!visivel) return null;
  const d = divergenciaComissao(sale, occ);
  if (!d || !occ) return null;
  const congelada = !!occ.aceita_financeiro || occ.status === "concluida";
  return (
    <div
      role="alert"
      data-testid="aviso-divergencia-comissao"
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200 print:hidden"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold">Comissão da venda diferente da comissão da ocorrência</p>
          <p>
            Venda: {pct(d.percentualVenda)} = {money(d.valorVenda) ?? "—"} · Ocorrência:{" "}
            {pct(d.percentualOcorrencia)} = {money(d.valorOcorrencia) ?? "—"}. A revisão e o
            relatório usam o valor da ocorrência.
          </p>
          <p className="text-xs">
            {congelada
              ? "A ocorrência já foi aceita pelo Financeiro e não acompanha mais a venda. Se a venda estiver certa, ajuste o Percentual e o Valor da comissão na aba Ocorrência."
              : "Confira os dois valores. Ao salvar a comissão na venda, a ocorrência é atualizada; ou ajuste o Percentual e o Valor da comissão na aba Ocorrência."}
          </p>
        </div>
      </div>
    </div>
  );
}
