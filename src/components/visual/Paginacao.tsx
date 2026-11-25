/**
 * Paginação simples "Mostrando 1–24 de 366 · Anterior / Próxima" (t_7bd432c2).
 * Ideia do padrão Pagination (originui/shadcn, MIT), reescrita com os botões do ADM MAX.
 * Só apresentação: quem fatia a lista é `paginar` (src/lib/telas-lote1.ts).
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Paginacao({
  pagina,
  paginas,
  total,
  de,
  ate,
  rotulo = "itens",
  onIr,
  className,
}: {
  pagina: number;
  paginas: number;
  total: number;
  de: number;
  ate: number;
  rotulo?: string;
  onIr: (p: number) => void;
  className?: string;
}) {
  if (total === 0) return null;
  return (
    <nav
      aria-label={`Páginas de ${rotulo}`}
      className={cn("flex flex-wrap items-center justify-between gap-2 text-sm", className)}
      data-testid="paginacao"
    >
      <p className="text-muted-foreground" aria-live="polite">
        Mostrando <strong className="tabular-nums text-foreground">{de}</strong>–
        <strong className="tabular-nums text-foreground">{ate}</strong> de{" "}
        <strong className="tabular-nums text-foreground">{total}</strong> {rotulo}
      </p>
      {paginas > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={pagina <= 1}
            onClick={() => onIr(pagina - 1)}
            aria-label="Página anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            <span className="max-sm:sr-only">Anterior</span>
          </Button>
          <span className="min-w-[4.5rem] text-center tabular-nums text-muted-foreground">
            {pagina} de {paginas}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pagina >= paginas}
            onClick={() => onIr(pagina + 1)}
            aria-label="Próxima página"
          >
            <span className="max-sm:sr-only">Próxima</span>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      )}
    </nav>
  );
}
