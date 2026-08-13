import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { InconsistenciaRow, MotivoInconsistencia } from "@/lib/comparativo-comissao-types";

const MOTIVO_LABEL: Record<MotivoInconsistencia, string> = {
  sem_historico_fechamento: "Sem histórico de envio ao financeiro (ocorrência análise financeiro)",
  valores_invalidos: "Valor negociado ou comissão inválido",
};

const MODALIDADE_LABEL: Record<string, string> = { padrao: "Venda tradicional", lancamento: "Lançamento" };

/** Indicador só informativo — nunca corrige dado, nunca entra nos totais do Comparativo, nunca
 * mostra nome/valor (só id/código interno + motivo). Visível só pra quem já está na página (rota já
 * restrita a admin/super_admin/financeiro). */
export function InconsistenciasIndicator({ rows }: { rows: InconsistenciaRow[] }) {
  const [aberto, setAberto] = useState(false);

  const porMotivo = useMemo(() => {
    const m = new Map<MotivoInconsistencia, number>();
    for (const r of rows) m.set(r.motivo, (m.get(r.motivo) ?? 0) + 1);
    return m;
  }, [rows]);

  if (rows.length === 0) return null;

  return (
    <Card className="border-amber-300/60 dark:border-amber-800/60">
      <CardContent className="py-3">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left text-sm text-amber-800 dark:text-amber-300"
          onClick={() => setAberto((v) => !v)}
        >
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Inconsistências encontradas ({rows.length})
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${aberto ? "rotate-180" : ""}`} />
        </button>
        <p className="mt-1 text-xs text-muted-foreground">
          Vendas em etapa que já indica envio ao financeiro mas sem o histórico correspondente, ou com valores
          inválidos — não entram nos totais acima e não foram alteradas.
        </p>
        {aberto && (
          <div className="mt-3 space-y-3">
            <ul className="text-xs text-muted-foreground">
              {Array.from(porMotivo.entries()).map(([motivo, qtd]) => (
                <li key={motivo}>{qtd} — {MOTIVO_LABEL[motivo]}</li>
              ))}
            </ul>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {rows.map((r) => (
                <li key={r.sale_id} className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>{r.codigo_interno || `Venda #${r.sale_id.slice(0, 8)}`} — {MODALIDADE_LABEL[r.modalidade] ?? r.modalidade}</span>
                  <span>{MOTIVO_LABEL[r.motivo]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
