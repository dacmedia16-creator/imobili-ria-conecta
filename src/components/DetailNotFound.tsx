import { Link } from "@tanstack/react-router";
import { ArrowLeft, RotateCcw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Estado neutro para detalhe por ID que não pôde ser exibido. A mesma mensagem cobre "não existe"
 * e "existe em outra imobiliária/sem permissão" — ver src/lib/detail-route-state.ts.
 */
export function DetailNotFound({
  message,
  backTo,
  backLabel,
  onRetry,
}: {
  message: string;
  backTo: "/vendas" | "/exclusividades";
  backLabel: string;
  /** Presente só em falha de rede/servidor: permite tentar de novo. */
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="detail-not-found"
      className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center"
    >
      <SearchX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-base font-medium">
        {onRetry
          ? "Não foi possível carregar agora. Verifique a conexão e tente de novo."
          : message}
      </p>
      {!onRetry && (
        <p className="text-sm text-muted-foreground">
          Confira o endereço ou volte à lista para abrir o registro por lá.
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Tentar de novo
          </Button>
        )}
        <Button asChild>
          <Link to={backTo}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {backLabel}
          </Link>
        </Button>
      </div>
    </div>
  );
}
