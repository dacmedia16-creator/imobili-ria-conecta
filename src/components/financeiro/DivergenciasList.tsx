import { Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { money } from "@/components/vendas/shared";
import type { DivergenciaFinanceira, GravidadeDivergencia } from "@/lib/financeiro-dashboard-types";

const GRAVIDADE_ORDEM: Record<GravidadeDivergencia, number> = { alta: 0, media: 1, baixa: 2 };
const GRAVIDADE_LABEL: Record<GravidadeDivergencia, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};
const GRAVIDADE_VARIANT: Record<GravidadeDivergencia, "destructive" | "secondary" | "outline"> = {
  alta: "destructive",
  media: "secondary",
  baixa: "outline",
};

/** Fila somente leitura, priorizada por gravidade — nunca corrige nada automaticamente (ver
 * PROMPT, item 11). Cada item já vem pronto de financeiro-dashboard-query.ts; aqui só ordena e
 * apresenta. */
export function DivergenciasList({ divergencias }: { divergencias: DivergenciaFinanceira[] }) {
  const ordenadas = [...divergencias].sort(
    (a, b) => GRAVIDADE_ORDEM[a.gravidade] - GRAVIDADE_ORDEM[b.gravidade],
  );

  if (ordenadas.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma divergência encontrada.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {ordenadas.map((d) => (
        <Card key={d.id} className={d.gravidade === "alta" ? "border-destructive/40" : ""}>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={GRAVIDADE_VARIANT[d.gravidade]}>
                  {GRAVIDADE_LABEL[d.gravidade]}
                </Badge>
                <span className="font-medium">{d.tipo}</span>
                {d.imovelLabel && (
                  <span className="text-sm text-muted-foreground">— {d.imovelLabel}</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{d.explicacao}</p>
              <p className="text-xs text-muted-foreground">Ação recomendada: {d.acaoRecomendada}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {d.valorAfetado != null && (
                <span className="font-semibold">{money(d.valorAfetado)}</span>
              )}
              {d.linkTo && (
                <Link to={d.linkTo} className="text-xs text-primary hover:underline">
                  Revisar →
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
