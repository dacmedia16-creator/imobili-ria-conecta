import { useEffect, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/**
 * Item 25 (FASE 2 D6): no computador o detalhe fica ao lado da lista; em telas estreitas
 * (abaixo do ponto `quebra`) ele abre por cima da lista, numa janela com "Fechar".
 * Só interface: quem decide o que mostrar continua sendo a tela que usa o componente.
 */
export function useTelaEstreita(quebra = 1024) {
  const consulta = `(max-width: ${quebra - 1}px)`;
  const [estreita, setEstreita] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(consulta);
    const mudar = () => setEstreita(mql.matches);
    mudar();
    mql.addEventListener("change", mudar);
    return () => mql.removeEventListener("change", mudar);
  }, [consulta]);
  return estreita;
}

export function DetalhePorCima({
  aberto,
  onFechar,
  titulo,
  children,
}: {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent
        side="right"
        data-testid="detalhe-por-cima"
        className="w-full overflow-y-auto sm:max-w-lg"
      >
        <SheetTitle className="pr-10 text-base">{titulo}</SheetTitle>
        <SheetDescription className="sr-only">Detalhe do item escolhido na lista</SheetDescription>
        <div className="mt-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
