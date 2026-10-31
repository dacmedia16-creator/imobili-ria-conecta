import {
  CheckCircle2,
  ChevronDown,
  MoreHorizontal,
  Send,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AcaoVenda, AcoesVenda } from "@/lib/venda-acoes";

/**
 * Topo do detalhe da venda (FASE 2 item 18): 1 botão principal, "Devolver" e "Mais".
 * Botão desabilitado mostra o motivo escrito embaixo (o title não aparece no celular).
 */
export function AcoesDaVenda({
  acoes,
  onAcao,
}: {
  acoes: AcoesVenda;
  onAcao: (a: AcaoVenda) => void;
}) {
  const { principal, devolver, mais } = acoes;
  if (!principal && devolver.length === 0 && mais.length === 0) return null;
  const IconePrincipal: LucideIcon =
    principal?.id === "aprovar_juridico" || principal?.id === "dar_ok_contrato"
      ? CheckCircle2
      : Send;
  const comuns = mais.filter((a) => !a.destrutiva);
  const destrutivas = mais.filter((a) => a.destrutiva);
  const motivos = [principal, ...mais].filter((a): a is AcaoVenda => !!a?.disabled && !!a.motivo);
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end" data-testid="venda-acoes">
      <div className="flex flex-wrap gap-2">
        {principal && (
          <Button
            data-testid="venda-acao-principal"
            onClick={() => onAcao(principal)}
            disabled={principal.disabled}
            title={principal.disabled ? principal.motivo : principal.dica}
            aria-describedby={principal.disabled ? "venda-acao-motivo" : undefined}
          >
            <IconePrincipal className="mr-2 h-4 w-4" />
            {principal.label}
          </Button>
        )}
        {devolver.length === 1 && (
          <Button
            variant="outline"
            data-testid="venda-acao-devolver"
            onClick={() => onAcao(devolver[0])}
          >
            <Undo2 className="mr-2 h-4 w-4" />
            {devolver[0].label}
          </Button>
        )}
        {devolver.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="venda-acao-devolver">
                <Undo2 className="mr-2 h-4 w-4" />
                Devolver
                <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {devolver.map((a) => (
                <DropdownMenuItem key={a.id + a.alvo} onSelect={() => onAcao(a)}>
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {mais.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="venda-acao-mais" aria-label="Mais ações">
                <MoreHorizontal className="mr-1 h-4 w-4" />
                Mais
                <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
              {comuns.map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  disabled={a.disabled}
                  title={a.disabled ? undefined : a.dica}
                  onSelect={() => onAcao(a)}
                  className="flex-col items-start gap-0.5"
                >
                  <span>{a.label}</span>
                  {a.disabled && a.motivo && (
                    <span className="text-xs text-muted-foreground">{a.motivo}</span>
                  )}
                </DropdownMenuItem>
              ))}
              {comuns.length > 0 && destrutivas.length > 0 && <DropdownMenuSeparator />}
              {destrutivas.map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  onSelect={() => onAcao(a)}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  {a.id === "excluir_venda" && <Trash2 className="mr-2 h-4 w-4" />}
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {motivos.length > 0 && (
        <p
          id="venda-acao-motivo"
          data-testid="venda-acao-motivo"
          className="max-w-md text-xs text-muted-foreground sm:text-right"
        >
          {motivos.map((a) => `${a.label}: ${a.motivo}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
