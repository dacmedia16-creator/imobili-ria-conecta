import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { atalhoAtivo, atalhosBarraInferior } from "@/lib/telas-lote2";
import type { NavGroup } from "@/lib/menu-lateral";

/**
 * Barra de navegação fixa no rodapé do celular (t_29b7cd5e, item 5 do t_d62be550).
 * Ideia: Mobile Navigation Tabs (shadcnui-blocks, MIT). Os atalhos saem do MESMO menu lateral já
 * filtrado por papel e módulo (show = true), então a barra nunca mostra algo que o menu não mostra.
 * "Mais" abre o menu completo. Respeita a área segura do app instalado (env(safe-area-inset-bottom)).
 */
export function BarraInferior({
  groups,
  pathname,
  unread,
  onMais,
}: {
  groups: NavGroup[];
  pathname: string;
  unread: number;
  onMais: () => void;
}) {
  const atalhos = atalhosBarraInferior(groups);
  if (atalhos.length === 0) return null;
  return (
    <nav
      aria-label="Atalhos"
      data-testid="barra-inferior"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-[0_-4px_16px_-8px_rgba(3,10,35,0.25)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden print:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {atalhos.map((a) => {
          const ativo = atalhoAtivo(a.to, pathname);
          const aviso = a.to === "/notificacoes" && unread > 0;
          return (
            <li key={a.to} className="flex-1">
              <Link
                to={a.to}
                search={a.search}
                aria-current={ativo ? "page" : undefined}
                aria-label={aviso ? `${a.label}, ${unread} não lidas` : a.label}
                data-testid={`barra-${a.to.replace(/\//g, "") || "inicio"}`}
                className={cn(
                  "relative flex h-14 touch-manipulation flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  ativo ? "text-[#1d3a8a] dark:text-blue-300" : "text-muted-foreground",
                )}
              >
                {/* Traço no topo marca a aba atual (cor + texto + aria-current). */}
                <span
                  className={cn(
                    "absolute inset-x-4 top-0 h-0.5 rounded-b-full transition-colors",
                    ativo ? "bg-[#1d3a8a] dark:bg-blue-300" : "bg-transparent",
                  )}
                  aria-hidden
                />
                <span className="relative">
                  <a.icon className={cn("h-5 w-5", ativo && "stroke-[2.25]")} aria-hidden />
                  {aviso && (
                    <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-[#e11d2a]" />
                  )}
                </span>
                <span className="leading-none">{a.curto}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={onMais}
            data-testid="barra-mais"
            aria-label="Mais: abrir o menu completo"
            className="flex h-14 w-full touch-manipulation flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Menu className="h-5 w-5" aria-hidden />
            <span className="leading-none">Mais</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
