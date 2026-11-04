import { Award } from "lucide-react";
import { cn } from "@/lib/utils";

// Selo do Clube RE/MAX (card t_481a3f26). Só visual: usado no Ranking e Clubes e no Mural.
const COR_CLUBE: Record<string, string> = {
  Executive:
    "border-slate-400/40 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  "100%":
    "border-orange-400/40 bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  Platinum: "border-zinc-400/40 bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100",
  "Chairman's":
    "border-amber-400/40 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  Titan: "border-blue-400/40 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  Diamond: "border-cyan-400/40 bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200",
  Pinnacle:
    "border-purple-400/40 bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
};

export function SeloClube({ nome, extra }: { nome: string | null; extra?: string }) {
  return (
    <span
      data-testid="selo-clube"
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold",
        nome
          ? (COR_CLUBE[nome] ?? "border-primary/30 bg-primary/10 text-primary")
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {nome ? <Award className="h-3 w-3" aria-hidden /> : null}
      {nome ?? "Sem clube"}
      {extra ? <span className="font-normal"> · {extra}</span> : null}
    </span>
  );
}
