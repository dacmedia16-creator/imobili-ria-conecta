import type { SituacaoComissao } from "@/lib/comparativo-comissao-types";
import { cn } from "@/lib/utils";

// Mesma convenção de tom já usada em STATUS_TONE (src/lib/status.ts): destructive/alerta pra
// "abaixo" (perda de comissão), emerald/positivo pra "igual", azul/informativo pra "acima".
const TONE: Record<SituacaoComissao, string> = {
  abaixo: "bg-destructive/15 text-destructive",
  igual: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  acima: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
};

const LABEL: Record<SituacaoComissao, string> = {
  abaixo: "Abaixo de 6%",
  igual: "Igual a 6%",
  acima: "Acima de 6%",
};

export function SituacaoBadge({ situacao, className }: { situacao: SituacaoComissao | null; className?: string }) {
  if (!situacao) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[situacao], className)}>
      {LABEL[situacao]}
    </span>
  );
}
