import {
  formatDateBR,
  validityElapsedPct,
  validityText,
  VALIDITY_STYLE,
  type Validity,
} from "@/lib/exclusive-captures";

const plural = (n: number) => `${n} dia${n === 1 ? "" : "s"}`;

/** Barra de Vigência da exclusividade. `compact` = versão do card da lista (sem título e selo). */
export function VigenciaBar({ v, compact = false }: { v: Validity; compact?: boolean }) {
  const decorrido = validityElapsedPct(v);
  const bar = (
    <div
      className={`${compact ? "h-1.5" : "h-2"} w-full overflow-hidden rounded-full bg-muted`}
      role="progressbar"
      aria-label="Prazo da exclusividade já decorrido"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={decorrido}
    >
      <div className="h-full bg-primary" style={{ width: `${decorrido}%` }} />
    </div>
  );

  if (compact) {
    return (
      <div className="mt-3 space-y-1" data-testid="vigencia-card">
        {bar}
        <div className="flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
          <span>
            {v.daysLeft >= 0 ? (
              <>
                Faltam <strong className="text-foreground">{plural(v.daysLeft)}</strong> de{" "}
                {v.days}
              </>
            ) : (
              <>
                Venceu há <strong className="text-foreground">{plural(-v.daysLeft)}</strong>
              </>
            )}
          </span>
          <span>
            {v.daysLeft >= 0 ? "Vence em" : "Venceu em"} {formatDateBR(v.end)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Vigência</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${VALIDITY_STYLE[v.level]}`}
        >
          {validityText(v)}
        </span>
      </div>
      {bar}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Assinada em {formatDateBR(v.start)}</span>
        <span>Vence em {formatDateBR(v.end)}</span>
      </div>
      <p className="text-sm">
        {v.daysLeft >= 0 ? (
          <>
            Faltam <strong>{plural(v.daysLeft)}</strong> de {v.days} ({decorrido}% do prazo já
            passou).
          </>
        ) : (
          <>
            Venceu há <strong>{plural(-v.daysLeft)}</strong>. Converse com o proprietário sobre a
            renovação.
          </>
        )}
      </p>
    </div>
  );
}
